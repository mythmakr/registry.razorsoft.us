import { REGISTRY_ORIGIN } from "./catalog.js";
import { PRODUCTS, associateProduct } from "./products.js";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;


/**
 * @param {string} version
 */
function versionParts(version) {
  const [core, prerelease = ""] = version.split("-", 2);
  const [major = 0, minor = 0, patch = 0] = core.split(".").map((part) => Number.parseInt(part, 10) || 0);
  return { major, minor, patch, prerelease };
}

/**
 * @param {string} left
 * @param {string} right
 */
export function compareVersionsDescending(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  if (a.patch !== b.patch) return b.patch - a.patch;
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return -1;
  if (!b.prerelease) return 1;
  return a.prerelease < b.prerelease ? 1 : -1;
}

/**
 * @param {string} specifier
 */
export function dependencyPackageName(specifier) {
  if (typeof specifier !== "string") return "";
  const trimmed = specifier.trim();
  const scoped = trimmed.match(/^(@[a-z0-9][a-z0-9-._]*\/[a-z0-9][a-z0-9-._]*)(?:@.+)?$/i);
  if (scoped) return scoped[1];
  const plain = trimmed.match(/^([a-z0-9][a-z0-9-._]*)(?:@.+)?$/i);
  if (plain) return plain[1];
  return "";
}

/**
 * @param {string} name
 */
export function npmPackageUrl(name) {
  const packageName = dependencyPackageName(name);
  if (!packageName) return "";
  return `https://www.npmjs.com/package/${packageName}`;
}

/**
 * @param {string} name
 * @param {string} [version]
 */
export function registryManifestUrl(name, version = "") {
  if (version) return `${REGISTRY_ORIGIN}/r/${name}/${version}.json`;
  return `${REGISTRY_ORIGIN}/r/${name}.json`;
}

/**
 * @param {string} name
 * @param {string} [version]
 */
