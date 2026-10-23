import { REGISTRY_ORIGIN, applyPublication, authorizePublication, renderIndex, renderItem, rollbackPublication, validatePublication } from "./catalog.js";

const REGISTRY_REPOSITORY = "mythmakr/registry.razorsoft.us";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

export function readJsonBody(request) {
  if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString("utf8"));
  if (typeof request.body === "string") return JSON.parse(request.body);
  if (request.body && typeof request.body === "object") return request.body;
  return null;
}

export function publicHeaders() {
  return { ...JSON_HEADERS, "cache-control": "public, max-age=60" };
}

export function privateHeaders() {
  return { ...JSON_HEADERS, "cache-control": "no-store" };
}

function publicationConfigured(env) {
  return typeof env.REGISTRY_PUBLISH_TOKEN === "string" && env.REGISTRY_PUBLISH_TOKEN.length >= 16;
}

function unauthorized() {
  return { status: 401, headers: privateHeaders(), body: { error: "Publication authentication is required." } };
}

function requirePublisher(request, env) {
  if (!publicationConfigured(env)) {
    return {
      status: 503,
      headers: privateHeaders(),
      body: { error: "Publication storage is not configured." },
    };
  }
  if (!authorizePublication(request.headers?.authorization, env.REGISTRY_PUBLISH_TOKEN)) return unauthorized();
  return null;
}

export function handleRegistryGet(request, catalog) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return { status: 405, headers: publicHeaders(), body: { error: "Method not allowed." } };
  }
  const name = request.query?.name;
  if (!name) return { status: 200, headers: publicHeaders(), body: renderIndex(catalog) };
  const item = renderItem(catalog, name, request.query?.version);
  if (!item) return { status: 404, headers: publicHeaders(), body: { error: "That registry item is not published." } };
  return { status: 200, headers: publicHeaders(), body: item };
}

function acceptedReceipt(applied, commitSha) {
  if (typeof commitSha !== "string" || !/^[0-9a-f]{40}$/.test(commitSha) || typeof applied.hash !== "string") return null;
  return {
    status: "accepted",
    name: applied.name,
    version: applied.version,
    idempotent: applied.idempotent,
    url: `${REGISTRY_ORIGIN}/r/${applied.name}.json`,
    versionUrl: `${REGISTRY_ORIGIN}/r/${applied.name}/${applied.version}.json`,
    contentHash: applied.hash,
    registryCommitSha: commitSha,
    deployment: {
      provider: "vercel",
      repository: REGISTRY_REPOSITORY,
      commitSha,
    },
  };
}

export async function handlePublication(request, env, store, now = () => new Date()) {
  if (request.method !== "POST") {
    return { status: 405, headers: privateHeaders(), body: { error: "Method not allowed." } };
  }
  const denied = requirePublisher(request, env);
  if (denied) return denied;
  let body;
  try {
    body = readJsonBody(request);
  } catch {
    return { status: 400, headers: privateHeaders(), body: { error: "The publication body must be JSON." } };
  }
  const validated = validatePublication(body);
  if (!validated.ok) return { status: validated.status, headers: privateHeaders(), body: { error: validated.error } };
  const current = await store.readCatalog();
  const applied = applyPublication(current, validated.snapshot, now().toISOString());
  if (!applied.ok) return { status: applied.status, headers: privateHeaders(), body: { error: applied.error } };
  const recorded = applied.idempotent ? await store.headCommit() : await store.writeCatalog(applied.catalog);
  const receipt = acceptedReceipt(applied, recorded?.commitSha);
  if (!receipt) {
    return { status: 500, headers: privateHeaders(), body: { error: "The registry did not record a commit." } };
  }
  return {
    status: applied.status,
    headers: privateHeaders(),
    body: receipt,
  };
}

export async function handleRollback(request, env, store) {
  if (request.method !== "POST") {
    return { status: 405, headers: privateHeaders(), body: { error: "Method not allowed." } };
  }
  const denied = requirePublisher(request, env);
  if (denied) return denied;
  let body;
  try {
    body = readJsonBody(request);
  } catch {
    return { status: 400, headers: privateHeaders(), body: { error: "The rollback body must be JSON." } };
  }
  const current = await store.readCatalog();
  const rolled = rollbackPublication(current, body?.name, body?.version);
  if (!rolled.ok) return { status: rolled.status, headers: privateHeaders(), body: { error: rolled.error } };
  if (!rolled.idempotent) await store.writeCatalog(rolled.catalog);
  return {
    status: rolled.status,
    headers: privateHeaders(),
    body: {
      status: "rolled-back",
      name: rolled.name,
      version: rolled.version,
      idempotent: rolled.idempotent,
      url: `https://registry.razorsoft.us/r/${rolled.name}.json`,
    },
  };
}

export function sendResult(response, result) {
  response.statusCode = result.status;
  for (const [key, value] of Object.entries(result.headers)) response.setHeader(key, value);
  response.end(JSON.stringify(result.body));
}
