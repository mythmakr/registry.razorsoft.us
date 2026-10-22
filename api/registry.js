import path from "node:path";
import { handleRegistryGet, sendResult } from "../src/http.js";
import { readBundledCatalog } from "../src/store.js";

const catalogPath = path.join(process.cwd(), "data", "catalog.json");

export default async function handler(request, response) {
  const catalog = await readBundledCatalog(catalogPath);
  sendResult(response, handleRegistryGet(request, catalog));
}
