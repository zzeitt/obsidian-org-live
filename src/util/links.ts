import { App, TFile } from "obsidian";

const EXTERNAL = /^(https?|ftp|mailto):/i;

export function stripFilePrefix(target: string): string {
  return target.replace(/^file:/i, "").trim();
}

/** Open an Org link target inside (or outside) the vault. */
export function openOrgLink(app: App, target: string, sourcePath: string): void {
  const cleaned = stripFilePrefix(target);
  if (!cleaned) return;
  if (EXTERNAL.test(cleaned)) {
    window.open(cleaned, "_blank");
    return;
  }
  // `file:notes.org::*Heading` — openLinkText understands subpaths.
  void app.workspace
    .openLinkText(cleaned, sourcePath, false)
    .catch((error) => console.warn("Org Live: could not open link", error));
}

/**
 * Search for an Org tag.
 *
 * Obsidian's `tag:` operator only indexes Markdown metadata, and there is no
 * public API to feed tags from non-Markdown files into the metadata cache.
 * A plain-text search for `:tag:` therefore finds the Org files instead of
 * showing an empty tag result.
 */
export function openTagSearch(app: App, tag: string): void {
  try {
    const search = (app as unknown as {
      internalPlugins?: { getPluginById?: (id: string) => { instance?: { openGlobalSearch?: (q: string) => void } } };
    }).internalPlugins?.getPluginById?.("global-search")?.instance;
    search?.openGlobalSearch?.(`:${tag}:`);
  } catch {
    // Search is a core plugin; if it is disabled there is nothing to open.
  }
}

/** Attach click handlers to links produced by the HTML renderers. */
export function wireLinks(root: HTMLElement, app: App, sourcePath: string): void {
  root.querySelectorAll<HTMLAnchorElement>("a[data-href]").forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openOrgLink(app, anchor.dataset.href ?? anchor.getAttribute("href") ?? "", sourcePath);
    });
  });
  root.querySelectorAll<HTMLAnchorElement>("a.tag").forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const name = (anchor.getAttribute("href") ?? "").replace(/^#/, "");
      if (name) openTagSearch(app, name);
    });
  });
}

/** Resolve a local Org link to an app:// resource URL, if possible. */
export function resolveResourcePath(app: App, target: string, sourcePath: string): string | null {
  let path = stripFilePrefix(target);
  if (!path) return null;
  const subpathIndex = path.indexOf("::");
  if (subpathIndex >= 0) path = path.slice(0, subpathIndex);

  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return `file:///${path.replace(/\\/g, "/").replace(/ /g, "%20")}`;
  }

  const abstract = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
  if (abstract instanceof TFile) {
    return app.vault.adapter.getResourcePath(abstract.path);
  }
  // It may be an absolute path inside the vault, or a link relative to the
  // current file. getResourcePath accepts vault-relative paths.
  try {
    return app.vault.adapter.getResourcePath(path);
  } catch {
    return null;
  }
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(stripFilePrefix(path));
}
