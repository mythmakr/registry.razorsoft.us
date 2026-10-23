import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { containsPrivateKey, renderIndex, renderItem } from "../src/catalog.js";
import { FAVICON_SVG, renderSite } from "../src/site.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildPublicRegistry(catalogPath = path.join(root, "data", "catalog.json"), outputDirectory = path.join(root, "dist", "r")) {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  if (containsPrivateKey(catalog)) {
    throw new Error("The catalog contains private repository information.");
  }
  await mkdir(outputDirectory, { recursive: true });
  const index = renderIndex(catalog);
  await writeFile(path.join(outputDirectory, "registry.json"), `${JSON.stringify(index, null, 2)}\n`);
  for (const [name, record] of Object.entries(catalog.items)) {
    const current = renderItem(catalog, name);
    if (!current) continue;
    await writeFile(path.join(outputDirectory, `${name}.json`), `${JSON.stringify(current, null, 2)}\n`);
    for (const version of Object.keys(record.versions)) {
      const snapshot = renderItem(catalog, name, version);
      const versionDirectory = path.join(outputDirectory, name);
      await mkdir(versionDirectory, { recursive: true });
      await writeFile(path.join(versionDirectory, `${version}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
    }
  }
  return index;
}

/**
 * @param {{ items?: Record<string, unknown> } | null | undefined} catalog
 * @param {string} outputDirectory
 * @param {string} [assetDirectory]
 */
export async function buildPublicSite(catalog, outputDirectory, assetDirectory = path.join(root, "src")) {
  if (containsPrivateKey(catalog)) {
    throw new Error("The catalog contains private repository information.");
  }
  const pages = renderSite(catalog);
  for (const [relativePath, contents] of pages) {
    const destination = path.join(outputDirectory, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  const assets = path.join(outputDirectory, "assets");
  await mkdir(assets, { recursive: true });
  await copyFile(path.join(assetDirectory, "site.css"), path.join(assets, "catalog.css"));
  await copyFile(path.join(assetDirectory, "site-client.js"), path.join(assets, "catalog.js"));
  await writeFile(path.join(outputDirectory, "favicon.svg"), FAVICON_SVG);
  return pages;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalogPath = path.join(root, "data", "catalog.json");
  const index = await buildPublicRegistry(catalogPath);
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const pages = await buildPublicSite(catalog, path.join(root, "dist", "site"));
  console.log(`Built ${index.items.length} registry item${index.items.length === 1 ? "" : "s"} and ${pages.size} catalog files.`);
}
