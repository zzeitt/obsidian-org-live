import { App, finishRenderMath, loadMathJax, renderMath } from "obsidian";
import { parseInline } from "./inline";
import { resolveResourcePath } from "../util/links";

export interface InlineRenderOptions {
  tags?: boolean;
  app?: App;
  sourcePath?: string;
  /** Render $...$ with Obsidian's MathJax integration. */
  math?: boolean;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a slice of Org text to HTML. `base` is the absolute offset of `text`
 * in the document, used only to derive stable ranges for the inline scanner.
 */
export function renderInlineHtml(text: string, base: number, options: InlineRenderOptions = {}): string {
  const tokens = parseInline(text, base, { tags: options.tags });
  let out = "";
  let cursor = base;
  const end = base + text.length;

  for (const token of tokens) {
    if (token.from < cursor) continue; // nested/overlapping token; keep outer
    out += escapeHtml(text.slice(cursor - base, token.from - base));
    const raw = text.slice(token.from - base, token.to - base);

    switch (token.type) {
      case "emphasis": {
        const tag =
          token.style === "bold"
            ? "strong"
            : token.style === "italic"
            ? "em"
            : token.style === "underline"
            ? "u"
            : "del";
        const inner = escapeHtml(text.slice(token.contentFrom - base, token.contentTo - base));
        out += `<${tag} class="org-emphasis org-${token.style}">${inner}</${tag}>`;
        break;
      }
      case "verbatim": {
        const inner = escapeHtml(text.slice(token.contentFrom - base, token.contentTo - base));
        out += `<code class="org-verbatim org-${token.style}">${inner}</code>`;
        break;
      }
      case "link": {
        const label = token.desc ?? token.target;
        if (token.image && options.app && options.sourcePath) {
          const src = resolveResourcePath(options.app, token.target, options.sourcePath);
          if (src) {
            out += `<img class="org-inline-image" src="${escapeHtml(src)}" alt="${escapeHtml(label)}">`;
            break;
          }
        }
        const external = /^(https?|ftp|mailto):/i.test(token.target);
        const cls = external ? "external-link" : "internal-link";
        out += `<a class="${cls} org-link" href="${escapeHtml(token.target)}" data-href="${escapeHtml(
          token.target
        )}" target="_blank" rel="noopener nofollow">${escapeHtml(label)}</a>`;
        break;
      }
      case "timestamp":
        out += `<span class="org-timestamp${token.active ? " is-active" : ""}">${escapeHtml(raw)}</span>`;
        break;
      case "footnote":
        out += `<sup class="org-footnote" data-footnote="${escapeHtml(token.name)}">${escapeHtml(
          token.name
        )}</sup>`;
        break;
      case "cookie":
        out += `<span class="org-cookie">${escapeHtml(raw)}</span>`;
        break;
      case "url":
        out += `<a class="external-link org-link" href="${escapeHtml(
          token.url
        )}" data-href="${escapeHtml(token.url)}">${escapeHtml(token.url)}</a>`;
        break;
      case "tag":
        out += `<a class="tag" href="#${escapeHtml(
          token.name
        )}" target="_blank" rel="noopener nofollow">#${escapeHtml(token.name)}</a>`;
        break;
      case "math": {
        if (options.math === false) {
          out += escapeHtml(raw);
        } else {
          out += `<span class="math org-math${token.display ? " org-math-display" : ""}" data-latex="${escapeHtml(
            token.latex
          )}" data-display="${token.display ? "true" : "false"}"></span>`;
        }
        break;
      }
    }
    cursor = token.to;
  }

  out += escapeHtml(text.slice(Math.max(0, cursor - base), end - base));
  return out;
}

/** Replace math placeholders with real MathJax output. */
export function hydrateMath(root: HTMLElement): void {
  let retry = false;
  root.querySelectorAll<HTMLElement>(".org-math[data-latex]").forEach((el) => {
    if (el.childElementCount > 0) return;
    const latex = el.dataset.latex ?? "";
    const display = el.dataset.display === "true";
    const attempts = Number(el.dataset.mathAttempts ?? "0");
    try {
      const rendered = renderMath(latex, display);
      el.appendChild(rendered);
      el.classList.add("is-rendered");
    } catch {
      el.textContent = display ? `$$${latex}$$` : `$${latex}$`;
      // Retry once after MathJax finishes loading; never loop forever on
      // malformed LaTeX.
      if (attempts < 1) {
        el.dataset.mathAttempts = String(attempts + 1);
        retry = true;
      }
    }
  });
  void finishRenderMath();
  if (retry) {
    void loadMathJax()
      .then(() => hydrateMath(root))
      .catch((error) => console.warn("Org Live: unable to load MathJax", error));
  }
}

