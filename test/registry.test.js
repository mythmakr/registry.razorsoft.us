import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPublicRegistry } from "../scripts/build-public.js";
import {
  applyPublication,
  authorizePublication,
  containsPrivateKey,
  emptyCatalog,
  renderIndex,
  renderItem,
  rollbackPublication,
  validatePublication,
} from "../src/catalog.js";
import { createGitHubCatalogStore } from "../src/github.js";
import { handlePublication, handleRegistryGet, handleRollback } from "../src/http.js";
import { createMemoryCatalogStore } from "../src/store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = "registry-publish-token";
const repositoryUrl = "https://github.com/mythmakr/private-product";

function publication(overrides = {}) {
  return {
    contract: "razorsoft.registry.publication",
    contractVersion: 1,
    registryHost: "registry.razorsoft.us",
    item: {
      name: "status-badge",
      type: "registry:component",
      title: "Status Badge",
      description: "A public status badge.",
      dependencies: ["@razorsoft/example@1.0.0"],
      files: [{ path: "registry/status-badge.tsx", content: "export const badge = true;\n" }],
    },
    source: {
      repositoryUrl,
      commitSha: "7891a157b069ca477aca05fce04d01d4e3405f9f",
      version: "1.0.0",
    },
    ...overrides,
  };
}

test("public index and component routes serve the current snapshot", () => {
  const validated = validatePublication(publication());
  assert.equal(validated.ok, true);
  const applied = applyPublication(emptyCatalog(), validated.snapshot, "2026-10-22T00:00:00.000Z");
  const index = handleRegistryGet({ method: "GET", query: {} }, applied.catalog);
  const item = handleRegistryGet({ method: "GET", query: { name: "status-badge" } }, applied.catalog);
  const version = handleRegistryGet({ method: "GET", query: { name: "status-badge", version: "1.0.0" } }, applied.catalog);
  const missing = handleRegistryGet({ method: "GET", query: { name: "missing" } }, applied.catalog);

  assert.equal(index.status, 200);
  assert.deepEqual(index.body.items, [
    { name: "status-badge", type: "registry:component", title: "Status Badge", description: "A public status badge." },
  ]);
  assert.equal(item.body.files[0].content, "export const badge = true;\n");
  assert.equal(version.body.name, "status-badge");
  assert.equal(missing.status, 404);
  assert.equal(containsPrivateKey(index.body), false);
  assert.equal(containsPrivateKey(item.body), false);
  assert.equal(JSON.stringify(item.body).includes(repositoryUrl), false);
  assert.equal(JSON.stringify(item.body).includes("commitSha"), false);
});

test("publication is idempotent and rejects a changed snapshot for the same version", async () => {
  const store = createMemoryCatalogStore();
  const env = { REGISTRY_PUBLISH_TOKEN: token };
  const request = { method: "POST", headers: { authorization: `Bearer ${token}` }, body: publication() };
  const first = await handlePublication(request, env, store, () => new Date("2026-10-22T00:00:00.000Z"));
  const second = await handlePublication(request, env, store, () => new Date("2026-10-22T01:00:00.000Z"));
  const changed = await handlePublication(
    { ...request, body: publication({ item: { ...publication().item, title: "Changed" } }) },
    env,
    store,
  );

  assert.equal(first.status, 201);
  assert.equal(first.body.idempotent, false);
  assert.equal(first.body.url, "https://registry.razorsoft.us/r/status-badge.json");
  assert.equal(JSON.stringify(first.body).includes(repositoryUrl), false);
  assert.equal(second.status, 200);
  assert.equal(second.body.idempotent, true);
  assert.equal(changed.status, 409);
  const catalog = await store.readCatalog();
  assert.equal(catalog.items["status-badge"].versions["1.0.0"].publishedAt, "2026-10-22T00:00:00.000Z");
  assert.equal(containsPrivateKey(catalog), false);
});

