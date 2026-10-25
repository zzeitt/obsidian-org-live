import { sanitizeHTMLToDom } from "obsidian";

// Obsidian's Document.createEl appends to the document, which is invalid for
// detached widget elements. A DocumentFragment is an Obsidian-aware detached
// host, so createEl can be used without direct document.createElement calls.
const detachedHost = document.createDocumentFragment();

export function createDetachedEl<K extends keyof HTMLElementTagNameMap>(
  tag: K
): HTMLElementTagNameMap[K] {
  return detachedHost.createEl(tag);
}

/**
 * Append renderer-generated HTML through Obsidian's sanitizer. This avoids
 * direct innerHTML assignments (which the community scanner flags) while
 * keeping the HTML rendering pipeline readable.
 */
export function appendSanitizedHtml(parent: HTMLElement, html: string): void {
  parent.appendChild(sanitizeHTMLToDom(html));
}

export function replaceWithSanitizedHtml(parent: HTMLElement, html: string): void {
  parent.replaceChildren(sanitizeHTMLToDom(html));
}
