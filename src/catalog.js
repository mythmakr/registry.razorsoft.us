// @ts-nocheck
import { createHash, timingSafeEqual } from "node:crypto";

export const REGISTRY_HOST = "registry.razorsoft.us";
export const REGISTRY_ORIGIN = "https://registry.razorsoft.us";
export const REGISTRY_CONTRACT = "razorsoft.registry.publication";
export const REGISTRY_CONTRACT_VERSION = 1;
export const FILE_BYTE_LIMIT = 200_000;
export const MANIFEST_BYTE_LIMIT = 1_000_000;

const ITEM_TYPES = new Set([
  "registry:component",
  "registry:ui",
  "registry:lib",
  "registry:hook",
  "registry:block",
  "registry:file",
]);

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

const PRIVATE_KEYS = new Set([
  "repositoryurl",
  "repository",
  "sourcepath",
  "sourcefiles",
  "githuburl",
  "github_url",
  "commitsha",
  "commit",
]);

export function emptyCatalog() {
  return { items: {} };
}

export function authorizePublication(authorizationHeader, expectedToken) {
  if (typeof expectedToken !== "string" || expectedToken.length < 16) return false;
  const header = typeof authorizationHeader === "string" ? authorizationHeader : "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return false;
  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function publicationError(status, error) {
  return { ok: false, status, error };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function assertPublicText(value, label) {
  const text = String(value).toLowerCase();
  if (text.includes("github.com") || text.includes("repositoryurl") || text.includes("sourcepath")) {
    return `${label} cannot include private repository information.`;
  }
  return null;
}

function publicStringList(value, label) {
  if (value === undefined) return { values: undefined };
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    return { error: `${label} must be a list of strings.` };
  }
  const values = value.map((item) => item.trim());
  for (const item of values) {
    const leak = assertPublicText(item, label);
    if (leak) return { error: leak };
  }
  return { values };
}

export function validatePublication(body) {
  if (!isObject(body)) return publicationError(400, "The publication body must be a JSON object.");
  if (byteLength(JSON.stringify(body)) > MANIFEST_BYTE_LIMIT) {
    return publicationError(413, "The publication is too large.");
  }
  if (body.contract !== REGISTRY_CONTRACT || body.contractVersion !== REGISTRY_CONTRACT_VERSION) {
    return publicationError(400, "The publication contract is not recognized.");
  }
  if (body.registryHost !== REGISTRY_HOST) {
    return publicationError(400, "The publication is for a different registry host.");
  }
  if (!isObject(body.item) || !isObject(body.source)) {
    return publicationError(400, "The publication needs an item and a source.");
  }

  const name = body.item.name;
  if (typeof name !== "string" || !NAME_PATTERN.test(name) || name === "registry") {
    return publicationError(400, "The item name is not a public registry slug.");
  }
  if (!ITEM_TYPES.has(body.item.type)) return publicationError(400, "The item type is not supported.");
  if (typeof body.item.title !== "string" || !body.item.title.trim()) {
    return publicationError(400, "The item title is required.");
  }
  const titleLeak = assertPublicText(body.item.title, "The item title");
  if (titleLeak) return publicationError(400, titleLeak);
  if (body.item.description !== undefined) {
    if (typeof body.item.description !== "string") return publicationError(400, "The item description must be text.");
    const descriptionLeak = assertPublicText(body.item.description, "The item description");
    if (descriptionLeak) return publicationError(400, descriptionLeak);
  }

  const lists = [
    publicStringList(body.item.dependencies, "dependencies"),
    publicStringList(body.item.devDependencies, "devDependencies"),
    publicStringList(body.item.registryDependencies, "registryDependencies"),
  ];
  for (const list of lists) {
    if (list.error) return publicationError(400, list.error);
  }
  if (!Array.isArray(body.item.files) || body.item.files.length === 0) {
    return publicationError(400, "The item needs at least one file.");
  }

  const files = [];
  for (const file of body.item.files) {
    if (!isObject(file) || typeof file.path !== "string" || typeof file.content !== "string") {
      return publicationError(400, "Each item file needs a path and content.");
    }
    if (file.path.startsWith("/") || file.path.split("/").some((part) => part === ".." || part === "")) {
      return publicationError(400, "An item file path is not publishable.");
    }
    const pathLeak = assertPublicText(file.path, "An item file path");
    if (pathLeak) return publicationError(400, pathLeak);
    if (byteLength(file.content) > FILE_BYTE_LIMIT) {
      return publicationError(413, "An item file is too large.");
    }
    files.push({
      path: file.path,
      type: body.item.type,
      content: file.content,
    });
  }

  const source = validateSource(body.source);
  if (!source.ok) return source;

  const item = {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name,
    type: body.item.type,
    title: body.item.title.trim(),
    files,
  };
  if (typeof body.item.description === "string" && body.item.description.trim()) {
    item.description = body.item.description.trim();
  }
  if (lists[0].values?.length) item.dependencies = lists[0].values;
  if (lists[1].values?.length) item.devDependencies = lists[1].values;
  if (lists[2].values?.length) item.registryDependencies = lists[2].values;

  const snapshot = {
    version: source.version,
    hash: createHash("sha256").update(canonical(item)).digest("hex"),
    item,
  };
  if (source.mode === "public-manifest") {
    snapshot.sourceUrl = source.sourceUrl;
    snapshot.contentDigest = source.contentDigest;
  }
  if (containsPrivateKey(snapshot)) {
    return publicationError(400, "The public snapshot still contains private repository information.");
  }
  return { ok: true, snapshot };
}

export function applyPublication(catalog, snapshot, publishedAt) {
  const next = structuredClone(catalog);
  const record = next.items[snapshot.item.name] ?? { current: null, versions: {} };
  const existing = record.versions[snapshot.version];
  if (existing) {
    const digestChanged =
      existing.contentDigest &&
      snapshot.contentDigest &&
      existing.contentDigest !== snapshot.contentDigest;
    if (existing.hash !== snapshot.hash || digestChanged) {
      return {
        ok: false,
        status: 409,
        error: "That version is already published with different content.",
      };
    }
    return {
      ok: true,
      status: 200,
      idempotent: true,
      catalog,
      name: snapshot.item.name,
      version: snapshot.version,
    };
  }
  record.versions[snapshot.version] = {
    version: snapshot.version,
    publishedAt,
    hash: snapshot.hash,
    item: snapshot.item,
    ...(snapshot.contentDigest
      ? { contentDigest: snapshot.contentDigest, sourceUrl: snapshot.sourceUrl }
      : {}),
  };
  record.current = snapshot.version;
  next.items[snapshot.item.name] = record;
  return {
    ok: true,
    status: 201,
    idempotent: false,
    catalog: next,
    name: snapshot.item.name,
    version: snapshot.version,
  };
}

export function rollbackPublication(catalog, name, version) {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    return publicationError(400, "The item name is not a public registry slug.");
  }
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    return publicationError(400, "The rollback version must be semantic.");
  }
  const record = catalog.items[name];
  if (!record?.versions[version]) return publicationError(404, "That published snapshot does not exist.");
  if (record.current === version) {
    return { ok: true, status: 200, idempotent: true, catalog, name, version };
  }
  const next = structuredClone(catalog);
  next.items[name].current = version;
  return { ok: true, status: 200, idempotent: false, catalog: next, name, version };
}

