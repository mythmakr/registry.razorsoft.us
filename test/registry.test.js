import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

function publicManifest(overrides = {}) {
  return {
    contract: "razorsoft.registry.publication",
    contractVersion: 1,
    registryHost: "registry.razorsoft.us",
    item: {
      name: "tracewise-status-badge",
      type: "registry:component",
      title: "Status Badge",
      description: "A public status badge.",
      dependencies: ["@razorsoft/tracewise-status@^0.1.1"],
      files: [
        {
          path: "registry/default/tracewise-status-badge/tracewise-status-badge.tsx",
          content: "export { StatusBadge } from \"@razorsoft/tracewise-status\";\n",
        },
      ],
    },
    source: {
      mode: "public-manifest",
      sourceUrl: "https://www.tracewise.dev/r/tracewise-status-badge.json",
      contentDigest: "ab".repeat(32),
      version: "0.1.5",
    },
    ...overrides,
  };
}

test("public-manifest provenance does not require a repository or commit", async () => {
  const missingSha = validatePublication(publication({ source: { repositoryUrl, version: "1.0.0" } }));
  assert.equal(missingSha.ok, false);
  assert.match(missingSha.error, /40-character SHA/);

  const invented = validatePublication(
    publicManifest({
      source: {
        mode: "public-manifest",
        sourceUrl: "https://www.tracewise.dev/r/tracewise-status-badge.json",
        contentDigest: "ab".repeat(32),
        version: "0.1.5",
        commitSha: "a".repeat(40),
      },
    }),
  );
  assert.equal(invented.ok, false);
  assert.match(invented.error, /cannot include repository provenance/);

  const validated = validatePublication(publicManifest());
  assert.equal(validated.ok, true);
  assert.equal(validated.snapshot.item.name, "tracewise-status-badge");
  assert.equal(validated.snapshot.sourceUrl, "https://www.tracewise.dev/r/tracewise-status-badge.json");
  assert.equal(validated.snapshot.contentDigest, "ab".repeat(32));
  assert.equal(JSON.stringify(validated.snapshot).includes("repositoryUrl"), false);
  assert.equal(JSON.stringify(validated.snapshot).includes("commitSha"), false);
  assert.equal(containsPrivateKey(validated.snapshot), false);

  const store = createMemoryCatalogStore();
  const env = { REGISTRY_PUBLISH_TOKEN: token };
  const headers = { authorization: `Bearer ${token}` };
  const denied = await handlePublication({ method: "POST", headers: {}, body: publicManifest() }, env, store);
  assert.equal(denied.status, 401);
  const first = await handlePublication({ method: "POST", headers, body: publicManifest() }, env, store);
  const second = await handlePublication({ method: "POST", headers, body: publicManifest() }, env, store);
  const changed = await handlePublication(
    {
      method: "POST",
      headers,
      body: publicManifest({
        source: {
          mode: "public-manifest",
          sourceUrl: "https://www.tracewise.dev/r/tracewise-status-badge.json",
          contentDigest: "cd".repeat(32),
          version: "0.1.5",
        },
      }),
    },
    env,
    store,
  );
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.idempotent, true);
  assert.equal(changed.status, 409);
  const catalog = await store.readCatalog();
  const item = renderItem(catalog, "tracewise-status-badge");
  assert.equal(item.name, "tracewise-status-badge");
  assert.equal(JSON.stringify(item).includes("tracewise.dev"), false);
  assert.equal(JSON.stringify(item).includes("contentDigest"), false);
  const rolled = await handleRollback(
    { method: "POST", headers, body: { name: "tracewise-status-badge", version: "0.1.5" } },
    env,
    store,
  );
  assert.equal(rolled.body.idempotent, true);
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

function catalogRecord(versions, current) {
  return {
    current,
    versions: Object.fromEntries(versions.map((version) => [version.version, version])),
  };
}

function storedVersion(name, version, title) {
  return {
    version,
    publishedAt: "2026-10-23T00:00:00.000Z",
    hash: "a".repeat(64),
    item: {
      $schema: "https://ui.shadcn.com/schema/registry-item.json",
      name,
      type: "registry:component",
      title,
      description: `${title} description`,
      dependencies: ["@razorsoft/example@1.0.0"],
      files: [
        {
          path: `registry/${name}.tsx`,
          type: "registry:component",
          content: `export const value = ${JSON.stringify(version)};\n`,
        },
      ],
    },
  };
}

async function buildFixture(catalog) {
  const directory = await mkdtemp(path.join(tmpdir(), "registry-"));
  const catalogPath = path.join(directory, "catalog.json");
  const output = path.join(directory, "public");
  const source = `${JSON.stringify(catalog, null, 2)}\n`;
  await writeFile(catalogPath, source);
  const index = await buildPublicRegistry(catalogPath, output);
  assert.equal(await readFile(catalogPath, "utf8"), source);
  const written = JSON.parse(await readFile(path.join(output, "registry.json"), "utf8"));
  assert.equal(written.name, "registry.razorsoft.us");
  assert.deepEqual(written.items, index.items);
  assert.equal(containsPrivateKey(written), false);
  return { output, index, written };
}

async function readBuiltItem(output, name, version) {
  const currentPath = path.join(output, `${name}.json`);
  const versionPath = path.join(output, name, `${version}.json`);
  return {
    current: JSON.parse(await readFile(currentPath, "utf8")),
    version: JSON.parse(await readFile(versionPath, "utf8")),
  };
}

test("production build reads the committed catalog without changing it", async () => {
  const catalogPath = path.join(root, "data", "catalog.json");
  const before = await readFile(catalogPath, "utf8");
  const catalog = JSON.parse(before);
  const output = await mkdtemp(path.join(tmpdir(), "registry-"));
  const index = await buildPublicRegistry(catalogPath, output);
  assert.equal(await readFile(catalogPath, "utf8"), before);

  const badge = catalog.items["tracewise-status-badge"];
  assert.equal(badge.current, "0.1.5");
  assert.deepEqual(index, renderIndex(catalog));
  assert.ok(index.items.some((item) => item.name === "tracewise-status-badge"));
  for (const entry of index.items) {
    const currentVersion = catalog.items[entry.name].current;
    const built = await readBuiltItem(output, entry.name, currentVersion);
    assert.deepEqual(built.current, renderItem(catalog, entry.name));
    assert.deepEqual(built.version, renderItem(catalog, entry.name, currentVersion));
    assert.equal(containsPrivateKey(built.current), false);
    assert.equal(JSON.stringify(built.current).includes("github.com"), false);
    assert.equal(JSON.stringify(built.current).includes("sourceUrl"), false);
    assert.equal(JSON.stringify(built.current).includes("contentDigest"), false);
  }
  const builtBadge = await readBuiltItem(output, "tracewise-status-badge", "0.1.5");
  assert.deepEqual(builtBadge.current.dependencies, ["@razorsoft/tracewise-status@^0.1.1"]);
  assert.match(builtBadge.current.files[0].content, /from "@razorsoft\/tracewise-status"/);
});

test("production build renders an empty catalog", async () => {
  const { index } = await buildFixture(emptyCatalog());
  assert.deepEqual(index.items, []);
});

test("production build renders one component and its current snapshot", async () => {
  const version = storedVersion("status-badge", "1.0.0", "Status Badge");
  const { output, index } = await buildFixture({
    items: { "status-badge": catalogRecord([version], "1.0.0") },
  });
  assert.deepEqual(
    index.items.map((item) => item.name),
    ["status-badge"],
  );
  const built = await readBuiltItem(output, "status-badge", "1.0.0");
  assert.equal(built.current.title, "Status Badge");
  assert.deepEqual(built.version, built.current);
  assert.equal(built.current.files[0].content.includes("1.0.0"), true);
});

test("production build renders multiple components in name order", async () => {
  const first = storedVersion("alpha-card", "1.0.0", "Alpha Card");
  const second = storedVersion("zeta-badge", "2.0.0", "Zeta Badge");
  const { index } = await buildFixture({
    items: {
      "zeta-badge": catalogRecord([second], "2.0.0"),
      "alpha-card": catalogRecord([first], "1.0.0"),
    },
  });
  assert.deepEqual(
    index.items.map((item) => item.name),
    ["alpha-card", "zeta-badge"],
  );
  assert.deepEqual(
    index.items.map((item) => item.title),
    ["Alpha Card", "Zeta Badge"],
  );
});

test("production build keeps every version and serves the selected current snapshot", async () => {
  const older = storedVersion("status-badge", "1.0.0", "Status Badge");
  const newer = storedVersion("status-badge", "1.1.0", "Status Badge 2");
  const catalog = { items: { "status-badge": catalogRecord([older, newer], "1.0.0") } };
  const { output, index } = await buildFixture(catalog);
  assert.equal(index.items[0].title, "Status Badge");
  const current = await readBuiltItem(output, "status-badge", "1.0.0");
  const newerBuilt = JSON.parse(await readFile(path.join(output, "status-badge", "1.1.0.json"), "utf8"));
  assert.equal(current.current.title, "Status Badge");
  assert.equal(current.version.files[0].content.includes("1.0.0"), true);
  assert.equal(newerBuilt.title, "Status Badge 2");
  assert.equal(newerBuilt.files[0].content.includes("1.1.0"), true);
});

test("production build follows a rollback without deleting retained snapshots", async () => {
  const first = validatePublication(publication());
  const second = validatePublication(
    publication({
      item: { ...publication().item, title: "Status Badge 2" },
      source: { ...publication().source, version: "1.1.0" },
    }),
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const published = applyPublication(emptyCatalog(), first.snapshot, "2026-10-22T00:00:00.000Z");
  const updated = applyPublication(published.catalog, second.snapshot, "2026-10-22T01:00:00.000Z");
  const rolled = rollbackPublication(updated.catalog, "status-badge", "1.0.0");
  assert.equal(rolled.ok, true);
  assert.equal(rolled.catalog.items["status-badge"].current, "1.0.0");
  assert.ok(rolled.catalog.items["status-badge"].versions["1.1.0"]);

  const { output, index } = await buildFixture(rolled.catalog);
  assert.equal(index.items[0].title, "Status Badge");
  const current = await readBuiltItem(output, "status-badge", "1.0.0");
  const retained = JSON.parse(await readFile(path.join(output, "status-badge", "1.1.0.json"), "utf8"));
  assert.equal(current.current.title, "Status Badge");
  assert.equal(retained.title, "Status Badge 2");
  assert.equal(containsPrivateKey(current.current), false);
  assert.equal(JSON.stringify(current.current).includes(repositoryUrl), false);
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
