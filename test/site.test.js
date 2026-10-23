import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPublicRegistry, buildPublicSite } from "../scripts/build-public.js";
import { applyPublication, emptyCatalog, renderIndex, rollbackPublication, validatePublication } from "../src/catalog.js";
import {
  compareVersionsDescending,
  componentCountLabel,
  filterComponents,
  listPublishedComponents,
} from "../src/catalog-view.js";
import { renderSite } from "../src/site.js";

const sentinel = "SENTINEL_FILE_CONTENT_SHOULD_NOT_RENDER";
const sourceUrl = "https://www.tracewise.dev/r/tracewise-status-badge.json";
const contentDigest = "27e7f1228d8d0204bf03488fd2c1d4f6e66b0028eaf5641f9736a2c47e8ebb3e";

function catalogFrom(definitions) {
  const items = {};
  for (const definition of definitions) {
    const versions = {};
    for (const version of definition.versions) {
      versions[version.version] = {
        version: version.version,
        publishedAt: version.publishedAt || "2026-10-23T00:00:00.000Z",
        hash: version.hash || "ab".repeat(32),
        ...(version.sourceUrl ? { sourceUrl: version.sourceUrl, contentDigest: version.contentDigest || "cd".repeat(32) } : {}),
        item: {
          name: definition.name,
          type: version.type || definition.type || "registry:component",
          title: version.title || definition.title,
          description: version.description || definition.description || "",
          dependencies: version.dependencies || definition.dependencies || [],
          files: version.files || definition.files,
        },
      };
    }
    items[definition.name] = { current: definition.current, versions };
  }
  return { items };
}

function reactBadge(overrides = {}) {
  return {
    name: "tracewise-status-badge",
    title: "TraceWise Status Badge",
    description:
      'Compact live status badge. React component from @razorsoft/tracewise-status. The same badge is in @razorsoft/tracewise-status-js and the HTML embed. <script>alert("x")</script>',
    dependencies: ["@razorsoft/tracewise-status@^0.1.1"],
    current: "0.1.5",
    files: [
      {
        path: "registry/default/tracewise-status-badge/tracewise-status-badge.tsx",
        type: "registry:component",
        content: sentinel,
      },
    ],
    versions: [
      {
        version: "0.1.5",
        publishedAt: "2026-10-23T10:34:50.047Z",
        sourceUrl,
        contentDigest,
      },
    ],
    ...overrides,
  };
}

function page(pages, relativePath) {
  const html = pages.get(relativePath);
  assert.ok(html, `missing ${relativePath}`);
  return html;
}

function assertNoProvenance(html) {
  assert.equal(html.includes(sourceUrl), false);
  assert.equal(html.includes(contentDigest), false);
  assert.equal(html.includes(sentinel), false);
  assert.equal(html.includes("github.com"), false);
  assert.equal(html.includes("repositoryUrl"), false);
  assert.equal(html.includes("commitSha"), false);
  assert.equal(html.includes("contentDigest"), false);
}

test("empty catalog renders a catalog without placeholder components", () => {
  const pages = renderSite(emptyCatalog());
  const home = page(pages, "index.html");
  const catalog = page(pages, "components/index.html");
  assert.match(home, /No components are published yet/);
  assert.match(catalog, /No components are published yet/);
  assert.match(home, /PeerKit/);
  assert.match(home, /Formlyx/);
  assert.match(home, /CauseWise/);
  assert.match(home, /No published components/);
  assert.equal(home.includes("tracewise-status-badge"), false);
  assert.equal(home.includes("/products/peerkit"), false);
  assert.equal(home.includes("/products/formlyx"), false);
  assert.equal(home.includes("/products/causewise"), false);
  assert.match(home, /npx shadcn@latest add https:\/\/registry\.razorsoft\.us\/r\/&lt;component&gt;\.json/);
  assert.equal([...pages.keys()].some((name) => name.startsWith("products/")), false);
  assert.equal([...pages.keys()].some((name) => name.startsWith("components/") && name !== "components/index.html"), false);
});