export function renderIndex(catalog) {
  const items = Object.values(catalog.items)
    .map((record) => record.versions[record.current]?.item)
    .filter(Boolean)
    .map(indexEntry)
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    $schema: "https://ui.shadcn.com/schema/registry.json",
    name: REGISTRY_HOST,
    homepage: REGISTRY_ORIGIN,
    items,
  };
}

export function renderItem(catalog, name, version) {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) return null;
  const record = catalog.items[name];
  if (!record) return null;
  const selected = version ? record.versions[version] : record.versions[record.current];
  return selected ? selected.item : null;
}

export function containsPrivateKey(value) {
  if (Array.isArray(value)) return value.some(containsPrivateKey);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, child]) => PRIVATE_KEYS.has(key.toLowerCase()) || containsPrivateKey(child));
}

function validateSource(source) {
  if (!isObject(source)) return publicationError(400, "The publication source is required.");
  if (source.mode === "public-manifest") return validatePublicManifestSource(source);
  if (source.mode !== undefined && source.mode !== "repository") {
    return publicationError(400, "The publication source mode is not supported.");
  }
  if ("sourceUrl" in source || "contentDigest" in source) {
    return publicationError(400, "A repository publication cannot include public manifest provenance.");
  }
  const version = source.version;
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    return publicationError(400, "The publication version must be semantic.");
  }
  if (typeof source.commitSha !== "string" || !COMMIT_PATTERN.test(source.commitSha)) {
    return publicationError(400, "The publication commit is not a 40-character SHA.");
  }
  if (typeof source.repositoryUrl !== "string" || !source.repositoryUrl.trim()) {
    return publicationError(400, "The publication source repository is required.");
  }
  return { ok: true, mode: "repository", version };
}

function validatePublicManifestSource(source) {
  if ("repositoryUrl" in source || "commitSha" in source || "repository" in source || "commit" in source) {
    return publicationError(400, "A public manifest publication cannot include repository provenance.");
  }
  const version = source.version;
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    return publicationError(400, "The publication version must be semantic.");
  }
  let sourceUrl;
  try {
    sourceUrl = new URL(source.sourceUrl);
  } catch {
    return publicationError(400, "The public manifest source URL is not valid.");
  }
  const host = sourceUrl.hostname.toLowerCase();
  if (
    sourceUrl.protocol !== "https:" ||
    sourceUrl.username ||
    sourceUrl.password ||
    sourceUrl.port ||
    sourceUrl.search ||
    sourceUrl.hash ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "github.com" ||
    host.endsWith(".github.com") ||
    host.endsWith(".githubusercontent.com") ||
    netIsIp(host)
  ) {
    return publicationError(400, "The public manifest source URL is not an approved https URL.");
  }
  if (typeof source.contentDigest !== "string" || !DIGEST_PATTERN.test(source.contentDigest)) {
    return publicationError(400, "The public manifest content digest must be a sha256 hex digest.");
  }
  const leak = assertPublicText(sourceUrl.toString(), "The public manifest source");
  if (leak) return publicationError(400, leak);
  return {
    ok: true,
    mode: "public-manifest",
    version,
    sourceUrl: sourceUrl.toString(),
    contentDigest: source.contentDigest,
  };
}

function netIsIp(host) {
  if (host.startsWith("[") && host.endsWith("]")) return true;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function indexEntry(item) {
  const entry = { name: item.name, type: item.type, title: item.title };
  if (item.description) entry.description = item.description;
  return entry;
}

function canonical(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
