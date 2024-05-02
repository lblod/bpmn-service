console.log("first log");

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
    console.log(
      `Something unexpected went wrong while handling bpmn extraction!`
    );
    console.error(e);
    return next(e);
  }

  const bboTriplesInsertQuery = generateBboTriplesInsertQuery(bboTriples);
  await update(bboTriplesInsertQuery);
  return res
    .status(200)
    .send({ message: "bpmn extraction completed successfully" });
});

app.get("/:id/download", async (req, res) => {
  console.log("welcome");
  const acceptType = req.headers["accept"];
  console.log("accept type:", acceptType);
  let tempFilePath = path.join("/temp", uuid());
  if (acceptType?.includes("image/svg+xml")) {
    tempFilePath += ".svg";
  } else if (acceptType?.includes("image/png")) {
    tempFilePath += ".png";
  } else if (acceptType?.includes("application/pdf")) {
    tempFilePath += ".pdf";
  } else {
    return res.status(406).send("The requested file format is not available.");
  }
  console.log("temp file path:", tempFilePath);

  const virtualFileUuid = req.params.id;
  const fileUriQuery = generateFileUriSelectQuery(virtualFileUuid);
  const fileUriResult = await query(fileUriQuery);
  const fileUriBindings = fileUriResult.results.bindings;
  if (fileUriBindings.length === 0) {
    return res.status(404).send("Not Found");
  }
  const physicalFileUri = fileUriBindings[0].physicalFileUri.value;
  console.log("physical file uri:", physicalFileUri);

  const bpmnFilePath = physicalFileUri.replace("share://", STORAGE_FOLDER_PATH);
  console.log("bpmn file path:", bpmnFilePath);
  console.log("bpmn file exists:", existsSync(bpmnFilePath));
  if (!existsSync(bpmnFilePath)) {
    return res
      .status(500)
      .send(
        "Could not find file in path. Check if the physical file is available on the server and if this service has the right mountpoint."
      );
  }

  console.log("temp file location:", tempFilePath);
  console.log("exists before:", existsSync(tempFilePath));

  try {
    await convertBpmn(bpmnFilePath, tempFilePath);
    console.log("exists after:", existsSync(tempFilePath));
    return res.sendFile(tempFilePath);
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
