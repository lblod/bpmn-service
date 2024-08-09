import { sparqlEscapeString, sparqlEscapeUri } from "mu";

export function generateBboTriplesInsertQuery(bboTriples) {
  // prettier-ignore
  return `
    INSERT DATA {
      ${bboTriples.join("\n")}
    }`;
}

export function generateFileUriSelectQuery(virtualFileUuid) {
  // prettier-ignore
  return `
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT ?virtualFileUri ?physicalFileUri
    WHERE {
      ?virtualFileUri mu:uuid ${sparqlEscapeString(virtualFileUuid)} .
      ?physicalFileUri nie:dataSource ?virtualFileUri .
    }`;
}

export function generateGroupUriSelectQuery(sessionUri) {
  // prettier-ignore
  return `
    PREFIX muExt: <http://mu.semte.ch/vocabularies/ext/>

    SELECT ?groupUri
    WHERE {
      ${sparqlEscapeUri(sessionUri)} muExt:sessionGroup ?groupUri .
    }`;
}

export function generateFileGroupLinkInsertQuery(virtualFileUri, groupUri) {
  // prettier-ignore
  return `
    PREFIX schema: <https://schema.org/>

    INSERT DATA {
      ${sparqlEscapeUri(virtualFileUri)} schema:publisher ${sparqlEscapeUri(groupUri)} .
    }`;
}
