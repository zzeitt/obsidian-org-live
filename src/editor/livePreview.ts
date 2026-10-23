import {
  EditorState,
  Range,
  SelectionRange,
  StateEffect,
  StateField,
  Text,
} from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { App, finishRenderMath, loadMathJax, renderMath } from "obsidian";
import { BlockType, OrgDoc, OrgLine, TableData, parseOrgDoc } from "../org/parse";
import { InlineToken, parseInline } from "../org/inline";
import { highlightCode } from "../org/highlight";
import { hydrateMath, renderInlineHtml } from "../org/inlineRender";
import {
  openOrgLink,
  openTagSearch,
  resolveResourcePath,
  wireLinks,
} from "../util/links";
import { OrgLiveSettings } from "../settings";

export interface LivePreviewOptions {
  app: App;
  sourcePath: string;
  settings: OrgLiveSettings;
  /** File basename, shown as the inline title when the file has no #+TITLE. */
  displayTitle: string;
}

/** Dispatch this effect to force the live preview to rebuild its decorations. */
export const refreshOrgPreview = StateEffect.define<null>();

let mathJaxPromise: Promise<void> | null = null;
function ensureMathJax(view: EditorView): void {
  if (mathJaxPromise) return;
  mathJaxPromise = loadMathJax()
    .then(() => {
      view.dispatch({ effects: refreshOrgPreview.of(null) });
    })
    .catch((error) => console.warn("Org Live: unable to load MathJax", error));
}

const EMPTY_REPLACE = Decoration.replace({});

function selectionTouches(selection: readonly SelectionRange[], from: number, to: number): boolean {
  return selection.some((range) => {
    if (range.from === range.to) return range.from >= from && range.from <= to;
    return range.from < to && range.to > from;
  });
}

function listLevel(indent: number): number {
  return Math.max(1, Math.min(8, Math.floor(indent / 2) + 1));
}

// ---------------------------------------------------------------------------
// Widgets
//
// Widgets deliberately use Obsidian's own Markdown / CodeMirror class names
// (cm-list-*, cm-hashtag-*, code-block-flair, markdown-rendered, …). Obsidian
// and every theme already style those classes, so Org looks native without us
// re-implementing the design system.
// ---------------------------------------------------------------------------

class BulletWidget extends WidgetType {
  constructor(readonly ordered: boolean, readonly label: string, readonly level: number) {
    super();
  }

  eq(other: BulletWidget): boolean {
    return (
      other.ordered === this.ordered &&
      other.label === this.label &&
      other.level === this.level
    );
  }

