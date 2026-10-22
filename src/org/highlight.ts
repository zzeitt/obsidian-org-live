/**
 * Bridge Obsidian's Prism instance into CM6 mark decorations.
 *
 * Obsidian's reading view highlights code with Prism. Its live preview uses
 * CodeMirror token classes such as cm-keyword / cm-string. We run the same
 * Prism grammar and translate token classes to Obsidian's cm-* classes, so
 * Org source blocks look identical to Markdown fenced code.
 */

export interface CodeRange {
  /** Offset relative to the start of the code block. */
  from: number;
  to: number;
  cls: string;
}

type PrismLike = {
  languages: Record<string, unknown>;
  highlight: (code: string, grammar: unknown, language: string) => string;
};

let prism: PrismLike | null = null;

export function setPrismInstance(instance: PrismLike): void {
  prism = instance;
}

const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  yml: "yaml",
  html: "markup",
  xml: "markup",
  svg: "markup",
  "c++": "cpp",
  "c#": "csharp",
  objc: "objectivec",
};

const TOKEN_MAP: [string, string][] = [
  ["comment", "cm-comment"],
  ["prolog", "cm-comment"],
  ["doctype", "cm-comment"],
  ["cdata", "cm-comment"],
  ["keyword", "cm-keyword"],
  ["boolean", "cm-keyword"],
  ["atrule", "cm-keyword"],
  ["control-flow", "cm-keyword"],
  ["string", "cm-string"],
  ["char", "cm-string"],
  ["regex", "cm-string"],
  ["template-string", "cm-string"],
  ["attr-value", "cm-string-2"],
  ["number", "cm-number"],
  ["function", "cm-def"],
  ["function-name", "cm-def"],
  ["property", "cm-property"],
  ["attr-name", "cm-property"],
  ["operator", "cm-operator"],
  ["punctuation", "cm-punctuation"],
  ["class-name", "cm-variable-2"],
  ["builtin", "cm-variable-2"],
  ["tag", "cm-tag"],
  ["selector", "cm-tag"],
  ["variable", "cm-variable"],
  ["parameter", "cm-variable"],
];

function tokenClass(classes: string[]): string | null {
  for (const [token, cls] of TOKEN_MAP) {
    if (classes.includes(token)) return cls;
  }
  return null;
}

const highlightCache = new Map<string, CodeRange[]>();

/** Highlight a whole source block, returning ranges relative to its start. */
export function highlightCode(content: string, lang: string | undefined): CodeRange[] {
  if (!prism || !lang || !content) return [];
  const cacheKey = `${lang}\u0000${content}`;
  const cached = highlightCache.get(cacheKey);
  if (cached) return cached;

  const grammar = prism.languages[lang] ?? prism.languages[ALIASES[lang] ?? ""];
  if (!grammar) return [];

  let html: string;
  try {
    html = prism.highlight(content, grammar, lang);
  } catch {
    return [];
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const ranges: CodeRange[] = [];
  let offset = 0;

  const push = (from: number, to: number, cls: string, text: string) => {
    if (to <= from) return;
    let cursor = from;
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.length > 0) ranges.push({ from: cursor, to: cursor + part.length, cls });
      cursor += part.length + 1; // newline
    }
  };

  const walk = (node: Node, classes: string[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      if (!text) return;
      const cls = tokenClass(classes);
      if (cls) push(offset, offset + text.length, cls, text);
      offset += text.length;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const own = Array.from(el.classList).filter((name) => name !== "token");
      const next = own.length > 0 ? [...classes, ...own] : classes;
      for (const child of Array.from(node.childNodes)) walk(child, next);
    }
  };

  for (const child of Array.from(parsed.body.childNodes)) walk(child, []);
  if (highlightCache.size > 200) {
    const oldest = highlightCache.keys().next().value;
    if (oldest !== undefined) highlightCache.delete(oldest);
  }
  highlightCache.set(cacheKey, ranges);
  return ranges;
}
