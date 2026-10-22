# registry.razorsoft.us

Public RazorSoft component registry.

| | |
| --- | --- |
| GitHub | [mythmakr/registry.razorsoft.us](https://github.com/mythmakr/registry.razorsoft.us) |
| Website | [https://registry.razorsoft.us](https://registry.razorsoft.us) |
| Registry index | [https://registry.razorsoft.us/r/registry.json](https://registry.razorsoft.us/r/registry.json) |

The repository name is `registry.razorsoft.us`. Do not rename it to `razorsoft-components` or `razorsoft-registry`.

OpsLedger remains the management and publishing control plane. It prepares shadcn registry manifests. This repository serves the public registry and does not read private product repositories.

## Endpoints

- `GET /r/registry.json` — shadcn registry index
- `GET /r/<name>.json` — one published registry item

The index starts empty. Items appear here only after OpsLedger publishes them to this deployment.

## Deployment

Deploy this repository as the Vercel project `registry.razorsoft.us`.

- Production domain: `registry.razorsoft.us`
- Output: the `public` directory
- Framework: none

Do not point the production domain at OpsLedger. OpsLedger does not serve this registry.
