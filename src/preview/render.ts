import { App, loadPrism } from "obsidian";
import { OrgDoc, OrgLine, TableData, parseOrgDoc } from "../org/parse";
import { escapeHtml, hydrateMath, renderInlineHtml } from "../org/inlineRender";
import { wireLinks } from "../util/links";
import { OrgLiveSettings } from "../settings";

export interface PreviewRenderOptions {
  settings: OrgLiveSettings;
  /** File basename, used when the document has no #+TITLE. */
  fallbackTitle?: string;
  onToggleTask?: (from: number, to: number, checked: boolean) => void;
}

interface InlineOpts {
  app: App;
  sourcePath: string;
  math: boolean;
}

function inline(text: string, base: number, opts: InlineOpts): string {
  return renderInlineHtml(text, base, {
    app: opts.app,
    sourcePath: opts.sourcePath,
    math: opts.math,
    tags: false,
  });
}

function headingHtml(line: OrgLine, opts: InlineOpts, id: string): string {
  const h = line.heading;
  if (!h) return "";
  const level = Math.min(h.level, 6);
  const title = line.text.slice(h.titleFrom - line.from, h.titleTo - line.from);
  const parts: string[] = [];
  if (h.keyword) {
    parts.push(
      `<span class="org-todo ${h.keyword.done ? "org-todo-done" : "org-todo-active"}">${escapeHtml(
        h.keyword.text
      )}</span>`
    );
  }
  if (h.priority) {
    parts.push(
      `<span class="org-priority org-priority-${h.priority.text.toLowerCase()}">[#${escapeHtml(
        h.priority.text
      )}]</span>`
    );
  }
  parts.push(inline(title, h.titleFrom, opts));
  for (const tag of h.tags) {
    parts.push(
      `<a href="#${escapeHtml(tag.name)}" class="tag org-tag" data-tag="${escapeHtml(
        tag.name
      )}" target="_blank" rel="noopener nofollow">#${escapeHtml(tag.name)}</a>`
    );
  }
  const plainHeading = title.replace(/[*_/+=~\[\]]/g, "").trim();
  return `<h${level} id="${escapeHtml(id)}" data-heading="${escapeHtml(
    plainHeading
  )}" class="org-heading-preview org-level-${level}" data-level="${h.level}">${parts.join(
    " "
  )}</h${level}>`;
}

function taskCheckbox(line: OrgLine, opts: PreviewRenderOptions): string {
  const checkbox = line.list?.checkbox;
  if (!checkbox) return "";
  const interactive = !!opts.onToggleTask;
  return `<input type="checkbox" class="task-list-item-checkbox org-task-checkbox" data-from="${
    checkbox.from
  }" data-to="${checkbox.to}" ${checkbox.checked ? "checked" : ""} ${
    interactive ? "" : "disabled"
  }>`;
}

function renderListBlock(
  doc: OrgDoc,
  start: number,
  opts: InlineOpts,
  previewOpts: PreviewRenderOptions
): { html: string; next: number } {
  type StackEntry = { indent: number; tag: "ul" | "ol" };
  const stack: StackEntry[] = [];
  let html = "";
  let i = start;

  while (i < doc.lines.length) {
    const line = doc.lines[i];
    if (line.kind !== "list" || !line.list) break;
    const list = line.list;
    const tag: "ul" | "ol" = list.ordered ? "ol" : "ul";

    while (stack.length > 0 && list.indent < stack[stack.length - 1].indent) {
      const top = stack.pop()!;
      html += `</li></${top.tag}>`;
    }

    if (stack.length === 0) {
      const startAttr = list.ordered && list.number > 1 ? ` start="${list.number}"` : "";
      html += `<${tag}${startAttr}>`;
      stack.push({ indent: list.indent, tag });
    } else if (list.indent > stack[stack.length - 1].indent) {
      const startAttr = list.ordered && list.number > 1 ? ` start="${list.number}"` : "";
      html += `<${tag}${startAttr}>`;
      stack.push({ indent: list.indent, tag });
    } else {
      html += "</li>";
    }

    const content = line.text.slice(list.contentFrom - line.from);
    const body = inline(content, list.contentFrom, opts);
    html += `<li class="${list.checkbox ? "task-list-item" : ""}">${taskCheckbox(
      line,
      previewOpts
    )}${body}`;
    i++;
  }

  while (stack.length > 0) {
    const top = stack.pop()!;
    html += `</li></${top.tag}>`;
  }
  return { html, next: i };
}

function renderTable(table: TableData, opts: InlineOpts): string {
  const headerRows = table.ruleAfter.length > 0 ? table.ruleAfter[0] + 1 : 0;
  let head = "";
  let body = "";
  table.rows.forEach((row, index) => {
    const target = index < headerRows ? "th" : "td";
    const cells = row.cells
      .map((cell) => {
        const style = cell.align ? ` style="text-align:${cell.align}"` : "";
        return `<${target}${style}>${inline(cell.text, cell.from, opts)}</${target}>`;
      })
      .join("");
    const tr = `<tr>${cells}</tr>`;
    if (index < headerRows) head += tr;
    else body += tr;
  });
  return `<div class="el-table org-table-container"><table class="org-table">${
    head ? `<thead>${head}</thead>` : ""
  }${body ? `<tbody>${body}</tbody>` : ""}</table></div>`;
}

