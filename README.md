# registry.razorsoft.us

Public RazorSoft component registry.

| | |
| --- | --- |
| GitHub | [mythmakr/registry.razorsoft.us](https://github.com/mythmakr/registry.razorsoft.us) |
| Website | [https://registry.razorsoft.us](https://registry.razorsoft.us) |
| Registry index | [https://registry.razorsoft.us/r/registry.json](https://registry.razorsoft.us/r/registry.json) |

The repository name is `registry.razorsoft.us`. Do not rename it to `razorsoft-components` or `razorsoft-registry`.

OpsLedger remains the management and publishing control plane. This deployment serves published snapshots from `data/catalog.json`. It does not call OpsLedger and does not read private product repositories.

## Public routes

- `GET /` — catalog homepage
- `GET /components` — searchable component catalog
- `GET /products/<product>` — published components for one product
- `GET /components/<name>` — component details, install command, dependencies, and versions
- `GET /r/registry.json` — shadcn registry index of the current snapshots
- `GET /r/<name>.json` — the current public registry item
- `GET /r/<name>/<version>.json` — one retained snapshot

The HTML catalog is generated at build time from `data/catalog.json`. It is not a second component list. Registry JSON is still served by the publication API, not by the static catalog files.

The index lists the current snapshots in the committed catalog. An empty catalog produces an empty index. A route returns the snapshot stored in this deployment, so the public registry stays available when OpsLedger is offline.

## Publication contract

OpsLedger delivers one publication with `POST /api/publications`.

```http
POST /api/publications
Authorization: Bearer <REGISTRY_PUBLISH_TOKEN>
Content-Type: application/json
```

Repository publications keep the original source shape. `source.mode` may be omitted or `repository`. `source.repositoryUrl` and a 40-character `source.commitSha` are required, validated, and then discarded.

```json
{
  "contract": "razorsoft.registry.publication",
  "contractVersion": 1,
  "registryHost": "registry.razorsoft.us",
  "item": {
    "name": "status-badge",
    "type": "registry:component",
    "title": "Status Badge",
    "description": "Optional public description",
    "dependencies": ["@razorsoft/example@1.0.0"],
    "files": [{ "path": "registry/status-badge.tsx", "content": "export const badge = true;\n" }]
  },
  "source": {
    "mode": "repository",
    "repositoryUrl": "https://github.com/owner/repository",
    "commitSha": "7891a157b069ca477aca05fce04d01d4e3405f9f",
    "version": "1.0.0"
  }
}
```

Public-manifest publications name the mode explicitly. They require the public HTTPS source URL, the sha256 digest of the fetched body, and the release version. They cannot include a repository URL or commit SHA.

```json
{
  "source": {
    "mode": "public-manifest",
    "sourceUrl": "https://www.example.com/r/status-badge.json",
    "contentDigest": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "version": "1.0.0"
  }
}
```

The stored public item is the shadcn snapshot only. A public-manifest version also retains `sourceUrl` and `contentDigest` in the catalog record. Public item responses omit both. The same name, version, content, and digest returns the existing snapshot. The same version with different content or a different digest is rejected. `POST /api/publications/rollback` with `{ "name", "version" }` makes a retained snapshot current again.

Acceptance is not publication. A successful write returns `status: "accepted"` with the public item name, version, current URL, versioned URL, sha256 `contentHash` of the public item, and the registry repository commit SHA that Vercel deploys. The product repository URL and product commit are not returned. The public routes serve the snapshot only after that commit is deployed.

Both publication routes require `REGISTRY_PUBLISH_TOKEN`. Writes also require `REGISTRY_GITHUB_TOKEN` with contents access to `mythmakr/registry.razorsoft.us` and `REGISTRY_GITHUB_REPOSITORY=mythmakr/registry.razorsoft.us`. A write commits `data/catalog.json` on `main`; the next deployment serves it. Until those values are set, publication routes return 503 and the public index remains available.

## Deployment

Vercel project: `registry.razorsoft.us`.

- Production domain: `registry.razorsoft.us`
- Framework: none
- Build: `npm test && npm run build`
- Static output: `dist/site`
- Checks: `npm test`, `npm run lint`, `npm run typecheck`

Do not point the production domain at OpsLedger. OpsLedger does not serve this registry.
