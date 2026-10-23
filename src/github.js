import { containsPrivateKey } from "./catalog.js";

const GITHUB_API = "https://api.github.com";

export function createGitHubCatalogStore({
  token,
  repository,
  branch = "main",
  path = "data/catalog.json",
  fetchImpl = fetch,
}) {
  if (!token || !repository || !repository.includes("/")) {
    throw new Error("GitHub catalog storage requires a token and repository.");
  }
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "registry.razorsoft.us",
    "x-github-api-version": "2022-11-28",
  };
  const contentsUrl = `${GITHUB_API}/repos/${repository}/contents/${path}`;

  async function headCommit() {
    const response = await fetchImpl(`${GITHUB_API}/repos/${repository}/commits/${encodeURIComponent(branch)}`, { headers });
    if (!response.ok) throw new Error(`GitHub commit lookup failed with ${response.status}.`);
    const sha = commitSha(await response.json());
    if (!sha) throw new Error("GitHub did not return a catalog commit.");
    return { commitSha: sha };
  }

  return {
    headCommit,
    async readCatalog() {
      const response = await fetchImpl(`${contentsUrl}?ref=${encodeURIComponent(branch)}`, { headers });
      if (response.status === 404) return { items: {} };
      if (!response.ok) throw new Error(`GitHub catalog read failed with ${response.status}.`);
      const payload = await response.json();
      const catalog = JSON.parse(Buffer.from(payload.content, "base64").toString("utf8"));
      if (containsPrivateKey(catalog)) throw new Error("The stored catalog contains private repository information.");
      return catalog;
    },
    async writeCatalog(catalog) {
      if (containsPrivateKey(catalog)) throw new Error("Refusing to store private repository information.");
      const current = await fetchImpl(`${contentsUrl}?ref=${encodeURIComponent(branch)}`, { headers });
      let sha;
      if (current.ok) {
        const payload = await current.json();
        sha = payload.sha;
        const existing = Buffer.from(payload.content, "base64").toString("utf8");
        if (existing === `${JSON.stringify(catalog, null, 2)}\n`) return headCommit();
      } else if (current.status !== 404) {
        throw new Error(`GitHub catalog read failed with ${current.status}.`);
      }
      const response = await fetchImpl(contentsUrl, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          message: "Publish a registry snapshot.",
          content: Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`).toString("base64"),
          branch,
          sha,
        }),
      });
      if (!response.ok) throw new Error(`GitHub catalog write failed with ${response.status}.`);
      const written = commitSha(await response.json());
      if (!written) throw new Error("GitHub catalog write did not return a commit.");
      return { commitSha: written };
    },
  };
}

function commitSha(payload) {
  const sha = payload?.commit?.sha ?? payload?.sha;
  return typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}
