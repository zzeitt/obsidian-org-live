import { sanitizeHTMLToDom } from "obsidian";

// Obsidian's document-level createEl appends to the document, which is invalid
// for detached widget elements. Keep a hidden host on body and use its
// createEl helper; elements are moved out when CM6 inserts the widget.
const detachedHost = document.body.createDiv({ cls: "org-live-detached-host" });

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
