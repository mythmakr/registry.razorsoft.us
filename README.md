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

- `GET /r/registry.json` — shadcn registry index of the current snapshots
- `GET /r/<name>.json` — the current public registry item
- `GET /r/<name>/<version>.json` — one retained snapshot

The index starts empty. A route returns the snapshot stored in this deployment, so the public registry stays available when OpsLedger is offline.

## Publication contract

OpsLedger delivers one publication with `POST /api/publications`.

```http
POST /api/publications
Authorization: Bearer <REGISTRY_PUBLISH_TOKEN>
Content-Type: application/json
```

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
    "repositoryUrl": "https://github.com/owner/repository",
    "commitSha": "7891a157b069ca477aca05fce04d01d4e3405f9f",
    "version": "1.0.0"
  }
}
```

`source.repositoryUrl` and `source.commitSha` are validated and then discarded. The stored snapshot and every public response contain the shadcn item and version only. The same name, version, and public content returns the existing snapshot. The same version with different content is rejected. `POST /api/publications/rollback` with `{ "name", "version" }` makes a retained snapshot current again.

Both publication routes require `REGISTRY_PUBLISH_TOKEN`. Writes also require `REGISTRY_GITHUB_TOKEN` with contents access to `mythmakr/registry.razorsoft.us` and `REGISTRY_GITHUB_REPOSITORY=mythmakr/registry.razorsoft.us`. A write commits `data/catalog.json` on `main`; the next deployment serves it. Until those values are set, publication routes return 503 and the public index remains available.

## Deployment

Vercel project: `registry.razorsoft.us`.

- Production domain: `registry.razorsoft.us`
- Framework: none
- Build: `npm test && npm run build`

Do not point the production domain at OpsLedger. OpsLedger does not serve this registry.
