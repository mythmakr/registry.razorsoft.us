import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { containsPrivateKey, renderIndex, renderItem } from "../src/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildPublicRegistry(catalogPath = path.join(root, "data", "catalog.json"), outputDirectory = path.join(root, "public", "r")) {
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = await buildPublicRegistry();
  console.log(`Built ${index.items.length} registry item${index.items.length === 1 ? "" : "s"}.`);
}
