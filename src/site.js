import { REGISTRY_ORIGIN } from "./catalog.js";
import {
  componentCountLabel,
  filterComponents,
  formatPublishedAt,
  listPublishedComponents,
  npmPackageUrl,
  productDirectory,
  searchText,
} from "./catalog-view.js";

const PLACEHOLDER_INSTALL = "npx shadcn@latest add https://registry.razorsoft.us/r/<component>.json";

/**
 * @param {string} value
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * @param {string} value
 */
function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * @param {unknown} value
 */
function jsonLdScript(value) {
  return `<script type="application/ld+json">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`;
}

/**
 * @param {string} iso
 */
function publishedLabel(iso) {
  return formatPublishedAt(iso) || "Not recorded";
}

/**
 * @param {{ path: string, title: string, description: string, active: string, jsonLd: unknown, main: string }} page
 */
function documentPage(page) {
  const canonical = `${REGISTRY_ORIGIN}${page.path}`;
  const description = metaDescription(page.description);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="author" content="RazorSoft, Inc.">
  <meta name="robots" content="index,follow">
  <meta name="theme-color" content="#0c1f38">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta property="og:site_name" content="RazorSoft Component Registry">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(page.title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta name="twitter:card" content="summary">
  <link rel="stylesheet" href="/assets/catalog.css">
  ${jsonLdScript(page.jsonLd)}
</head>
<body>
  <a class="skip" href="#content">Skip to content</a>
  <header class="site-header">
    <div class="wrap header-bar">
      <a class="brand" href="/">
        <img src="/favicon.svg" width="32" height="32" alt="">
        <span>
          <span class="brand-name">RazorSoft</span>
          <span class="brand-sub">Component Registry</span>
        </span>
      </a>
      <nav aria-label="Primary">
        ${navLink("/", "Home", page.active === "home")}
        ${navLink("/components", "Catalog", page.active === "catalog")}
        <a href="/r/registry.json">Registry index</a>
      </nav>
    </div>
  </header>
  <main id="content" tabindex="-1">
    ${page.main}
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <nav aria-label="Footer">
        <a href="/components">Catalog</a>
        <a href="/r/registry.json">Registry index</a>
        <a href="https://www.razorsoft.us/">RazorSoft, Inc.</a>
      </nav>
      <p>This catalog lists published registry items only. It does not include private repositories, credentials, or components that have not been published.</p>
    </div>
  </footer>
  <div id="copy-status" class="visually-hidden" aria-live="polite"></div>
  <script src="/assets/catalog.js" defer></script>
</body>
</html>
`;
}

/**
 * @param {string} text
 */
function metaDescription(text) {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= 160) return value;
  return `${value.slice(0, 157)}...`;
}

/**
 * @param {string} href
 * @param {string} label
 * @param {boolean} current
 */
function navLink(href, label, current) {
  const currentAttr = current ? ` aria-current="page"` : "";
  return `<a href="${href}"${currentAttr}>${label}</a>`;
}

/**
 * @param {ReturnType<typeof listPublishedComponents>} components
 */
function websiteJsonLd(components) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "RazorSoft Component Registry",
    url: `${REGISTRY_ORIGIN}/`,
    description: "Published RazorSoft components with installation commands, dependencies, and links to the products that ship them.",
    isPartOf: {
      "@type": "WebSite",
      name: "RazorSoft Component Registry",
      url: `${REGISTRY_ORIGIN}/`,
      publisher: {
        "@type": "Organization",
        name: "RazorSoft, Inc.",
        url: "https://www.razorsoft.us/",
      },
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: components.length,
      itemListElement: components.map((component, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: component.title,
        url: `${REGISTRY_ORIGIN}/components/${component.name}`,
      })),
    },
  };
}

/**
 * @param {ReturnType<typeof listPublishedComponents>[number]} component
 */
function componentJsonLd(component) {
  /** @type {Record<string, unknown>} */
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: component.title,
    description: component.description || `${component.title} in the RazorSoft component registry.`,
    url: `${REGISTRY_ORIGIN}/components/${component.name}`,
    softwareVersion: component.currentVersion,
    programmingLanguage: component.framework.label,
    downloadUrl: component.manifestUrl,
    author: {
      "@type": "Organization",
      name: "RazorSoft, Inc.",
      url: "https://www.razorsoft.us/",
    },
  };
  const productUrl = safeHttpsUrl(component.product.url);
  if (productUrl) {
    data.about = {
      "@type": "SoftwareApplication",
      name: component.product.name,
      url: productUrl,
    };
  }
  return data;
}

/**
 * @param {ReturnType<typeof listPublishedComponents>} visible
 * @param {ReturnType<typeof listPublishedComponents>} allComponents
 * @param {{ allHref: string, activeProduct: string, cardHeading: "h2" | "h3" }} options
 */
function renderBrowser(visible, allComponents, options) {
  if (allComponents.length === 0) return `<p class="empty">No components are published yet.</p>`;
  const publishedProducts = productDirectory(allComponents).filter((row) => row.componentCount > 0);
  return renderBrowserMarkup(visible, options, publishedProducts, allComponents.length);
}

/**
 * @param {string} href
 * @param {string} label
 * @param {boolean} current
 */
function filterLink(href, label, current) {
  const currentAttr = current ? ` aria-current="page"` : "";
  return `<a href="${escapeHtml(href)}"${currentAttr}>${escapeHtml(label)}</a>`;
}

/**
 * @param {ReturnType<typeof listPublishedComponents>} visible
 * @param {{ allHref: string, activeProduct: string, cardHeading: "h2" | "h3" }} options
 * @param {{ product: { id: string, name: string }, componentCount: number }[]} publishedProducts
 * @param {number} catalogCount
 */
function renderBrowserMarkup(visible, options, publishedProducts, catalogCount) {
  const allCurrent = options.activeProduct === "";
  const filterLinks = [
    filterLink(options.allHref, `All (${catalogCount})`, allCurrent),
    ...publishedProducts.map((row) =>
      filterLink(`/products/${row.product.id}`, `${row.product.name} (${row.componentCount})`, options.activeProduct === row.product.id),
    ),
  ];
  const cards = visible
    .map((component) => {
      const heading = options.cardHeading;
      const productUrl = safeHttpsUrl(component.product.url);
      const productLabel = productUrl
        ? `<a href="${escapeHtml(productUrl)}">${escapeHtml(component.product.name)}</a>`
        : escapeHtml(component.product.name);
      return `<article class="card" data-component-card data-product="${escapeHtml(component.product.id)}" data-search="${escapeHtml(searchText(component))}">
        <p class="eyebrow">${productLabel}</p>
        <${heading}><a href="/components/${escapeHtml(component.name)}">${escapeHtml(component.title)}</a></${heading}>
        <p>${escapeHtml(component.description || "No description has been published for this component.")}</p>
        <p class="meta-line"><code>${escapeHtml(component.name)}</code> · ${escapeHtml(component.currentVersion)} · ${escapeHtml(component.framework.requiresReact ? "React / shadcn" : component.framework.label)}</p>
      </article>`;
    })
    .join("\n");
  const emptyHidden = visible.length === 0 ? "" : " hidden";
  return `<div class="browser">
    <form class="search" role="search" data-catalog-form>
      <label for="component-search">Search components</label>
      <input id="component-search" name="q" type="search" autocomplete="off" placeholder="Name, product, or description" data-catalog-search aria-controls="component-list">
    </form>
    <noscript><p>Search runs in the browser. Product filters are links, and every component on this page is in the list below.</p></noscript>
    <nav class="filters" aria-label="Filter by product">${filterLinks.join("")}</nav>
    <div aria-live="polite">
      <p data-catalog-count>${escapeHtml(componentCountLabel(visible.length))}</p>
      <p data-catalog-empty${emptyHidden}>No published components match that search.</p>
    </div>
    <div id="component-list" class="cards">${cards}</div>
  </div>`;
}

/**
 * @param {ReturnType<typeof listPublishedComponents>} allComponents
 */
function renderProductDirectory(allComponents) {
  const rows = productDirectory(allComponents)
    .map((row) => {
      const url = safeHttpsUrl(row.product.url);
      const links = [];
      if (row.componentCount > 0) links.push(`<a href="/products/${escapeHtml(row.product.id)}">View published components</a>`);
      if (url) links.push(`<a href="${escapeHtml(url)}">Product site</a>`);
      const description = row.product.description ? `<p>${escapeHtml(row.product.description)}</p>` : "";
      return `<article class="card product-card">
        <h3>${escapeHtml(row.product.name)}</h3>
        ${description}
        <p class="count-line">${escapeHtml(componentCountLabel(row.componentCount))}</p>
        ${links.length ? `<p class="meta-line">${links.join(" · ")}</p>` : ""}
      </article>`;
    })
    .join("\n");
  return `<section class="band" aria-labelledby="products-heading">
    <div class="wrap">
      <h2 id="products-heading">RazorSoft products</h2>
      <p class="lede">Components show up here after they are published. A product with no published components has no registry item yet. PeerKit publishes JavaScript and React clients. A React entry in this catalog does not mean every RazorSoft product requires React.</p>
      <div class="cards">${rows}</div>
    </div>
  </section>`;
}

function renderInstallPattern() {
  return `<section class="wrap section">
    <h2>Install from the registry</h2>
    <p>Published items use the shadcn registry schema. The command adds that item's files and the npm dependencies recorded for it.</p>
    <div class="command">
      <pre><code>${escapeHtml(PLACEHOLDER_INSTALL)}</code></pre>
    </div>
    <p>Replace <code>&lt;component&gt;</code> with a published name from the catalog. Open a component page for a command you can copy. React components are installed into a React project. JavaScript registry items do not require React.</p>
  </section>`;
}

/**
 * @param {ReturnType<typeof listPublishedComponents>} components
 */
export function renderHomePage(components) {
  const main = `<section class="hero">
    <div class="wrap">
      <p class="eyebrow">registry.razorsoft.us</p>
      <h1>RazorSoft component registry</h1>
      <p class="lede">A public catalog of components RazorSoft has published. Each page lists the install command, dependencies, framework, documentation, and the product the component comes from.</p>
      <p><a class="button" href="/components">Browse the catalog</a> <a class="button button-secondary" href="/r/registry.json">Registry index</a></p>
    </div>
  </section>
  ${renderInstallPattern()}
  <section class="wrap section" aria-labelledby="published-heading">
    <h2 id="published-heading">Published components</h2>
    ${renderBrowser(components, components, { allHref: "/", activeProduct: "", cardHeading: "h3" })}
  </section>
  ${renderProductDirectory(components)}`;
  return documentPage({
    path: "/",
    title: "RazorSoft Component Registry",
    description: "Published RazorSoft components with installation commands, dependencies, versions, and links to the products that ship them.",
    active: "home",
    jsonLd: websiteJsonLd(components),
    main,
  });
}

/**
 * @param {ReturnType<typeof listPublishedComponents>} components
 */
export function renderCatalogPage(components) {
  const main = `<section class="wrap section">
    <p class="eyebrow">Catalog</p>
    <h1>Component catalog</h1>
    <p class="lede">Search the components that are published in this registry. Filters match products that already have a published item.</p>
    ${renderBrowser(components, components, { allHref: "/components", activeProduct: "", cardHeading: "h2" })}
  </section>
  ${renderProductDirectory(components)}`;
  return documentPage({
    path: "/components",
    title: "Component catalog · RazorSoft Registry",
    description: "Search published RazorSoft components by name, product, and description.",
    active: "catalog",
    jsonLd: websiteJsonLd(components),
    main,
  });
}

/**
 * @param {ReturnType<typeof listPublishedComponents>} components
 * @param {string} productId
 */
export function renderProductPage(components, productId) {
  const visible = filterComponents(components, { product: productId });
  if (visible.length === 0) return null;
  const product = visible[0].product;
  const productUrl = safeHttpsUrl(product.url);
  const main = `<section class="wrap section">
    <p class="eyebrow">Product</p>
    <h1>${escapeHtml(product.name)} components</h1>
    <p class="lede">${escapeHtml(product.description || "Published registry items associated with this product.")}</p>
    ${productUrl ? `<p><a href="${escapeHtml(productUrl)}">Visit ${escapeHtml(product.name)}</a></p>` : ""}
    ${renderBrowser(visible, components, { allHref: "/components", activeProduct: productId, cardHeading: "h2" })}
  </section>
  ${renderProductDirectory(components)}`;
  return documentPage({
    path: `/products/${productId}`,
    title: `${product.name} components · RazorSoft Registry`,
    description: `Published ${product.name} components in the RazorSoft component registry.`,
    active: "",
    jsonLd: websiteJsonLd(visible),
    main,
  });
}

/**
 * @param {string} id
 * @param {string} accessibleName
 */
function copyButton(id, accessibleName) {
  return `<button type="button" data-copy-target="${escapeHtml(id)}" data-copy-name="${escapeHtml(accessibleName)}"><span data-copy-label>Copy</span><span class="visually-hidden"> ${escapeHtml(accessibleName)}</span></button>`;
}

/**
 * @param {string} id
 * @param {string} command
 * @param {string} accessibleName
 */
function commandBlock(id, command, accessibleName) {
  return `<div class="command">
    <pre><code id="${escapeHtml(id)}">${escapeHtml(command)}</code></pre>
    ${copyButton(id, accessibleName)}
  </div>`;
}

/**
 * @param {string[]} specs
 * @param {string} emptyLabel
 */
function renderDependencyList(specs, emptyLabel) {
  if (specs.length === 0) return `<p>${escapeHtml(emptyLabel)}</p>`;
  const items = specs
    .map((spec) => {
      const url = npmPackageUrl(spec);
      const code = `<code>${escapeHtml(spec)}</code>`;
      if (!url) return `<li>${code}</li>`;
      return `<li>${code} · <a href="${escapeHtml(url)}">npm package</a></li>`;
    })
    .join("");
  return `<ul>${items}</ul>`;
}

/**
 * @param {ReturnType<typeof listPublishedComponents>[number]} component
 */
export function renderComponentPage(component) {
  const productUrl = safeHttpsUrl(component.product.url);
  const productValue = productUrl
    ? `<a href="${escapeHtml(productUrl)}">${escapeHtml(component.product.name)}</a>`
    : escapeHtml(component.product.name);
  const integrations = component.integrations
    .map((method) => {
      const url = safeHttpsUrl(method.url);
      const linkLabel = method.id.startsWith("javascript-sdk:") ? "View package" : "View documentation";
      const link = url ? ` <a href="${escapeHtml(url)}">${linkLabel}</a>` : "";
      return `<li><strong>${escapeHtml(method.label)}</strong> · ${escapeHtml(method.scope === "registry-item" ? "This registry item" : "Separate integration")}<br>${escapeHtml(method.summary)}${link}</li>`;
    })
    .join("");
  const docs = component.documentation
    .map((link) => {
      const url = safeHttpsUrl(link.url);
      if (!url) return "";
      return `<li><a href="${escapeHtml(url)}">${escapeHtml(link.label)}</a></li>`;
    })
    .filter(Boolean)
    .join("");
  const versions = component.versions
    .map((version) => {
      const installId = `install-${version.version.replace(/[^a-z0-9]+/gi, "-")}`;
      const current = version.current ? ` <span class="badge">Current</span>` : "";
      return `<tr>
        <th scope="row">${escapeHtml(version.version)}${current}</th>
        <td>${escapeHtml(version.title || component.title)}</td>
        <td>${escapeHtml(publishedLabel(version.publishedAt))}</td>
        <td><a href="${escapeHtml(version.manifestUrl)}">${escapeHtml(version.manifestUrl)}</a></td>
        <td>${commandBlock(installId, version.installCommand, `install command for version ${version.version}`)}</td>
      </tr>`;
    })
    .join("");
  const files = component.files
    .map((file) => `<li><code>${escapeHtml(file.path)}</code></li>`)
    .join("");
  const registryDependencies = component.registryDependencies
    .map((name) => `<li><a href="/components/${escapeHtml(name)}"><code>${escapeHtml(name)}</code></a></li>`)
    .join("");
  const main = `<article class="wrap section component">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/components">Catalog</a>
      <span aria-hidden="true">/</span>
      <a href="/products/${escapeHtml(component.product.id)}">${escapeHtml(component.product.name)}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${escapeHtml(component.title)}</span>
    </nav>
    <p class="eyebrow">${productValue}</p>
    <h1>${escapeHtml(component.title)}</h1>
    <p class="lede">${escapeHtml(component.description || "No description has been published for this component.")}</p>
    <dl class="facts">
      <div><dt>Product</dt><dd>${productValue}</dd></div>
      <div><dt>Current version</dt><dd><code>${escapeHtml(component.currentVersion)}</code></dd></div>
      <div><dt>Published</dt><dd>${escapeHtml(publishedLabel(component.publishedAt))}</dd></div>
      <div><dt>Registry type</dt><dd>${escapeHtml(component.typeLabel)}</dd></div>
      <div><dt>Framework</dt><dd>${escapeHtml(component.framework.label)}</dd></div>
    </dl>
    <section aria-labelledby="install-heading">
      <h2 id="install-heading">Installation</h2>
      <p>This command installs the current published version, ${escapeHtml(component.currentVersion)}. ${escapeHtml(component.framework.requiresReact ? "It adds this React component to a shadcn project." : "It adds the published files. React is not required.")}</p>
      ${commandBlock("install-current", component.installCommand, "installation command")}
    </section>
    <section aria-labelledby="dependencies-heading">
      <h2 id="dependencies-heading">Required dependencies</h2>
      ${renderDependencyList(component.dependencies, "No npm dependencies are recorded for this item.")}
      ${component.devDependencies.length ? `<h3>Dev dependencies</h3>${renderDependencyList(component.devDependencies, "")}` : ""}
      ${registryDependencies ? `<h3>Registry dependencies</h3><ul>${registryDependencies}</ul>` : ""}
    </section>
    <section aria-labelledby="framework-heading">
      <h2 id="framework-heading">Framework requirements</h2>
      <p>${escapeHtml(component.framework.summary)}</p>
    </section>
    <section aria-labelledby="integrations-heading">
      <h2 id="integrations-heading">Supported integration methods</h2>
      <ul class="methods">${integrations}</ul>
    </section>
    <section aria-labelledby="docs-heading">
      <h2 id="docs-heading">Documentation and examples</h2>
      ${docs ? `<ul>${docs}</ul>` : "<p>No product documentation link is published for this component. The public manifest below is the registry record.</p>"}
    </section>
    <section aria-labelledby="versions-heading">
      <h2 id="versions-heading">Available versions</h2>
      <div class="table-scroll">
        <table>
          <caption>Snapshots retained for ${escapeHtml(component.title)}. The current snapshot is what <code>/r/${escapeHtml(component.name)}.json</code> serves.</caption>
          <thead><tr><th scope="col">Version</th><th scope="col">Title</th><th scope="col">Published</th><th scope="col">Manifest</th><th scope="col">Install</th></tr></thead>
          <tbody>${versions}</tbody>
        </table>
      </div>
    </section>
    <section aria-labelledby="manifest-heading">
      <h2 id="manifest-heading">Public registry manifest</h2>
      <p>This is the public manifest for the current version.</p>
      ${commandBlock("manifest-current", component.manifestUrl, "public manifest URL")}
      <p><a href="${escapeHtml(component.manifestUrl)}">Open ${escapeHtml(component.manifestUrl)}</a></p>
    </section>
    <section aria-labelledby="files-heading">
      <h2 id="files-heading">Published files</h2>
      ${files ? `<ul>${files}</ul>` : "<p>No files are listed for this item.</p>"}
    </section>
  </article>`;
  return documentPage({
    path: `/components/${component.name}`,
    title: `${component.title} · RazorSoft Registry`,
    description: component.description || `${component.title} in the RazorSoft component registry.`,
    active: "",
    jsonLd: componentJsonLd(component),
    main,
  });
}

export function renderNotFoundPage() {
  const main = `<section class="wrap section">
    <h1>Page not found</h1>
    <p>That page is not in the RazorSoft component registry.</p>
    <p><a href="/">Home</a> · <a href="/components">Catalog</a></p>
  </section>`;
  return documentPage({
    path: "/404",
    title: "Page not found · RazorSoft Registry",
    description: "That page is not in the RazorSoft component registry.",
    active: "",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Page not found",
      url: `${REGISTRY_ORIGIN}/404`,
    },
    main,
  });
}

/**
 * @param {ReturnType<typeof listPublishedComponents>} components
 * @param {string[]} extraPaths
 */
export function renderSitemap(components, extraPaths) {
  const paths = ["/", "/components", ...extraPaths, ...components.map((component) => `/components/${component.name}`)];
  const urls = paths
    .map((path) => `  <url><loc>${escapeHtml(`${REGISTRY_ORIGIN}${path}`)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function renderRobots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${REGISTRY_ORIGIN}/sitemap.xml\n`;
}

/**
 * @param {{ items?: Record<string, unknown> } | null | undefined} catalog
 */
export function renderSite(catalog) {
  const components = listPublishedComponents(catalog);
  const directory = productDirectory(components).filter((row) => row.componentCount > 0);
  /** @type {Map<string, string>} */
  const pages = new Map();
  pages.set("index.html", renderHomePage(components));
  pages.set("components/index.html", renderCatalogPage(components));
  for (const row of directory) {
    const page = renderProductPage(components, row.product.id);
    if (page) pages.set(`products/${row.product.id}/index.html`, page);
  }
  for (const component of components) {
    pages.set(`components/${component.name}/index.html`, renderComponentPage(component));
  }
  pages.set("404.html", renderNotFoundPage());
  pages.set("sitemap.xml", renderSitemap(components, directory.map((row) => `/products/${row.product.id}`)));
  pages.set("robots.txt", renderRobots());
  return pages;
}

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="RazorSoft">
  <rect width="32" height="32" rx="6" fill="#0c1f38"/>
  <path d="M9 23 L16 8 L23 23" fill="none" stroke="#4d8fd4" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M12 18.5 H20" stroke="#e2e8f0" stroke-width="2" stroke-linecap="round"/>
</svg>
`;
