import { readFile } from "node:fs/promises";
import { createGitHubCatalogStore } from "./github.js";

export async function readBundledCatalog(catalogPath) {
  const text = await readFile(catalogPath, "utf8");
  return JSON.parse(text);
}

export function createMemoryCatalogStore(initial = { items: {} }) {
  let catalog = structuredClone(initial);
  return {
    async readCatalog() {
      return structuredClone(catalog);
    },
    async writeCatalog(next) {
      catalog = structuredClone(next);
    },
  };
}

export function createProductionCatalogStore(env, fetchImpl = fetch) {
  if (!env.REGISTRY_GITHUB_TOKEN || !env.REGISTRY_GITHUB_REPOSITORY) return null;
  return createGitHubCatalogStore({
    token: env.REGISTRY_GITHUB_TOKEN,
    repository: env.REGISTRY_GITHUB_REPOSITORY,
    branch: env.REGISTRY_GITHUB_BRANCH || "main",
    fetchImpl,
  });
}
