import { app, update, query, errorHandler, uuid } from "mu";
import { querySudo } from "@lblod/mu-auth-sudo";
import bodyParser from "body-parser";
import { readFile, unlink } from "fs/promises";
import * as RmlMapper from "@comake/rmlmapper-js";
import { mapping as bboMapping } from "./bbo-mapping.js";
import { existsSync } from "fs";
import {
  generateBboTriplesInsertQuery,
  generateFileUriSelectQuery,
  generateGroupUriSelectQuery,
  generateFileGroupLinkInsertQuery,
} from "./sparql-queries.js";
import { convert as convertBpmn } from "bpmn-to-image";
import path from "path";

const STORAGE_FOLDER_PATH = "/share/";
const HEADER_MU_SESSION_ID = "mu-session-id";

app.use(
  bodyParser.json({
    type: function (req) {
      return /^application\/json/.test(req.get("content-type"));
    },
  })
);

app.post("/", async (req, res, next) => {
  const sessionUri = req.get(HEADER_MU_SESSION_ID);
  if (!sessionUri) {
    return res.status(401).send("Session ID header not found.");
  }
  const groupUriQuery = generateGroupUriSelectQuery(sessionUri);
  const groupUriResult = await querySudo(groupUriQuery);
  const groupUri = groupUriResult.results.bindings[0]?.groupUri?.value;
  if (!groupUri) {
    return res.status(401).send("User not affiliated with any organization.");
  }

  const virtualFileUuid = req.query.id;
  const fileUriQuery = generateFileUriSelectQuery(virtualFileUuid);
  const fileUriResult = await query(fileUriQuery);
  const fileUriBindings = fileUriResult.results.bindings;
  if (fileUriBindings.length === 0) {
    return res.status(404).send("Not Found");
  }
  const virtualFileUri = fileUriBindings[0].virtualFileUri.value;
  const physicalFileUri = fileUriBindings[0].physicalFileUri.value;

  const fileGroupLinkInsertQuery = generateFileGroupLinkInsertQuery(
    virtualFileUri,
    groupUri
  );
  await update(fileGroupLinkInsertQuery);

  const filePath = physicalFileUri.replace("share://", STORAGE_FOLDER_PATH);
  if (!existsSync(filePath)) {
    return res
      .status(500)
      .send(
        "Could not find file in path. Check if the physical file is available on the server and if this service has the right mountpoint."
      );
  }
  const bpmnFile = await readFile(filePath, "utf-8");
  let bboTriples;
  try {
    bboTriples = await translateToRdf(bpmnFile, virtualFileUri);
  } catch (e) {
    console.error(e);
    return next(e);
  }
  const chunkArr = (arr, size) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size)
    );
  const chunks = chunkArr(bboTriples.split('\n'), 100);

  for (const chunk of chunks) {
    const q = `
        INSERT DATA {
            ${chunk.join('\n')}
        }`
    await update(q);
  }
  return res
    .status(200)
    .send({ message: "bpmn extraction completed successfully" });
});

app.get("/:id/download", async (req, res) => {
  const acceptType = req.headers["accept"];
  let tempFilePath = path.join("/tmp", uuid());
  if (acceptType?.includes("image/svg+xml")) {
    tempFilePath += ".svg";
  } else if (acceptType?.includes("image/png")) {
    tempFilePath += ".png";
  } else if (acceptType?.includes("application/pdf")) {
    tempFilePath += ".pdf";
  } else {
    return res.status(406).send("The requested file format is not available.");
  }

  const virtualFileUuid = req.params.id;
  const fileUriQuery = generateFileUriSelectQuery(virtualFileUuid);
  const fileUriResult = await query(fileUriQuery);
  const fileUriBindings = fileUriResult.results.bindings;
  if (fileUriBindings.length === 0) {
    return res.status(404).send("Not Found");
  }
  const physicalFileUri = fileUriBindings[0].physicalFileUri.value;

  const bpmnFilePath = physicalFileUri.replace("share://", STORAGE_FOLDER_PATH);
  if (!existsSync(bpmnFilePath)) {
    return res
      .status(500)
      .send(
        "Could not find file in path. Check if the physical file is available on the server and if this service has the right mountpoint."
      );
  }

  try {
    await convertBpmn(bpmnFilePath, tempFilePath);
    return res.sendFile(tempFilePath, {}, async () => {
      await unlink(tempFilePath);
    });
  } catch (error) {
    console.error("error:", error);
    return res.status(500).send(`Conversion error: ${error.message}`);
  }
});

app.use(errorHandler);
async function translateToRdf(bpmn, virtualFileUri) {
  if (!bpmn || bpmn.trim().length === 0) {
    const error = new Error(
      "Invalid content: The provided file does not contain any content."
    );
    error.statusCode = 400;
    throw error;
  }

  const inputFiles = {
    "input.bpmn": bpmn,
  };
  const options = {
    compact: {
      "@base": "http://data.lblod.info/",
    },
    toRDF: true,
    xpathLib: "xpath",
  };

  const triples = await RmlMapper.parseTurtle(
    bboMapping(virtualFileUri),
    inputFiles,
    options
  );
  if (!triples || triples.trim().length === 0) {
    const error = new Error(
      "Invalid content: The provided file does not contain valid content."
    );
    error.statusCode = 400;
    throw error;
  }

  return triples;
}