export function shadcnInstallCommand(name, version = "") {
  return `npx shadcn@latest add ${registryManifestUrl(name, version)}`;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

/**
 * @param {string} text
 */
function packagesInText(text) {
  /** @type {string[]} */
  const found = [];
  const pattern = /@[a-z0-9][a-z0-9-._]*\/[a-z0-9][a-z0-9-._]*/gi;
  for (const match of String(text || "").matchAll(pattern)) {
    if (!found.includes(match[0])) found.push(match[0]);
  }
  return found;
}

/**
 * @param {{ path: string }[]} files
 */
function frameworkFor(files) {
  const paths = files.map((file) => file.path.toLowerCase());
  if (paths.some((filePath) => filePath.endsWith(".tsx") || filePath.endsWith(".jsx"))) {
    return {
      id: "react",
      label: "React",
      requiresReact: true,
    };
  }
  if (paths.some((filePath) => filePath.endsWith(".vue"))) {
    return { id: "vue", label: "Vue", requiresReact: false };
  }
  if (paths.some((filePath) => filePath.endsWith(".svelte"))) {
    return { id: "svelte", label: "Svelte", requiresReact: false };
  }
  return { id: "javascript", label: "JavaScript", requiresReact: false };
}

/**
 * @param {{ id: string, label: string, requiresReact: boolean }} framework
 * @param {boolean} hasSeparateIntegrations
 */
function frameworkSummary(framework, hasSeparateIntegrations) {
  if (framework.requiresReact) {
    const base = "This published item is a React component for the shadcn registry. Installing it requires a React project.";
    if (!hasSeparateIntegrations) return base;
    return `${base} Other clients named for this component are separate integrations. They do not mean the product requires React for every use.`;
  }
  if (framework.id === "vue") return "This published item is a Vue component. Installing it does not require React.";
  if (framework.id === "svelte") return "This published item is a Svelte component. Installing it does not require React.";
  return "The published files are not React components. Installing this item does not require React.";
}

/**
 * @param {{ id: string, label: string, requiresReact: boolean }} framework
 */
function primaryIntegration(framework) {
  if (framework.requiresReact) {
    return {
      id: "react-shadcn",
      label: "React / shadcn",
      scope: "registry-item",
      summary: "Installed by the registry command into a React project.",
      url: "",
    };
  }
  if (framework.id === "vue" || framework.id === "svelte") {
    return {
      id: framework.id,
      label: framework.label,
      scope: "registry-item",
      summary: `Installed by the registry command. React is not required.`,
      url: "",
    };
  }
  return {
    id: "javascript",
    label: "JavaScript",
    scope: "registry-item",
    summary: "Installed by the registry command. React is not required.",
    url: "",
  };
}

/**
 * @param {string} description
 * @param {string[]} dependencies
 * @param {{ docsUrl: string, examplesUrl: string }} product
 * @param {{ id: string, label: string, requiresReact: boolean }} framework
 */
function integrationMethods(description, dependencies, product, framework) {
  const methods = [primaryIntegration(framework)];
  const dependencyNames = new Set(dependencies.map((dependency) => dependencyPackageName(dependency)).filter(Boolean));
  for (const packageName of packagesInText(description)) {
    if (dependencyNames.has(packageName)) continue;
    if (!packageName.endsWith("-js")) continue;
    methods.push({
      id: `javascript-sdk:${packageName}`,
      label: "JavaScript SDK",
      scope: "separate",
      summary: `${packageName} is named in the component description. It is a separate, framework-agnostic package and is not installed by the registry command.`,
      url: npmPackageUrl(packageName),
    });
  }
  if (/\bHTML embed\b/i.test(description) || /\bscript tag\b/i.test(description)) {
    methods.push({
      id: "html-embed",
      label: "HTML embed",
      scope: "separate",
      summary: "The component description includes an HTML embed. That embed is a product integration and is not installed by the registry command.",
      url: product.docsUrl || product.examplesUrl || "",
    });
  }
  return methods;
}

/**
 * @param {{ docsUrl: string, examplesUrl: string }} product
 */
function documentationLinks(product) {
  /** @type {{ label: string, url: string }[]} */
  const links = [];
  if (product.docsUrl) links.push({ label: "Documentation", url: product.docsUrl });
  if (product.examplesUrl && product.examplesUrl !== product.docsUrl) {
    links.push({ label: "Examples", url: product.examplesUrl });
  }
  return links;
}

/**
 * @param {string} name
 * @param {any} record
 */
function componentView(name, record) {
  if (!NAME_PATTERN.test(name) || !record || !record.versions) return null;
  const currentVersion = record.current || "";
  const current = record.versions[currentVersion];
  if (!current) return null;
  const item = current.item;
  if (!item || item.name !== name || typeof item.title !== "string" || !item.title.trim()) return null;
  const versions = Object.values(record.versions)
    .flatMap((version) => {
      if (!version?.item || typeof version.version !== "string" || !VERSION_PATTERN.test(version.version)) return [];
      const versionName = version.version;
      return [
        {
          version: versionName,
          title: typeof version.item.title === "string" ? version.item.title.trim() : "",
          publishedAt: typeof version.publishedAt === "string" ? version.publishedAt : "",
          current: versionName === currentVersion,
          manifestUrl: registryManifestUrl(name, versionName),
          installCommand: shadcnInstallCommand(name, versionName),
        },
      ];
    })
    .sort((left, right) => compareVersionsDescending(left.version, right.version));
  if (!versions.some((version) => version.current)) return null;
  /** @type {unknown[]} */
  const rawFiles = Array.isArray(item.files) ? item.files : [];
  const files = rawFiles.flatMap((file) => {
    if (!file || typeof file !== "object" || !("path" in file) || typeof file.path !== "string" || !file.path.trim()) return [];
    const fileType = "type" in file && typeof file.type === "string" && file.type ? file.type : item.type || "";
    return [{ path: file.path.trim(), type: fileType }];
  });
  const dependencies = stringList(item.dependencies);
  const product = associateProduct(name);
  const frameworkBase = frameworkFor(files);
  const integrations = integrationMethods(item.description || "", dependencies, product, frameworkBase);
  const framework = {
    ...frameworkBase,
    summary: frameworkSummary(frameworkBase, integrations.some((method) => method.scope === "separate")),
  };
  return {
    name,
    title: item.title.trim(),
    description: typeof item.description === "string" ? item.description.trim() : "",
    type: item.type || "",
    typeLabel: typeLabel(item.type),
    product,
    dependencies,
    devDependencies: stringList(item.devDependencies),
    registryDependencies: stringList(item.registryDependencies),
    files,
    framework,
    integrations,
    documentation: documentationLinks(product),
    installCommand: shadcnInstallCommand(name),
    manifestUrl: registryManifestUrl(name),
    currentVersion,
    publishedAt: typeof current.publishedAt === "string" ? current.publishedAt : "",
    versions,
  };
}

/**
 * @param {{ items?: Record<string, unknown> } | null | undefined} catalog
 */
export function listPublishedComponents(catalog) {
  const items = catalog && catalog.items && typeof catalog.items === "object" ? catalog.items : {};
  const components = [];
  for (const [name, record] of Object.entries(items)) {
    const view = componentView(name, record);
    if (view) components.push(view);
  }
  components.sort((left, right) => left.name.localeCompare(right.name));
  return components;
}

/**
 * @param {{ name: string, title: string, description: string, product: { id: string, name: string }, currentVersion: string, type: string, framework: { label: string }, dependencies: string[], devDependencies: string[], registryDependencies: string[], integrations: { label: string }[] }} component
 */
export function searchText(component) {
  return [
    component.name,
    component.title,
    component.description,
    component.product.name,
    component.product.id,
    component.currentVersion,
    component.type,
    component.framework.label,
    ...component.dependencies,
    ...component.devDependencies,
    ...component.registryDependencies,
    ...component.integrations.map((method) => method.label),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * @param {ReturnType<typeof listPublishedComponents>} components
 * @param {{ query?: string, product?: string }} [criteria]
 */
export function filterComponents(components, criteria = {}) {
  const terms = String(criteria.query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const product = String(criteria.product || "")
    .trim()
    .toLowerCase();
  return components.filter((component) => {
    if (product && component.product.id !== product) return false;
    if (terms.length === 0) return true;
    const text = searchText(component);
    return terms.every((term) => text.includes(term));
  });
}

/**
 * @param {ReturnType<typeof listPublishedComponents>} components
 */
export function productDirectory(components) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const component of components) {
    counts.set(component.product.id, (counts.get(component.product.id) || 0) + 1);
  }
  const known = new Set(PRODUCTS.map((product) => product.id));
  const rows = PRODUCTS.map((product) => ({
    product,
    componentCount: counts.get(product.id) || 0,
  }));
  const extras = [...counts.keys()]
    .filter((id) => !known.has(id))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((id) => {
      const product = components.find((component) => component.product.id === id)?.product;
      if (!product) return [];
      return [{ product, componentCount: counts.get(id) || 0 }];
    });
  return [...rows, ...extras];
}

/**
 * @param {string | undefined} type
 */
function typeLabel(type) {
  switch (type) {
    case "registry:component":
      return "Component";
    case "registry:ui":
      return "UI";
    case "registry:lib":
      return "Library";
    case "registry:hook":
      return "Hook";
    case "registry:block":
      return "Block";
    case "registry:file":
      return "File";
    default:
      return "Registry item";
  }
}

/**
 * @param {number} count
 */
export function componentCountLabel(count) {
  if (count === 0) return "No published components";
  if (count === 1) return "1 published component";
  return `${count} published components`;
}

/**
 * @param {string} iso
 */
export function formatPublishedAt(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
