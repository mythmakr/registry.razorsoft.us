const search = document.querySelector("[data-catalog-search]");
const form = document.querySelector("[data-catalog-form]");
const cards = [...document.querySelectorAll("[data-component-card]")];
const empty = document.querySelector("[data-catalog-empty]");
const count = document.querySelector("[data-catalog-count]");
const copyStatus = document.querySelector("#copy-status");

function searchTerms(value) {
  return value.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function applySearch() {
  if (!search || cards.length === 0) return;
  const terms = searchTerms(search.value);
  let visible = 0;
  for (const card of cards) {
    const text = (card.getAttribute("data-search") || "").toLowerCase();
    const show = terms.every((term) => text.includes(term));
    card.hidden = !show;
    if (show) visible += 1;
  }
  if (empty) empty.hidden = visible !== 0;
  if (count) count.textContent = visible === 1 ? "1 published component" : `${visible} published components`;
}

function writeQuery() {
  if (!search) return;
  const params = new URLSearchParams(window.location.search);
  const query = search.value.trim();
  if (query) params.set("q", query);
  else params.delete("q");
  const next = params.toString();
  const path = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", path);
}

if (search) {
  const initial = new URLSearchParams(window.location.search).get("q") || "";
  if (initial) search.value = initial;
  search.addEventListener("input", () => {
    applySearch();
    writeQuery();
  });
  applySearch();
}

if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    applySearch();
    writeQuery();
  });
}

document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("[data-copy-target]");
  if (!(button instanceof HTMLButtonElement)) return;
  const sourceId = button.getAttribute("data-copy-target") || "";
  const source = document.getElementById(sourceId);
  const text = source?.textContent || "";
  const name = button.getAttribute("data-copy-name") || "text";
  const label = button.querySelector("[data-copy-label]");
  try {
    await navigator.clipboard.writeText(text);
    if (label) label.textContent = "Copied";
    if (copyStatus) copyStatus.textContent = `Copied ${name}.`;
  } catch {
    if (source) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(source);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    if (label) label.textContent = "Select";
    if (copyStatus) copyStatus.textContent = `Could not copy ${name}. The text is selected so you can copy it manually.`;
  }
  window.setTimeout(() => {
    if (label) label.textContent = "Copy";
  }, 2000);
});
