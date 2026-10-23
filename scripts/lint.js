import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = new Set(["node_modules", "dist", ".git", ".vercel"]);

/**
 * @param {string} directory
 * @param {string[]} files
 */
async function walk(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (entry.name.endsWith(".js")) files.push(full);
  }
}

/** @type {string[]} */
const files = [];
await walk(root, files);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}
if (failed) process.exit(1);
console.log(`Checked ${files.length} JavaScript files.`);