test("publication requires authentication and does not store a private repository", async () => {
  const store = createMemoryCatalogStore();
  const body = publication();
  const missing = await handlePublication({ method: "POST", headers: {}, body }, {}, store);
  const wrong = await handlePublication(
    { method: "POST", headers: { authorization: "Bearer wrong-token-value" }, body },
    { REGISTRY_PUBLISH_TOKEN: token },
    store,
  );
  const unauthenticated = await handlePublication(
    { method: "POST", headers: {}, body },
    { REGISTRY_PUBLISH_TOKEN: token },
    store,
  );

  assert.equal(missing.status, 503);
  assert.equal(wrong.status, 401);
  assert.equal(unauthenticated.status, 401);
  assert.equal(authorizePublication("Bearer short", "short"), false);
  assert.deepEqual(await store.readCatalog(), emptyCatalog());
});

test("rollback restores an older snapshot without deleting versions", async () => {
  const store = createMemoryCatalogStore();
  const env = { REGISTRY_PUBLISH_TOKEN: token };
  const headers = { authorization: `Bearer ${token}` };
  await handlePublication({ method: "POST", headers, body: publication() }, env, store);
  await handlePublication(
    {
      method: "POST",
      headers,
      body: publication({
        item: { ...publication().item, title: "Status Badge 2" },
        source: { ...publication().source, version: "1.1.0" },
      }),
    },
    env,
    store,
  );
  const rolled = await handleRollback({ method: "POST", headers, body: { name: "status-badge", version: "1.0.0" } }, env, store);
  const again = await handleRollback({ method: "POST", headers, body: { name: "status-badge", version: "1.0.0" } }, env, store);
  const missing = await handleRollback({ method: "POST", headers, body: { name: "status-badge", version: "9.0.0" } }, env, store);
  const denied = await handleRollback({ method: "POST", headers: {}, body: { name: "status-badge", version: "1.1.0" } }, env, store);

  assert.equal(rolled.status, 200);
  assert.equal(rolled.body.idempotent, false);
  assert.equal(again.body.idempotent, true);
  assert.equal(missing.status, 404);
  assert.equal(denied.status, 401);
  const catalog = await store.readCatalog();
  assert.equal(catalog.items["status-badge"].current, "1.0.0");
  assert.equal(renderItem(catalog, "status-badge").title, "Status Badge");
  assert.ok(catalog.items["status-badge"].versions["1.1.0"]);
  assert.equal(renderIndex(catalog).items[0].title, "Status Badge");
});

test("validation rejects an incomplete contract", () => {
  const invalid = validatePublication({ contract: "other" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 400);
  const leaked = validatePublication(publication({ item: { ...publication().item, description: repositoryUrl } }));
  assert.equal(leaked.ok, false);
});

test("github storage refuses private repository fields", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "PUT") return { ok: true, status: 201, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const store = createGitHubCatalogStore({
    token: "github-token",
    repository: "mythmakr/registry.razorsoft.us",
    fetchImpl,
  });
  const validated = validatePublication(publication());
  const applied = applyPublication(emptyCatalog(), validated.snapshot, "2026-10-22T00:00:00.000Z");
  await store.writeCatalog(applied.catalog);
  const put = calls.find((call) => call.options.method === "PUT");
  const stored = JSON.parse(Buffer.from(JSON.parse(put.options.body).content, "base64").toString("utf8"));
  assert.equal(containsPrivateKey(stored), false);
  assert.equal(JSON.stringify(stored).includes(repositoryUrl), false);
  await assert.rejects(() => store.writeCatalog({ items: {}, repositoryUrl }));
});

test("production build writes the empty public index", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "registry-"));
  const index = await buildPublicRegistry(path.join(root, "data", "catalog.json"), output);
  const written = JSON.parse(await readFile(path.join(output, "registry.json"), "utf8"));
  assert.deepEqual(index.items, []);
  assert.equal(written.name, "registry.razorsoft.us");
  assert.deepEqual(written.items, []);
});

test("rollback without a publisher token does not change the catalog", async () => {
  const store = createMemoryCatalogStore();
  const result = await handleRollback(
    { method: "POST", headers: { authorization: `Bearer ${token}` }, body: { name: "status-badge", version: "1.0.0" } },
    {},
    store,
  );
  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result.body).includes(repositoryUrl), false);
});
