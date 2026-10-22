import { handleRollback, sendResult } from "../../src/http.js";
import { createProductionCatalogStore } from "../../src/store.js";

export default async function handler(request, response) {
  const store = createProductionCatalogStore(process.env);
  if (!store) {
    sendResult(response, {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: { error: "Publication storage is not configured." },
    });
    return;
  }
  sendResult(response, await handleRollback(request, process.env, store));
}
