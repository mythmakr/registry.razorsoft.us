/**
 * Public product directory for the catalog.
 * Components are not listed here. Published items come from data/catalog.json.
 * A product can appear in the directory when it has no published components.
 */

/** @typedef {{ id: string, name: string, description: string, url: string, docsUrl: string, examplesUrl: string }} ProductProfile */

/** @type {readonly ProductProfile[]} */
export const PRODUCTS = Object.freeze([
  Object.freeze({
    id: "tracewise",
    name: "TraceWise",
    description: "Uptime monitoring, public status pages, and embeddable status components.",
    url: "https://www.tracewise.dev/",
    docsUrl: "https://www.tracewise.dev/docs/components",
    examplesUrl: "https://www.tracewise.dev/#components",
  }),
  Object.freeze({
    id: "peerkit",
    name: "PeerKit",
    description: "Real-time components for JavaScript and React.",
    url: "https://peerkit.dev/",
    docsUrl: "",
    examplesUrl: "",
  }),
  Object.freeze({
    id: "formlyx",
    name: "Formlyx",
    description: "Hosted forms that embed in your product.",
    url: "https://formlyx.com/",
    docsUrl: "",
    examplesUrl: "",
  }),
  Object.freeze({
    id: "causewise",
    name: "CauseWise",
    description: "Privacy-friendly analytics that explains what changed.",
    url: "https://causewise.io/",
    docsUrl: "",
    examplesUrl: "",
  }),
]);

/**
 * @param {string} componentName
 * @returns {ProductProfile}
 */
export function associateProduct(componentName) {
  const id = String(componentName || "").split("-")[0] || "component";
  const known = PRODUCTS.find((product) => product.id === id);
  if (known) return known;
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: "",
    url: "",
    docsUrl: "",
    examplesUrl: "",
  };
}