test("single component page is generated from the catalog record", () => {
  const pages = renderSite(catalogFrom([reactBadge()]));
  const detail = page(pages, "components/tracewise-status-badge/index.html");
  assert.match(detail, /TraceWise Status Badge/);
  assert.match(detail, /October 23, 2026/);
  assert.match(detail, /npx shadcn@latest add https:\/\/registry\.razorsoft\.us\/r\/tracewise-status-badge\.json/);
  assert.match(detail, /https:\/\/registry\.razorsoft\.us\/r\/tracewise-status-badge\.json/);
  assert.match(detail, /https:\/\/registry\.razorsoft\.us\/r\/tracewise-status-badge\/0\.1\.5\.json/);
  assert.match(detail, /@razorsoft\/tracewise-status@\^0\.1\.1/);
  assert.match(detail, /https:\/\/www\.npmjs\.com\/package\/@razorsoft\/tracewise-status/);
  assert.match(detail, /https:\/\/www\.tracewise\.dev\/docs\/components/);
  assert.match(detail, /https:\/\/www\.tracewise\.dev\/#components/);
  assert.match(detail, /https:\/\/www\.tracewise\.dev\//);
  assert.match(detail, /React \/ shadcn/);
  assert.match(detail, /Installing it requires a React project/);
  assert.match(detail, /do not mean the product requires React for every use/);
  assert.match(detail, /@razorsoft\/tracewise-status-js/);
  assert.match(detail, /HTML embed/);
  assert.match(detail, /This registry item/);
  assert.match(detail, /Separate integration/);
  assert.match(detail, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.equal(detail.includes('<script>alert("x")</script>'), false);
  assertNoProvenance(detail);
  assert.match(page(pages, "products/tracewise/index.html"), /TraceWise Status Badge/);
  assert.equal(pages.has("products/peerkit/index.html"), false);
});

test("multiple components stay in name order and keep product filters", () => {
  const catalog = catalogFrom([
    {
      name: "zeta-badge",
      title: "Zeta Badge",
      description: "Second component",
      current: "2.0.0",
      files: [{ path: "registry/zeta-badge.tsx", content: sentinel }],
      versions: [{ version: "2.0.0" }],
    },
    reactBadge(),
    {
      name: "peerkit-channel",
      type: "registry:lib",
      title: "PeerKit Channel",
      description: "A framework-agnostic channel client.",
      current: "1.0.0",
      files: [{ path: "registry/peerkit-channel.js", content: "export const channel = true;\n" }],
      versions: [{ version: "1.0.0" }],
    },
  ]);
  const components = listPublishedComponents(catalog);
  assert.deepEqual(
    components.map((component) => component.name),
    ["peerkit-channel", "tracewise-status-badge", "zeta-badge"],
  );
  assert.deepEqual(
    renderIndex(catalog).items.map((item) => item.name),
    components.map((component) => component.name),
  );
  const pages = renderSite(catalog);
  const catalogPage = page(pages, "components/index.html");
  const peerkitAt = catalogPage.indexOf("peerkit-channel");
  const tracewiseAt = catalogPage.indexOf("tracewise-status-badge");
  const zetaAt = catalogPage.indexOf("zeta-badge");
  assert.ok(peerkitAt < tracewiseAt && tracewiseAt < zetaAt);
  assert.match(catalogPage, /All \(3\)/);
  assert.match(catalogPage, /TraceWise \(1\)/);
  assert.match(catalogPage, /PeerKit \(1\)/);
  assert.match(catalogPage, /href="\/products\/tracewise"/);
  assert.match(catalogPage, /href="\/products\/peerkit"/);
  assert.equal(catalogPage.includes("/products/formlyx"), false);
  assert.match(catalogPage, /No published components/);
  const tracewisePage = page(pages, "products/tracewise/index.html");
  assert.match(tracewisePage, /tracewise-status-badge/);
  assert.equal(tracewisePage.includes("peerkit-channel"), false);
  assert.match(tracewisePage, /PeerKit \(1\)/);
  const javascriptPage = page(pages, "components/peerkit-channel/index.html");
  assert.match(javascriptPage, /does not require React/);
  assert.equal(javascriptPage.includes("Installing it requires a React project"), false);
  assert.match(javascriptPage, /https:\/\/peerkit\.dev\//);
});

test("multiple versions list the newest snapshot first and mark the current version", () => {
  const catalog = catalogFrom([
    {
      name: "tracewise-status-badge",
      title: "TraceWise Status Badge",
      description: "Versioned badge",
      current: "1.2.0",
      files: [{ path: "registry/badge.tsx", content: sentinel }],
      versions: [
        { version: "1.0.0", title: "Status Badge 1", publishedAt: "2026-01-01T00:00:00.000Z" },
        { version: "1.10.0", title: "Status Badge 10", publishedAt: "2026-03-01T00:00:00.000Z" },
        { version: "1.2.0", title: "Status Badge 2", publishedAt: "2026-02-01T00:00:00.000Z" },
        { version: "1.2.0-beta", title: "Status Badge Beta", publishedAt: "2026-01-15T00:00:00.000Z" },
      ],
    },
  ]);
  const [component] = listPublishedComponents(catalog);
  assert.deepEqual(
    component.versions.map((version) => version.version),
    ["1.10.0", "1.2.0", "1.2.0-beta", "1.0.0"],
  );
  assert.equal(component.currentVersion, "1.2.0");
  assert.equal(component.versions.find((version) => version.current)?.version, "1.2.0");
  const detail = page(renderSite(catalog), "components/tracewise-status-badge/index.html");
  assert.match(detail, /Current version/);
  assert.match(detail, />1\.2\.0 <span class="badge">Current<\/span>/);
  assert.ok(detail.indexOf('id="install-1-10-0"') < detail.indexOf('id="install-1-2-0"'));
  assert.ok(detail.indexOf('id="install-1-2-0"') < detail.indexOf('id="install-1-2-0-beta"'));
  assert.ok(detail.indexOf('id="install-1-2-0-beta"') < detail.indexOf('id="install-1-0-0"'));
  assert.match(detail, /npx shadcn@latest add https:\/\/registry\.razorsoft\.us\/r\/tracewise-status-badge\.json/);
  assert.match(detail, /npx shadcn@latest add https:\/\/registry\.razorsoft\.us\/r\/tracewise-status-badge\/1\.0\.0\.json/);
});

test("current-version selection follows the catalog current pointer", () => {
  const catalog = catalogFrom([
    {
      name: "tracewise-status-card",
      title: "Ignored",
      current: "1.0.0",
      files: [{ path: "registry/card.tsx", content: sentinel }],
      versions: [
        { version: "1.0.0", title: "Status Card" },
        { version: "1.1.0", title: "Status Card Next" },
      ],
    },
  ]);
  const [component] = listPublishedComponents(catalog);
  assert.equal(component.title, "Status Card");
  assert.equal(component.currentVersion, "1.0.0");
  const detail = page(renderSite(catalog), "components/tracewise-status-card/index.html");
  assert.match(detail, /<h1>Status Card<\/h1>/);
  assert.match(detail, /installs the current published version, 1\.0\.0/);
  assert.match(detail, /Status Card Next/);
  assert.match(detail, /1\.0\.0 <span class="badge">Current<\/span>/);
});

test("rollback keeps the restored snapshot current and retains the newer version", () => {
  const first = validatePublication({
    contract: "razorsoft.registry.publication",
    contractVersion: 1,
    registryHost: "registry.razorsoft.us",
    item: {
      name: "tracewise-status-badge",
      type: "registry:component",
      title: "Status Badge",
      description: "First release",
      files: [{ path: "registry/badge.tsx", content: `${sentinel}-old` }],
    },
    source: {
      mode: "public-manifest",
      sourceUrl,
      contentDigest,
      version: "1.0.0",
    },
  });
  const second = validatePublication({
    contract: "razorsoft.registry.publication",
    contractVersion: 1,
    registryHost: "registry.razorsoft.us",
    item: {
      name: "tracewise-status-badge",
      type: "registry:component",
      title: "Status Badge Next",
      description: "Second release",
      files: [{ path: "registry/badge.tsx", content: `${sentinel}-new` }],
    },
    source: {
      mode: "public-manifest",
      sourceUrl,
      contentDigest: "aa".repeat(32),
      version: "1.1.0",
    },
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const published = applyPublication(emptyCatalog(), first.snapshot, "2026-10-22T00:00:00.000Z");
  const updated = applyPublication(published.catalog, second.snapshot, "2026-10-23T00:00:00.000Z");
  const rolled = rollbackPublication(updated.catalog, "tracewise-status-badge", "1.0.0");
  assert.equal(rolled.ok, true);
  const [component] = listPublishedComponents(rolled.catalog);
  assert.equal(component.title, "Status Badge");
  assert.equal(component.currentVersion, "1.0.0");
  assert.deepEqual(
    component.versions.map((version) => version.version),
    ["1.1.0", "1.0.0"],
  );
  const detail = page(renderSite(rolled.catalog), "components/tracewise-status-badge/index.html");
  assert.match(detail, /<h1>Status Badge<\/h1>/);
  assert.match(detail, /1\.1\.0/);
  assert.match(detail, /1\.0\.0 <span class="badge">Current<\/span>/);
  assert.equal(detail.includes(`${sentinel}-old`), false);
  assert.equal(detail.includes(`${sentinel}-new`), false);
  assert.equal(detail.includes(sourceUrl), false);
});

test("search and filtering use published component fields", () => {
  const components = listPublishedComponents(
    catalogFrom([
      reactBadge({ description: "Compact status badge for a public status page." }),
      {
        name: "tracewise-incident-list",
        title: "TraceWise Incident List",
        description: "Recent incidents for a public status page.",
        current: "0.1.5",
        files: [{ path: "registry/incidents.tsx", content: sentinel }],
        versions: [{ version: "0.1.5" }],
      },
      {
        name: "peerkit-channel",
        type: "registry:lib",
        title: "PeerKit Channel",
        description: "Framework-agnostic realtime channel.",
        current: "1.0.0",
        files: [{ path: "registry/channel.js", content: "export const channel = true;\n" }],
        versions: [{ version: "1.0.0" }],
      },
    ]),
  );
  assert.deepEqual(
    filterComponents(components, { query: "incident" }).map((component) => component.name),
    ["tracewise-incident-list"],
  );
  assert.deepEqual(
    filterComponents(components, { query: "STATUS BADGE" }).map((component) => component.name),
    ["tracewise-status-badge"],
  );
  assert.deepEqual(
    filterComponents(components, { product: "peerkit" }).map((component) => component.name),
    ["peerkit-channel"],
  );
  assert.deepEqual(
    filterComponents(components, { query: "tracewise", product: "peerkit" }).map((component) => component.name),
    [],
  );
  assert.equal(filterComponents(components, { query: "   " }).length, 3);
  assert.deepEqual(filterComponents(components, { product: "formlyx" }), []);
  const catalogPage = page(renderSite({ items: {} }), "components/index.html");
  assert.equal(catalogPage.includes("data-search"), false);
  const populated = page(
    renderSite({
      items: Object.fromEntries(components.map((component) => [component.name, { current: component.currentVersion, versions: {} }])),
    }),
    "index.html",
  );
  assert.equal(populated.includes("data-component-card"), false);
  const realPages = renderSite(
    catalogFrom([
      reactBadge(),
      {
        name: "peerkit-channel",
        title: "PeerKit Channel",
        description: "Framework-agnostic realtime channel.",
        current: "1.0.0",
        files: [{ path: "registry/channel.js", content: "export const channel = true;\n" }],
        versions: [{ version: "1.0.0" }],
      },
    ]),
  );
  const home = page(realPages, "index.html");
  assert.match(home, /data-catalog-search/);
  assert.match(home, /data-search="[^"]*tracewise status badge/);
  assert.match(home, /aria-label="Filter by product"/);
  assert.match(home, /<label for="component-search">Search components<\/label>/);
});

test("public manifest generation omits provenance from registry JSON and the catalog site", async () => {
  const validated = validatePublication({
    contract: "razorsoft.registry.publication",
    contractVersion: 1,
    registryHost: "registry.razorsoft.us",
    item: {
      name: "tracewise-status-badge",
      type: "registry:component",
      title: "TraceWise Status Badge",
      description: "A public status badge in @razorsoft/tracewise-status-js and the HTML embed.",
      dependencies: ["@razorsoft/tracewise-status@^0.1.1"],
      files: [{ path: "registry/badge.tsx", content: sentinel }],
    },
    source: {
      mode: "public-manifest",
      sourceUrl,
      contentDigest,
      version: "0.1.5",
    },
  });
  assert.equal(validated.ok, true);
  const applied = applyPublication(emptyCatalog(), validated.snapshot, "2026-10-23T10:34:50.047Z");
  const directory = await mkdtemp(path.join(tmpdir(), "registry-site-"));
  const catalogPath = path.join(directory, "catalog.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(catalogPath, `${JSON.stringify(applied.catalog, null, 2)}\n`);
  const registryDir = path.join(directory, "r");
  await buildPublicRegistry(catalogPath, registryDir);
  const item = JSON.parse(await readFile(path.join(registryDir, "tracewise-status-badge.json"), "utf8"));
  const version = JSON.parse(await readFile(path.join(registryDir, "tracewise-status-badge", "0.1.5.json"), "utf8"));
  assert.equal(JSON.stringify(item).includes(sourceUrl), false);
  assert.equal(JSON.stringify(item).includes(contentDigest), false);
  assert.equal(JSON.stringify(version).includes("repositoryUrl"), false);
  const pages = await buildPublicSite(applied.catalog, path.join(directory, "site"));
  const detail = page(pages, "components/tracewise-status-badge/index.html");
  assertNoProvenance(detail);
  assert.match(detail, /https:\/\/registry\.razorsoft\.us\/r\/tracewise-status-badge\.json/);
  const stylesheet = await readFile(path.join(directory, "site", "assets", "catalog.css"), "utf8");
  const client = await readFile(path.join(directory, "site", "assets", "catalog.js"), "utf8");
  assert.match(stylesheet, /@media \(max-width: 640px\)/);
  assert.match(client, /data-catalog-search/);
  assert.match(client, /clipboard/);
  assert.equal(client.includes("cdn."), false);
  assert.equal(await readFile(catalogPath, "utf8"), `${JSON.stringify(applied.catalog, null, 2)}\n`);
});

test("version ordering and count labels are stable", () => {
  assert.deepEqual(
    ["1.0.0", "1.10.0", "1.2.0", "1.2.0-beta"].sort(compareVersionsDescending),
    ["1.10.0", "1.2.0", "1.2.0-beta", "1.0.0"],
  );
  assert.equal(componentCountLabel(0), "No published components");
  assert.equal(componentCountLabel(1), "1 published component");
  assert.equal(componentCountLabel(5), "5 published components");
});
