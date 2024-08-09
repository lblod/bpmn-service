import {
  uuid,
  sparqlEscapeString,
  sparqlEscapeUri,
  sparqlEscapeDateTime,
} from "mu";
import { querySudo as query, updateSudo as update } from "@lblod/mu-auth-sudo";

const PREFIXES = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX task: <http://redpencil.data.gift/vocabularies/tasks/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX oslc: <http://open-services.net/ns/core#>
  PREFIX cogs: <http://vocab.deri.ie/cogs#>
  PREFIX adms: <http://www.w3.org/ns/adms#>`;

const JOB_TYPE = "http://vocab.deri.ie/cogs#Job";
const JOB_URI_PREFIX = "http://redpencil.data.gift/id/job/";
const ERROR_TYPE = "http://open-services.net/ns/core#Error";
const ERROR_URI_PREFIX = "http://redpencil.data.gift/id/jobs/error/";

const STATUS_PREFIX = "http://redpencil.data.gift/id/concept/JobStatus/";
export const STATUS_BUSY = STATUS_PREFIX + "busy";
export const STATUS_SUCCESS = STATUS_PREFIX + "success";
export const STATUS_SCHEDULED = STATUS_PREFIX + "scheduled";
export const STATUS_FAILED = STATUS_PREFIX + "failed";
export const STATUS_CANCELED = STATUS_PREFIX + "canceled";
export const ACTIVE_STATUSES = [STATUS_BUSY, STATUS_SCHEDULED];

async function createJob(
  jobsGraph,
  creatorUri,
  jobOperationUri,
  relatedResource
) {
  const jobId = uuid();
  const jobUri = JOB_URI_PREFIX + jobId;
  const created = new Date();
  const createJobQuery = `
    ${PREFIXES}
    INSERT DATA {
      GRAPH ${sparqlEscapeUri(jobsGraph)} {
        ${sparqlEscapeUri(jobUri)} a ${sparqlEscapeUri(JOB_TYPE)} ;
          mu:uuid ${sparqlEscapeString(jobId)} ;
          dct:creator ${sparqlEscapeUri(creatorUri)} ;
          adms:status ${sparqlEscapeUri(STATUS_BUSY)} ;
          dct:created ${sparqlEscapeDateTime(created)} ;
          dct:modified ${sparqlEscapeDateTime(created)} ;
          ext:relatedTo ${sparqlEscapeUri(relatedResource)} ;
          task:operation ${sparqlEscapeUri(jobOperationUri)} .
      }
    }`;

  await update(createJobQuery);
  return jobUri;
}

export async function getJob(jobOperationUri, creatorUri, relatedResource) {
  if (!jobOperationUri?.length) {
    return null;
  }

  const getJobStatusQuery = `
    ${PREFIXES}
    SELECT distinct ?status {
      GRAPH ?g {
        ?jobUri a ${sparqlEscapeUri(JOB_TYPE)} ;
          dct:creator ${sparqlEscapeUri(creatorUri)} ;
          task:operation ${sparqlEscapeUri(jobOperationUri)} ;
          ext:relatedTo ${sparqlEscapeUri(relatedResource)} ;
          adms:status ?status .
      }
    }`;

  const result = await query(getJobStatusQuery);
  if (result.results.bindings.length !== 1) {
    return null;
  }

  switch (result.results.bindings[0].status.value) {
    case STATUS_SCHEDULED:
    case STATUS_BUSY:
      return "busy";
    case STATUS_SUCCESS:
      return "success";
    case STATUS_FAILED:
      return "failed";
    case STATUS_CANCELED:
      return "canceled";
    default:
      return null;
  }
}

async function storeError(jobsGraph, errorCreatorUri, errorMessage) {
  const errorId = uuid();
  const errorUri = ERROR_URI_PREFIX + errorId;
  const createErrorQuery = `
    ${PREFIXES}
    INSERT DATA {
      GRAPH ${sparqlEscapeUri(jobsGraph)} {
        ${sparqlEscapeUri(errorUri)} a ${sparqlEscapeUri(ERROR_TYPE)} ;
          mu:uuid ${sparqlEscapeString(errorId)} ;
          dct:subject "BPMN Service error" ;
          oslc:message ${sparqlEscapeString(errorMessage)} ;
          dct:created ${sparqlEscapeDateTime(new Date().toISOString())} ;
          dct:creator ${sparqlEscapeUri(errorCreatorUri)} .
      }
    }`;

  await update(createErrorQuery);
}

async function updateStatusJob(jobsGraph, jobUri, status) {
  const modified = new Date();
  const updateStatusJobQuery = `
    ${PREFIXES}
    DELETE {
      GRAPH ?g {
        ?job adms:status ?status ;
          dct:modified ?modified .
      }
    }
    WHERE {
      GRAPH ?g {
        BIND(${sparqlEscapeUri(jobUri)} AS ?job)
        ?job a ${sparqlEscapeUri(JOB_TYPE)} ;
          adms:status ?status ;
          dct:modified ?modified .
      }
    }
    ;
    INSERT DATA {
      GRAPH ${sparqlEscapeUri(jobsGraph)} {
        ${sparqlEscapeUri(jobUri)} adms:status ${sparqlEscapeUri(status)} ;
          dct:modified ${sparqlEscapeDateTime(modified)} .
      }
    }`;

  await update(updateStatusJobQuery);
}

export async function runAsyncJob(
  jobsGraph,
  jobOperation,
  creatorUri,
  relatedResource,
  asyncFunc = async () => {}
) {
  try {
    const jobUri = await createJob(
      jobsGraph,
      creatorUri,
      jobOperation,
      relatedResource
    );
    await asyncFunc();
    await updateStatusJob(jobsGraph, jobUri, STATUS_SUCCESS);
  } catch (error) {
    console.error(
      `Error while scheduling job ${jobOperation}: ${error.message}`
    );
    console.error(error);
    await storeError(jobsGraph, creatorUri, error.message);
    await updateStatusJob(jobsGraph, jobUri, STATUS_FAILED);
  }
}