  toDOM(): HTMLElement {
    const outer = document.createElement("span");
    outer.className = `cm-formatting cm-formatting-list cm-formatting-list-${
      this.ordered ? "ol" : "ul"
    } cm-list-${this.level}`;
    const inner = document.createElement("span");
    inner.className = this.ordered ? "list-number" : "list-bullet";
    inner.textContent = this.label;
    outer.appendChild(inner);
    outer.appendChild(document.createTextNode(" "));
    return outer;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly from: number, readonly to: number) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const label = document.createElement("label");
    label.className = "task-list-label";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "task-list-item-checkbox org-checkbox";
    input.checked = this.checked;
    input.dataset.task = this.checked ? "x" : " ";
    label.appendChild(input);
    label.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? "[ ]" : "[X]" },
      });
      view.focus();
    });
    return label;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class TagWidget extends WidgetType {
  constructor(readonly names: string[], readonly app: App) {
    super();
  }

  eq(other: TagWidget): boolean {
    return other.names.join("\u0000") === this.names.join("\u0000");
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "org-tag";
    wrapper.title = this.names.map((name) => `:${name}:`).join(" ");
    for (const name of this.names) {
      const chip = document.createElement("span");
      chip.className = "org-tag-chip";
      const begin = document.createElement("span");
      begin.className = "cm-hashtag cm-hashtag-begin cm-meta cm-tag-tag";
      begin.textContent = "#";
      begin.setAttribute("spellcheck", "false");
      const end = document.createElement("span");
      end.className = "cm-hashtag cm-hashtag-end cm-meta cm-tag-tag";
      end.textContent = name;
      end.setAttribute("spellcheck", "false");
      chip.appendChild(begin);
      chip.appendChild(end);
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openTagSearch(this.app, name);
      });
      wrapper.appendChild(chip);
    }
    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class LinkWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly label: string,
    readonly external: boolean,
    readonly app: App,
    readonly sourcePath: string
  ) {
    super();
  }

  eq(other: LinkWidget): boolean {
    return (
      other.target === this.target &&
      other.label === this.label &&
      other.external === this.external
    );
  }

  toDOM(): HTMLElement {
    const outer = document.createElement("span");
    outer.className = this.external ? "cm-link org-link" : "cm-hmd-internal-link org-link";
    outer.title = this.target;
    outer.setAttribute("role", "link");
    outer.setAttribute("tabindex", "-1");
    const inner = document.createElement("span");
    inner.className = "cm-underline";
    inner.textContent = this.label;
    outer.appendChild(inner);
    outer.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openOrgLink(this.app, this.target, this.sourcePath);
    });
    return outer;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly from: number,
    readonly to: number
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(view: EditorView): HTMLElement {
    const img = document.createElement("img");
    img.className = "org-inline-image";
    img.src = this.src;
    img.alt = this.alt;
    img.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from, head: this.to } });
      view.focus();
    });
    return img;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class MathWidget extends WidgetType {
  constructor(readonly latex: string, readonly display: boolean) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.latex === this.latex && other.display === this.display;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = this.display ? "math org-math org-math-display" : "math org-math";
    span.setAttribute("contenteditable", "false");
    try {
      span.appendChild(renderMath(this.latex, this.display));
      void finishRenderMath();
    } catch (error) {
      span.textContent = this.display ? `$$${this.latex}$$` : `$${this.latex}$`;
      console.warn("Org Live: math render failed", error);
      ensureMathJax(view);
    }
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    return document.createElement("hr");
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class CodeFlairWidget extends WidgetType {
  constructor(readonly lang: string | undefined, readonly lineFrom: number) {
    super();
  }

  eq(other: CodeFlairWidget): boolean {
    return other.lang === this.lang;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "code-block-flair";
    span.textContent = this.lang || "SRC";
    span.title = "Show the Org block markers";
    span.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.lineFrom } });
      view.focus();
    });
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly table: TableData,
    readonly app: App,
    readonly sourcePath: string,
    readonly renderMath: boolean
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return (
      other.table.id === this.table.id &&
      other.table.from === this.table.from &&
      other.table.to === this.table.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "org-table-widget cm-embed-block cm-table-widget markdown-rendered";
    wrapper.setAttribute("contenteditable", "false");
    const tableEl = document.createElement("table");
    const headerRule = this.table.ruleAfter.length > 0 ? this.table.ruleAfter[0] + 1 : 0;
    let currentSection: HTMLTableSectionElement | null = null;

    this.table.rows.forEach((row, rowIndex) => {
      const inHead = rowIndex < headerRule;
      const wanted = inHead ? "thead" : "tbody";
      if (!currentSection || currentSection.tagName.toLowerCase() !== wanted) {
        currentSection = document.createElement(wanted);
        tableEl.appendChild(currentSection);
      }
      const tr = document.createElement("tr");
      row.cells.forEach((cell) => {
        const td = document.createElement(inHead ? "th" : "td");
        if (cell.align) td.style.textAlign = cell.align;
        td.innerHTML = renderInlineHtml(cell.text, cell.from, {
          app: this.app,
          sourcePath: this.sourcePath,
          math: this.renderMath,
        });
        td.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          view.dispatch({ selection: { anchor: cell.from }, scrollIntoView: true });
          view.focus();
        });
        tr.appendChild(td);
      });
      currentSection.appendChild(tr);
    });

    wrapper.appendChild(tableEl);
    wireLinks(wrapper, this.app, this.sourcePath);
    if (this.renderMath) hydrateMath(wrapper);
    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class PropertiesWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly entries: { key: string; value: string }[],
    readonly raw: string,
    readonly lineFrom: number
  ) {
    super();
  }

  eq(other: PropertiesWidget): boolean {
    return other.raw === this.raw && other.name === this.name;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "org-properties";
    const title = document.createElement("div");
    title.className = "org-properties-title";
    title.textContent = this.name.toLowerCase();
    wrapper.appendChild(title);

    if (this.entries.length > 0) {
      for (const entry of this.entries) {
        const row = document.createElement("div");
        row.className = "org-property";
        const key = document.createElement("span");
        key.className = "org-property-key";
        key.textContent = entry.key;
        const value = document.createElement("span");
        value.className = "org-property-value";
        value.textContent = entry.value;
        row.appendChild(key);
        row.appendChild(value);
        wrapper.appendChild(row);
      }
    } else {
      const pre = document.createElement("pre");
      pre.className = "org-logbook";
      pre.textContent = this.raw;
      wrapper.appendChild(pre);
    }

    wrapper.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.lineFrom } });
      view.focus();
    });
    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class MetadataWidget extends WidgetType {
  constructor(
    readonly title: string | undefined,
    readonly entries: { key: string; value: string }[],
    readonly raw: string,
    readonly lineFrom: number
  ) {
    super();
  }

  eq(other: MetadataWidget): boolean {
    return other.raw === this.raw && other.title === this.title;
  }

  toDOM(view: EditorView): HTMLElement {
    const outer = document.createElement("div");
    outer.className = "org-metadata";

    if (this.title) {
      const title = document.createElement("div");
      title.className = "inline-title";
      title.textContent = this.title;
      outer.appendChild(title);
    }

    if (this.entries.length > 0) {
      const card = document.createElement("div");
      card.className = "org-properties";
      for (const entry of this.entries) {
        const row = document.createElement("div");
        row.className = "org-property";
        const key = document.createElement("span");
        key.className = "org-property-key";
        key.textContent = entry.key;
        const value = document.createElement("span");
        value.className = "org-property-value";
        value.textContent = entry.value;
        row.appendChild(key);
        row.appendChild(value);
        card.appendChild(row);
      }
      outer.appendChild(card);
    }

    outer.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.lineFrom } });
      view.focus();
    });
    return outer;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class InlineTitleWidget extends WidgetType {
  constructor(readonly title: string, readonly from: number) {
    super();
  }

  eq(other: InlineTitleWidget): boolean {
    return other.title === this.title;
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = "inline-title org-inline-title";
    el.textContent = this.title;
    el.setAttribute("contenteditable", "false");
    el.addEventListener("click", () => {
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

const docCache = new WeakMap<Text, OrgDoc>();

function docFor(text: Text): OrgDoc {
  let cached = docCache.get(text);
  if (!cached) {
    cached = parseOrgDoc(text.toString());
    docCache.set(text, cached);
  }
  return cached;
}

function decorateInlineTokens(
  tokens: InlineToken[],
  ranges: Range<Decoration>[],
  selection: readonly SelectionRange[],
  options: LivePreviewOptions
): void {
  for (const token of tokens) {
    if (selectionTouches(selection, token.from, token.to)) continue;

    switch (token.type) {
      case "emphasis": {
        const styleClass =
          token.style === "bold"
            ? "cm-strong org-bold"
            : token.style === "italic"
            ? "cm-em org-italic"
            : token.style === "underline"
            ? "cm-underline org-underline"
            : "cm-strikethrough org-strike";
        ranges.push(
          Decoration.mark({ class: `org-emphasis ${styleClass}` }).range(
            token.contentFrom,
            token.contentTo
          )
        );
        ranges.push(EMPTY_REPLACE.range(token.from, token.contentFrom));
        ranges.push(EMPTY_REPLACE.range(token.contentTo, token.to));
        break;
      }
      case "verbatim": {
        ranges.push(
          Decoration.mark({
            class: "cm-inline-code org-verbatim org-code",
            attributes: { spellcheck: "false" },
          }).range(token.contentFrom, token.contentTo)
        );
        ranges.push(EMPTY_REPLACE.range(token.from, token.contentFrom));
        ranges.push(EMPTY_REPLACE.range(token.contentTo, token.to));
        break;
      }
      case "link": {
        const external = /^(https?|ftp):/i.test(token.target);
        const label = token.desc ?? token.target;
        if (token.image) {
          const src = resolveResourcePath(options.app, token.target, options.sourcePath);
          if (src) {
            ranges.push(
              Decoration.replace({
                widget: new ImageWidget(src, label, token.from, token.to),
              }).range(token.from, token.to)
            );
            break;
          }
        }
        ranges.push(
          Decoration.replace({
            widget: new LinkWidget(
              token.target,
              label,
              external,
              options.app,
              options.sourcePath
            ),
          }).range(token.from, token.to)
        );
        break;
      }
      case "timestamp":
        ranges.push(
          Decoration.mark({ class: `org-timestamp${token.active ? " is-active" : ""}` }).range(
            token.from,
            token.to
          )
        );
        break;
      case "footnote":
        ranges.push(Decoration.mark({ class: "org-footnote" }).range(token.from, token.to));
        break;
      case "cookie":
        ranges.push(Decoration.mark({ class: "org-cookie" }).range(token.from, token.to));
        break;
      case "url":
        ranges.push(
          Decoration.replace({
            widget: new LinkWidget(token.url, token.url, true, options.app, options.sourcePath),
          }).range(token.from, token.to)
        );
        break;
      case "tag":
        ranges.push(
          Decoration.replace({ widget: new TagWidget([token.name], options.app) }).range(
            token.from,
            token.to
          )
        );
        break;
      case "math":
        if (options.settings.renderMath) {
          ranges.push(
            Decoration.replace({ widget: new MathWidget(token.latex, token.display) }).range(
              token.from,
              token.to
            )
          );
        } else {
          ranges.push(Decoration.mark({ class: "org-math-source" }).range(token.from, token.to));
        }
        break;
    }
  }
}

function buildDecorations(
  state: EditorState,
  options: LivePreviewOptions,
  doc: OrgDoc
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const selection = state.selection.ranges;
  const settings = options.settings;
  const activeLines = new Set<number>();
  for (const range of selection) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number++) activeLines.add(number - 1);
  }

  const title = doc.title ?? options.displayTitle;
  const skipped = new Set<number>();
  let titleInMetadataCard = false;

  // Pre-compute Prism token ranges for source blocks. Prism is loaded by the
  // plugin at startup; until then this is a no-op and a refresh follows.
  const codeMarks = new Map<number, { from: number; to: number; cls: string }[]>();
  for (const block of doc.blocks) {
    if (block.type !== "src" || block.endLine == null) continue;
    const first = block.beginLine + 1;
    const last = block.endLine - 1;
    if (first > last) continue;
    const firstLine = doc.lines[first];
    const lastLine = doc.lines[last];
    if (!firstLine || !lastLine) continue;
    const base = firstLine.from;
    const content = doc.lines
      .slice(first, last + 1)
      .map((line) => line.text)
      .join("\n");
    for (const range of highlightCode(content, block.lang)) {
      const absFrom = base + range.from;
      const absTo = base + range.to;
      for (let i = first; i <= last; i++) {
        const line = doc.lines[i];
        const from = Math.max(absFrom, line.from);
        const to = Math.min(absTo, line.to);
        if (to <= from) continue;
        const list = codeMarks.get(i) ?? [];
        list.push({ from, to, cls: range.cls });
        codeMarks.set(i, list);
      }
    }
  }

  // Group a leading run of #+KEYWORD lines (Org's equivalent of frontmatter)
  // into one properties card, the way Obsidian renders YAML.
  if (settings.showProperties) {
    let start = 0;
    while (start < doc.lines.length && doc.lines[start].kind === "blank") start++;
    let end = start;
    while (end < doc.lines.length && doc.lines[end].kind === "keyword") end++;
    if (end > start) {
      const first = doc.lines[start];
      const last = doc.lines[end - 1];
      if (!selectionTouches(selection, first.from, last.to)) {
        const entries: { key: string; value: string }[] = [];
        const rawLines: string[] = [];
        for (let i = start; i < end; i++) {
          const text = doc.lines[i].text;
          rawLines.push(text);
          const match = /^\s*#\+([A-Za-z0-9_-]+)(?:\[[^\]]*\])?:\s*(.*)$/.exec(text);
          if (match && match[1].toUpperCase() !== "TITLE") {
            entries.push({ key: match[1].toUpperCase(), value: match[2] });
          }
        }
        if (title || entries.length > 0) {
          ranges.push(
            Decoration.replace({
              widget: new MetadataWidget(
                title,
                entries,
                rawLines.join("\n"),
                first.from
              ),
              block: true,
            }).range(first.from, last.to)
          );
          for (let i = start; i < end; i++) skipped.add(i);
          titleInMetadataCard = true;
        }
      }
    }
  }

  const startsWithBlockWidget =
    doc.mathBlocks.some((block) => block.startLine === 0) ||
    doc.tables.some((table) => table.startLine === 0) ||
    doc.drawers.some((drawer) => drawer.startLine === 0);

  // Inline title, exactly like Obsidian's Markdown editor. When a metadata
  // card is present it carries the title, avoiding overlapping block widgets.
  if (title && !titleInMetadataCard && !startsWithBlockWidget) {
    ranges.push(
      Decoration.widget({
        widget: new InlineTitleWidget(title, 0),
        block: true,
        side: -1,
      }).range(0)
    );
  }

  // Multi-line display math (bare LaTeX environments, $$ blocks, \[...\], and
  // multi-line \(...\)). Reveal the raw lines when the cursor is inside.
  if (settings.renderMath) {
    for (const block of doc.mathBlocks) {
      const first = doc.lines[block.startLine];
      const last = doc.lines[block.endLine];
      if (!first || !last) continue;
      if (selectionTouches(selection, block.from, block.to)) continue;
      ranges.push(
        Decoration.replace({
          widget: new MathWidget(block.latex, true),
          block: true,
        }).range(first.from, last.to)
      );
      for (let i = block.startLine; i <= block.endLine; i++) skipped.add(i);
    }
  }

  // Tables and property drawers are replaced as whole blocks when the cursor
  // is elsewhere, matching Obsidian's Markdown table widget behaviour.
  if (settings.renderTables) {
    for (const table of doc.tables) {
      const first = doc.lines[table.startLine];
      const last = doc.lines[table.endLine];
      if (!first || !last) continue;
      if (selectionTouches(selection, table.from, table.to)) continue;
      ranges.push(
        Decoration.replace({
          widget: new TableWidget(table, options.app, options.sourcePath, settings.renderMath),
          block: true,
        }).range(first.from, last.to)
      );
      for (let i = table.startLine; i <= table.endLine; i++) skipped.add(i);
    }
  }

  if (settings.showProperties) {
    for (const drawer of doc.drawers) {
      if (drawer.endLine == null) continue;
      const first = doc.lines[drawer.startLine];
      const last = doc.lines[drawer.endLine];
      if (!first || !last) continue;
      if (selectionTouches(selection, first.from, last.to)) continue;

      const entries: { key: string; value: string }[] = [];
      const rawLines: string[] = [];
      for (let i = drawer.startLine + 1; i < drawer.endLine; i++) {
        const text = doc.lines[i]?.text ?? "";
        rawLines.push(text);
        const entry = /^\s*:([^:\s][^:]*):\s*(.*)$/.exec(text);
        if (entry) entries.push({ key: entry[1], value: entry[2] });
      }
      ranges.push(
        Decoration.replace({
          widget: new PropertiesWidget(drawer.name, entries, rawLines.join("\n"), first.from),
          block: true,
        }).range(first.from, last.to)
      );
      for (let i = drawer.startLine; i <= drawer.endLine; i++) skipped.add(i);
    }
  }

  for (const line of doc.lines) {
    if (skipped.has(line.index)) continue;
    const active = activeLines.has(line.index);

    switch (line.kind) {
      case "heading": {
        const heading = line.heading;
        if (!heading) break;
        const orgLevel = Math.min(heading.level, 8);
        const mdLevel = Math.min(heading.level, 6);
        ranges.push(
          Decoration.line({
            class: `org-line org-heading org-level-${orgLevel} HyperMD-header HyperMD-header-${mdLevel}`,
          }).range(line.from)
        );
        if (heading.titleTo > heading.titleFrom) {
          ranges.push(
            Decoration.mark({ class: `cm-header cm-header-${mdLevel}` }).range(
              heading.titleFrom,
              heading.titleTo
            )
          );
        }

        const hideTo = heading.keyword?.from ?? heading.priority?.from ?? heading.titleFrom;
        if (active) {
          if (hideTo > line.from) {
            ranges.push(
              Decoration.mark({
                class: `cm-formatting cm-formatting-header cm-formatting-header-${mdLevel} cm-header cm-header-${mdLevel}`,
              }).range(line.from, hideTo)
            );
          }
        } else {
          if (hideTo > line.from) ranges.push(EMPTY_REPLACE.range(line.from, hideTo));
          if (heading.tags.length > 0) {
            const firstTag = heading.tags[0];
            const lastTag = heading.tags[heading.tags.length - 1];
            ranges.push(
              Decoration.replace({
                widget: new TagWidget(
                  heading.tags.map((tag) => tag.name),
                  options.app
                ),
              }).range(firstTag.from, lastTag.to)
            );
          }
        }

        if (heading.keyword) {
          ranges.push(
            Decoration.mark({
              class: `org-todo ${heading.keyword.done ? "org-todo-done" : "org-todo-active"} org-todo-${heading.keyword.text.toLowerCase()}`,
            }).range(heading.keyword.from, heading.keyword.to)
          );
        }
        if (heading.priority) {
          ranges.push(
            Decoration.mark({
              class: `org-priority org-priority-${heading.priority.text.toLowerCase()}`,
            }).range(heading.priority.from, heading.priority.to)
          );
        }

        const titleText = line.text.slice(
          heading.titleFrom - line.from,
          heading.titleTo - line.from
        );
        if (titleText) {
          decorateInlineTokens(
            parseInline(titleText, heading.titleFrom, { tags: false }),
            ranges,
            selection,
            options
          );
        }
        break;
      }

      case "list": {
        const list = line.list;
        if (!list) break;
        const level = listLevel(list.indent);
        const classes = [
          "org-line",
          "org-list-line",
          "HyperMD-list-line",
          `HyperMD-list-line-${level}`,
        ];
        if (list.checkbox) classes.push("HyperMD-task-line");
        ranges.push(Decoration.line({ class: classes.join(" ") }).range(line.from));

        if (list.checkbox) {
          ranges.push(
            Decoration.replace({
              widget: new CheckboxWidget(
                list.checkbox.checked,
                list.checkbox.from,
                list.checkbox.to
              ),
            }).range(list.markerFrom, list.contentFrom)
          );
        } else {
          const markerText = list.ordered ? `${list.number}.` : "-";
          ranges.push(
            Decoration.replace({
              widget: new BulletWidget(list.ordered, markerText, level),
            }).range(list.markerFrom, list.contentFrom)
          );
        }

        if (line.to > list.contentFrom) {
          ranges.push(
            Decoration.mark({ class: `cm-list-${level}` }).range(list.contentFrom, line.to)
          );
          const contentText = line.text.slice(list.contentFrom - line.from);
          if (contentText) {
            decorateInlineTokens(
              parseInline(contentText, list.contentFrom, { tags: false }),
              ranges,
              selection,
              options
            );
          }
        }
        break;
      }

      case "math-block": {
        ranges.push(
          Decoration.line({ class: "org-line org-math-block-source" }).range(line.from)
        );
        break;
      }

      case "table":
      case "table-rule": {
        ranges.push(
          Decoration.line({
            class:
              line.kind === "table-rule"
                ? "org-line org-table-rule"
                : "org-line org-table-line",
          }).range(line.from)
        );
        break;
      }

      case "block-start": {
        const block = line.block;
        if (!block) break;
        if (block.type === "src") {
          ranges.push(
            Decoration.line({
              class:
                "org-line org-block-marker HyperMD-codeblock HyperMD-codeblock-begin HyperMD-codeblock-begin-bg HyperMD-codeblock-bg",
            }).range(line.from)
          );
          if (!active) {
            ranges.push(
              Decoration.replace({
                widget: new CodeFlairWidget(block.lang, line.from),
              }).range(line.from, line.to)
            );
          }
        } else {
          ranges.push(
            Decoration.line({
              class: active
                ? "org-line org-block-marker"
                : "org-line org-block-marker org-block-marker-hidden",
            }).range(line.from)
          );
          if (!active) ranges.push(EMPTY_REPLACE.range(line.from, line.to));
        }
        break;
      }

      case "block-end": {
        const block = line.block;
        if (block?.type === "src") {
          ranges.push(
            Decoration.line({
              class:
                "org-line HyperMD-codeblock HyperMD-codeblock-end HyperMD-codeblock-end-bg HyperMD-codeblock-bg",
            }).range(line.from)
          );
          if (!active) ranges.push(EMPTY_REPLACE.range(line.from, line.to));
        } else {
          ranges.push(
            Decoration.line({
              class: active
                ? "org-line org-block-marker"
                : "org-line org-block-marker org-block-marker-hidden",
            }).range(line.from)
          );
          if (!active) ranges.push(EMPTY_REPLACE.range(line.from, line.to));
        }
        break;
      }

      case "src": {
        ranges.push(
          Decoration.line({
            class: "org-line org-src-body HyperMD-codeblock HyperMD-codeblock-bg",
          }).range(line.from)
        );
        if (line.text) {
          ranges.push(
            Decoration.mark({
              class: "cm-hmd-codeblock",
              attributes: { spellcheck: "false" },
            }).range(line.from, line.to)
          );
          for (const mark of codeMarks.get(line.index) ?? []) {
            ranges.push(
              Decoration.mark({
                class: `cm-hmd-codeblock ${mark.cls}`,
                attributes: { spellcheck: "false" },
              }).range(mark.from, mark.to)
            );
          }
        }
        break;
      }

      case "quote": {
        ranges.push(
          Decoration.line({
            class: "org-line org-quote-body HyperMD-quote HyperMD-quote-1",
          }).range(line.from)
        );
        if (line.text) {
          ranges.push(
            Decoration.mark({ class: "cm-quote cm-quote-1" }).range(line.from, line.to)
          );
        }
        break;
      }

      case "example":
      case "verse":
      case "export": {
        ranges.push(
          Decoration.line({
            class: "org-line HyperMD-codeblock HyperMD-codeblock-bg",
          }).range(line.from)
        );
        if (line.text) {
          ranges.push(
            Decoration.mark({
              class: "cm-hmd-codeblock",
              attributes: { spellcheck: "false" },
            }).range(line.from, line.to)
          );
        }
        break;
      }

      case "center": {
        ranges.push(
          Decoration.line({ class: "org-line org-center-body" }).range(line.from)
        );
        if (line.text) {
          decorateInlineTokens(
            parseInline(line.text, line.from, { tags: false }),
            ranges,
            selection,
            options
          );
        }
        break;
      }

      case "comment-block": {
        ranges.push(
          Decoration.line({ class: "org-line org-comment-block" }).range(line.from)
        );
        break;
      }

      case "drawer-start":
      case "drawer-end":
      case "drawer": {
        const hideMarker = !active && (line.kind === "drawer-start" || line.kind === "drawer-end");
        ranges.push(
          Decoration.line({
            class: hideMarker
              ? "org-line org-drawer-line org-drawer-marker-hidden"
              : "org-line org-drawer-line",
          }).range(line.from)
        );
        if (hideMarker) ranges.push(EMPTY_REPLACE.range(line.from, line.to));
        break;
      }

      case "planning": {
        ranges.push(Decoration.line({ class: "org-line org-planning-line" }).range(line.from));
        if (line.planning) {
          ranges.push(
            Decoration.mark({ class: "org-planning-keyword" }).range(
              line.planning.from,
              line.planning.to
            )
          );
        }
        decorateInlineTokens(
          parseInline(line.text, line.from, { tags: false }),
          ranges,
          selection,
          options
        );
        break;
      }

      case "keyword": {
        ranges.push(Decoration.line({ class: "org-line org-keyword-line" }).range(line.from));
        const keyword = /^(\s*)#\+([A-Za-z0-9_-]+)(\[[^\]]*\])?:/.exec(line.text);
        if (keyword) {
          const from = line.from + keyword[1].length;
          ranges.push(
            Decoration.mark({ class: "org-keyword-key" }).range(from, from + keyword[0].length)
          );
        }
        break;
      }

      case "comment":
        ranges.push(Decoration.line({ class: "org-line org-comment-line" }).range(line.from));
        break;

      case "fixed-width":
        ranges.push(Decoration.line({ class: "org-line org-fixed-width" }).range(line.from));
        break;

      case "rule": {
        ranges.push(Decoration.line({ class: "org-line hr" }).range(line.from));
        ranges.push(
          Decoration.replace({ widget: new RuleWidget() }).range(line.from, line.to)
        );
        break;
      }

      case "text": {
        if (!line.text) break;
        decorateInlineTokens(
          parseInline(line.text, line.from, { tags: false }),
          ranges,
          selection,
          options
        );
        break;
      }

      default:
        break;
    }
  }

  return Decoration.set(ranges, true);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export function orgLivePreview(options: LivePreviewOptions) {
  // Obsidian's patched CodeMirror forbids block/cross-line decorations from a
  // ViewPlugin. A StateField is the supported place for those, and it also
  // gives us the inline title/tables/drawer cards.
  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, options, docFor(state.doc));
    },
    update(value, transaction) {
      const forced = transaction.effects.some((effect) => effect.is(refreshOrgPreview));
      if (transaction.docChanged || transaction.selection !== undefined || forced) {
        return buildDecorations(transaction.state, options, docFor(transaction.state.doc));
      }
      return value.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