function propertiesCard(
  entries: { key: string; value: string }[],
  title?: string
): string {
  if (entries.length === 0) return "";
  const rows = entries
    .map(
      (entry) =>
        `<div class="org-property"><span class="org-property-key">${escapeHtml(
          entry.key
        )}</span><span class="org-property-value">${escapeHtml(entry.value)}</span></div>`
    )
    .join("");
  const heading = title
    ? `<div class="org-properties-title">${escapeHtml(title)}</div>`
    : "";
  return `<div class="org-properties org-properties-preview">${heading}${rows}</div>`;
}

function renderDrawer(doc: OrgDoc, line: OrgLine, settings: OrgLiveSettings): string {
  const drawer = line.drawer;
  if (!drawer) return "";
  if (!settings.showProperties) return "";
  const end = drawer.endLine ?? line.index;
  const entries: { key: string; value: string }[] = [];
  for (let i = drawer.startLine + 1; i < end; i++) {
    const text = doc.lines[i]?.text ?? "";
    const m = /^\s*:([^:\s][^:]*):\s*(.*)$/.exec(text);
    if (m) entries.push({ key: m[1], value: m[2] });
  }
  return propertiesCard(entries, drawer.name.toLowerCase());
}

function renderBlock(doc: OrgDoc, line: OrgLine, opts: InlineOpts): { html: string; next: number } {
  const block = line.block;
  if (!block) return { html: "", next: line.index + 1 };
  const endLine = block.endLine ?? doc.lines.length - 1;
  const contentLines = doc.lines.slice(block.beginLine + 1, endLine);
  const raw = contentLines.map((l) => l.text).join("\n");

  switch (block.type) {
    case "src": {
      const language = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : "";
      return {
        html: `<pre${language}><code${language}>${escapeHtml(raw)}</code></pre>`,
        next: endLine + 1,
      };
    }
    case "quote": {
      const paragraphs = raw
        .split(/\n\s*\n/)
        .map((paragraph) =>
          paragraph
            .split("\n")
            .map((l, index) => inline(l, 0, opts) + (index < paragraph.split("\n").length - 1 ? "<br>" : ""))
            .join("")
        )
        .filter(Boolean)
        .map((p) => `<p>${p}</p>`)
        .join("");
      return { html: `<blockquote>${paragraphs}</blockquote>`, next: endLine + 1 };
    }
    case "example":
      return {
        html: `<pre class="org-example">${escapeHtml(raw)}</pre>`,
        next: endLine + 1,
      };
    case "center": {
      const content = raw
        .split(/\n\s*\n/)
        .map((p) => `<p>${inline(p, 0, opts)}</p>`)
        .join("");
      return { html: `<div class="org-center">${content}</div>`, next: endLine + 1 };
    }
    case "verse":
      return {
        html: `<pre class="org-verse">${escapeHtml(raw)}</pre>`,
        next: endLine + 1,
      };
    case "comment":
      return { html: "", next: endLine + 1 };
    case "export":
      return {
        html: `<pre class="org-export">${escapeHtml(raw)}</pre>`,
        next: endLine + 1,
      };
    default:
      return {
        html: `<pre class="org-special-block">${escapeHtml(raw)}</pre>`,
        next: endLine + 1,
      };
  }
}

const PRISM_ALIASES: Record<string, string> = {
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

/** Highlight fenced code with the same Prism instance Obsidian uses. */
async function hydrateCodeBlocks(root: HTMLElement): Promise<void> {
  try {
    const Prism = await loadPrism();
    root.querySelectorAll<HTMLElement>("pre > code").forEach((code) => {
      if (code.classList.contains("is-loaded")) return;
      const languageClass = Array.from(code.classList).find((name) =>
        name.startsWith("language-")
      );
      const language = languageClass?.slice("language-".length);
      if (!language) return;
      const grammar =
        Prism.languages[language] ?? Prism.languages[PRISM_ALIASES[language] ?? ""];
      if (!grammar) return;
      const source = code.textContent ?? "";
      code.innerHTML = Prism.highlight(source, grammar, language);
      code.classList.add("is-loaded");
    });
  } catch (error) {
    console.warn("Org Live: Prism highlighting failed", error);
  }
}

/** Render a complete Org document as reading-view HTML. */
export function renderOrgPreview(
  source: string,
  app: App,
  sourcePath: string,
  options: PreviewRenderOptions
): HTMLElement {
  const doc = parseOrgDoc(source);
  const inlineOpts: InlineOpts = {
    app,
    sourcePath,
    math: options.settings.renderMath,
  };
  let html = "";

  const title = doc.title ?? options.fallbackTitle;
  if (title) {
    html += `<div class="inline-title">${escapeHtml(title)}</div>`;
  }

  // A leading run of #+KEYWORD lines is Org's frontmatter. Render it as a
  // properties card, like Obsidian does with YAML.
  let i = 0;
  if (options.settings.showProperties) {
    let start = 0;
    while (start < doc.lines.length && doc.lines[start].kind === "blank") start++;
    let end = start;
    while (end < doc.lines.length && doc.lines[end].kind === "keyword") end++;
    if (end > start) {
      const entries: { key: string; value: string }[] = [];
      for (let j = start; j < end; j++) {
        const match = /^\s*#\+([A-Za-z0-9_-]+)(?:\[[^\]]*\])?:\s*(.*)$/.exec(
          doc.lines[j].text
        );
        if (match && match[1].toUpperCase() !== "TITLE") {
          entries.push({ key: match[1].toUpperCase(), value: match[2] });
        }
      }
      html += propertiesCard(entries);
      i = end;
    }
  }

  let headingId = 0;
  while (i < doc.lines.length) {
    const line = doc.lines[i];

    switch (line.kind) {
      case "blank":
        i++;
        break;
      case "heading":
        html += headingHtml(line, inlineOpts, `org-heading-${++headingId}`);
        i++;
        break;
      case "list": {
        const result = renderListBlock(doc, i, inlineOpts, options);
        html += result.html;
        i = result.next;
        break;
      }
      case "table":
      case "table-rule": {
        const table = line.table;
        if (table && table.startLine === line.index) {
          html += renderTable(table, inlineOpts);
          i = table.endLine + 1;
        } else {
          i++;
        }
        break;
      }
      case "block-start": {
        const result = renderBlock(doc, line, inlineOpts);
        html += result.html;
        i = result.next;
        break;
      }
      case "drawer-start":
      case "drawer": {
        html += renderDrawer(doc, line, options.settings);
        i = (line.drawer?.endLine ?? line.index) + 1;
        break;
      }
      case "planning":
        html += `<div class="org-planning-line">${inline(line.text, line.from, inlineOpts)}</div>`;
        i++;
        break;
      case "keyword": {
        const m = /^\s*#\+([A-Za-z0-9_-]+)(?:\[[^\]]*\])?:\s*(.*)$/.exec(line.text);
        if (m) {
          const key = m[1].toUpperCase();
          if (key === "TITLE") {
            i++;
            break;
          }
          if (/^(OPTIONS|STARTUP|TODO|SEQ_TODO|TYP_TODO|FILETAGS|SETUPFILE|INCLUDE)$/.test(key)) {
            i++;
            break;
          }
          html += `<div class="org-keyword-line"><span class="org-keyword-key">${escapeHtml(
            key
          )}</span><span class="org-keyword-value">${escapeHtml(m[2])}</span></div>`;
        }
        i++;
        break;
      }
      case "comment":
        i++;
        break;
      case "fixed-width": {
        const parts: string[] = [];
        while (i < doc.lines.length && doc.lines[i].kind === "fixed-width") {
          parts.push(doc.lines[i].text);
          i++;
        }
        html += `<pre class="org-fixed-width">${escapeHtml(parts.join("\n"))}</pre>`;
        break;
      }
      case "rule":
        html += "<hr>";
        i++;
        break;
      case "block-end":
        i++;
        break;
      case "drawer-end":
        i++;
        break;
      case "text": {
        const paragraphs: string[][] = [];
        let current: string[] = [];
        while (i < doc.lines.length && doc.lines[i].kind === "text") {
          const text = doc.lines[i].text;
          if (text.trim() === "") {
            if (current.length > 0) paragraphs.push(current);
            current = [];
          } else {
            current.push(doc.lines[i].text);
          }
          i++;
        }
        if (current.length > 0) paragraphs.push(current);
        for (const paragraph of paragraphs) {
          const content = paragraph
            .map((text, index) => inline(text, 0, inlineOpts) + (index < paragraph.length - 1 ? " " : ""))
            .join("");
          html += `<p>${content}</p>`;
        }
        break;
      }
      default:
        i++;
        break;
    }
  }

  const root = document.createElement("div");
  root.className =
    "markdown-preview-view markdown-rendered node-insert-event is-readable-line-width " +
    "allow-fold-headings allow-fold-lists show-indentation-guide show-properties org-preview";
  const sizer = document.createElement("div");
  sizer.className = "markdown-preview-sizer";
  sizer.innerHTML = html;
  root.appendChild(sizer);

  wireLinks(root, app, sourcePath);
  if (options.settings.renderMath) hydrateMath(root);
  void hydrateCodeBlocks(root);

  if (options.onToggleTask) {
    root.querySelectorAll<HTMLInputElement>("input.org-task-checkbox[data-from]").forEach((input) => {
      input.addEventListener("change", () => {
        const from = Number(input.dataset.from);
        const to = Number(input.dataset.to);
        if (Number.isFinite(from) && Number.isFinite(to)) {
          options.onToggleTask?.(from, to, input.checked);
        }
      });
    });
  }

  return root;
}
