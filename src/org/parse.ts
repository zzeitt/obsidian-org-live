/**
 * A pragmatic, line-oriented Org parser.
 *
 * It does not try to be a full Org implementation. It recognises the
 * structures that matter for rendering: headlines, planning lines, lists,
 * tables, drawers, blocks, keywords, comments, rules and fixed-width text.
 *
 * Offsets in this file are absolute offsets into the original document.
 */

export type BlockType =
  | "src"
  | "quote"
  | "example"
  | "center"
  | "verse"
  | "comment"
  | "export"
  | "special";

export type LineKind =
  | "blank"
  | "text"
  | "heading"
  | "planning"
  | "list"
  | "table"
  | "table-rule"
  | "drawer-start"
  | "drawer-end"
  | "drawer"
  | "block-start"
  | "block-end"
  | "src"
  | "quote"
  | "example"
  | "center"
  | "verse"
  | "comment-block"
  | "export"
  | "comment"
  | "keyword"
  | "rule"
  | "fixed-width"
  | "math-block";

export interface TagSpan {
  /** Tag name without colons. */
  name: string;
  /** Absolute range including the surrounding colons. */
  from: number;
  to: number;
}

export interface HeadingData {
  level: number;
  starsFrom: number;
  starsTo: number;
  /** Keyword such as TODO / DONE, when present. */
  keyword?: { text: string; from: number; to: number; done: boolean };
  priority?: { text: string; from: number; to: number };
  tags: TagSpan[];
  /** Start of the visible headline text (after stars/keyword/priority). */
  titleFrom: number;
  /** End of the headline text (before trailing tags). */
  titleTo: number;
}

export interface ListData {
  indent: number;
  markerFrom: number;
  markerTo: number;
  ordered: boolean;
  number: number;
  checkbox?: { from: number; to: number; checked: boolean };
  contentFrom: number;
}

export interface BlockData {
  id: number;
  type: BlockType;
  beginLine: number;
  endLine?: number;
  lang?: string;
  beginFrom: number;
  beginTo: number;
}

export interface TableCell {
  from: number;
  to: number;
  text: string;
  align?: "left" | "center" | "right";
}

export interface TableRow {
  line: number;
  cells: TableCell[];
}

export interface TableData {
  id: number;
  startLine: number;
  endLine: number;
  /** Absolute range, from the first `|` to the last character of the last row. */
  from: number;
  to: number;
  rows: TableRow[];
  /** Row indices (into rows) that follow a horizontal rule. */
  ruleAfter: number[];
  /** Column alignment from an Org `<l>|<c>|<r>` alignment row. */
  alignments?: TableCell["align"][];
}

export interface DrawerData {
  id: number;
  name: string;
  startLine: number;
  endLine?: number;
}

export interface MathBlockData {
  id: number;
  startLine: number;
  endLine: number;
  from: number;
  to: number;
  latex: string;
  display: boolean;
  kind: "env" | "dollar" | "bracket" | "paren";
  env?: string;
}

export interface OrgLine {
  /** Zero-based line index. */
  index: number;
  from: number;
  to: number;
  text: string;
  kind: LineKind;
  heading?: HeadingData;
  list?: ListData;
  planning?: { keyword: string; from: number; to: number };
  block?: BlockData;
  table?: TableData;
  drawer?: DrawerData;
  mathBlock?: MathBlockData;
  /** True for the first/last content line inside a block. */
  blockFirst?: boolean;
  blockLast?: boolean;
}

export interface OrgDoc {
  lines: OrgLine[];
  blocks: BlockData[];
  tables: TableData[];
  drawers: DrawerData[];
  mathBlocks: MathBlockData[];
  todoActive: Set<string>;
  todoDone: Set<string>;
  title?: string;
}

const BLOCK_TYPES: Record<string, BlockType> = {
  SRC: "src",
  QUOTE: "quote",
  EXAMPLE: "example",
  CENTER: "center",
  VERSE: "verse",
  COMMENT: "comment",
  EXPORT: "export",
};

const DEFAULT_ACTIVE = [
  "TODO",
  "NEXT",
  "STARTED",
  "WAITING",
  "HOLD",
  "HOLDING",
  "BLOCKED",
  "IN-PROGRESS",
  "INPROGRESS",
];
const DEFAULT_DONE = ["DONE", "CANCELED", "CANCELLED", "FINISHED"];

const DRAWER_NAMES = new Set(["PROPERTIES", "LOGBOOK", "END", "CLOCK"]);

function isUpperDrawerName(name: string): boolean {
  return /^[A-Z][A-Z0-9_-]*$/.test(name);
}

const DISPLAY_MATH_ENV =
  /^\s*\\begin\{(align\*?|equation\*?|gather\*?|multline\*?|flalign\*?|alignat\*?|eqnarray\*?|displaymath|math)\}/;

type MathStart = Pick<MathBlockData, "kind" | "env">;

/** Detect display-math delimiters that live outside Org's usual $...$. */
function detectMathBlockStart(raw: string): MathStart | null {
  const env = DISPLAY_MATH_ENV.exec(raw);
  if (env) return { kind: "env", env: env[1] };

  const trimmed = raw.trimStart();
  if (trimmed.startsWith("$$") && !trimmed.slice(2).includes("$$")) {
    return { kind: "dollar" };
  }
  if (trimmed.startsWith("\\[") && !trimmed.slice(2).includes("\\]")) {
    return { kind: "bracket" };
  }
  if (trimmed.startsWith("\\(") && !trimmed.slice(2).includes("\\)")) {
    return { kind: "paren" };
  }
  return null;
}

function mathBlockEnds(raw: string, block: MathBlockData): boolean {
  switch (block.kind) {
    case "env":
      return block.env
        ? new RegExp(`\\\\end\\{${block.env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`).test(raw)
        : false;
    case "dollar":
      return raw.includes("$$");
    case "bracket":
      return raw.includes("\\]");
    case "paren":
      return raw.includes("\\)");
  }
}

/**
 * Parse an entire document. Structural parsing is cheap; inline parsing is
 * deliberately left to `parseInline` and performed lazily for visible lines.
 */
export function parseOrgDoc(source: string): OrgDoc {
  const rawLines = source.split("\n");
  const lines: OrgLine[] = [];
  const blocks: BlockData[] = [];
  const tables: TableData[] = [];
  const drawers: DrawerData[] = [];
  const todoActive = new Set(DEFAULT_ACTIVE);
  const todoDone = new Set(DEFAULT_DONE);
  let title: string | undefined;

  // First pass: keyword-defined TODO lists (they may appear anywhere, but
  // virtually always before the first headline).
  for (const raw of rawLines) {
    const m = /^\s*#\+(?:SEQ_|TYP_)?TODO:\s*(.*)$/i.exec(raw);
    if (!m) continue;
    const [activePart, donePart = ""] = m[1].split("|");
    for (const word of activePart.trim().split(/\s+/).filter(Boolean)) todoActive.add(word);
    for (const word of donePart.trim().split(/\s+/).filter(Boolean)) todoDone.add(word);
  }

  let offset = 0;
  let block: BlockData | undefined;
  let drawer: DrawerData | undefined;
  let table: TableData | undefined;
  let tableLines: OrgLine[] = [];
  const mathBlocks: MathBlockData[] = [];
  let mathBlock: MathBlockData | undefined;

  const finishTable = () => {
    if (!table) return;
    const currentTable = table;
    const last = tableLines[tableLines.length - 1];
    if (last) currentTable.to = last.to;
    if (currentTable.alignments) {
      for (const row of currentTable.rows) {
        row.cells.forEach((cell, index) => {
          if (!cell.align) cell.align = currentTable.alignments?.[index];
        });
      }
    }
    tables.push(currentTable);
    table = undefined;
    tableLines = [];
  };

  const finishMathBlock = (endLine: number) => {
    if (!mathBlock) return;
    const current = mathBlock;
    current.endLine = endLine;
    const first = lines[current.startLine];
    const last = lines[endLine];
    if (first) current.from = first.from;
    if (last) current.to = last.to;

    const full = lines
      .slice(current.startLine, endLine + 1)
      .map((line) => line.text)
      .join("\n");
    let latex = full.trim();
    if (current.kind === "dollar") {
      const open = full.indexOf("$$");
      const close = full.lastIndexOf("$$");
      if (open >= 0 && close > open) latex = full.slice(open + 2, close).trim();
    } else if (current.kind === "bracket") {
      const open = full.indexOf("\\[");
      const close = full.lastIndexOf("\\]");
      if (open >= 0 && close > open) latex = full.slice(open + 2, close).trim();
    } else if (current.kind === "paren") {
      const open = full.indexOf("\\(");
      const close = full.lastIndexOf("\\)");
      if (open >= 0 && close > open) latex = full.slice(open + 2, close).trim();
    }
    current.latex = latex;
    mathBlocks.push(current);
    mathBlock = undefined;
  };

  for (let index = 0; index < rawLines.length; index++) {
    const rawWithCr = rawLines[index];
    const raw = rawWithCr.endsWith("\r") ? rawWithCr.slice(0, -1) : rawWithCr;
    const from = offset;
    const to = from + raw.length;
    offset = to + 1; // the newline that split() removed

    const line: OrgLine = { index, from, to, text: raw, kind: "text" };

    // --- Multi-line display math -----------------------------------------
    if (mathBlock) {
      line.kind = "math-block";
      line.mathBlock = mathBlock;
      lines.push(line);
      if (mathBlockEnds(raw, mathBlock)) finishMathBlock(index);
      continue;
    }

    // --- Inside a block ---------------------------------------------------
    if (block) {
      const endMatch = /^\s*#\+END_([A-Za-z0-9_-]+)\s*$/i.exec(raw);
      if (endMatch) {
        block.endLine = index;
        line.kind = "block-end";
        line.block = block;
        const lastContent = block.endLine - 1;
        if (lastContent >= 0 && lines[lastContent]?.block === block) {
          lines[lastContent].blockLast = true;
        }
        block = undefined;
        lines.push(line);
        continue;
      }

      line.block = block;
      switch (block.type) {
        case "src":
          line.kind = "src";
          break;
        case "quote":
          line.kind = "quote";
          break;
        case "example":
          line.kind = "example";
          break;
        case "center":
          line.kind = "center";
          break;
        case "verse":
          line.kind = "verse";
          break;
        case "comment":
          line.kind = "comment-block";
          break;
        case "export":
          line.kind = "export";
          break;
        default:
          line.kind = "text";
      }
      if (line.kind !== "text" && !lines[lines.length - 1]?.blockFirst) {
        // Mark the first content line; the begin line itself has no content.
        if (block.beginLine === index - 1 || !line.blockFirst) line.blockFirst = true;
      }
      lines.push(line);
      continue;
    }

    // --- Table ------------------------------------------------------------
    const isTableLine = /^\s*\|/.test(raw);
    if (isTableLine) {
      if (!table) {
        table = {
          id: tables.length,
          startLine: index,
          endLine: index,
          from,
          to,
          rows: [],
          ruleAfter: [],
        };
      }
      table.endLine = index;
      const isRule = /^\s*\|[-+|: ]+\|?\s*$/.test(raw) && /-/.test(raw);
      line.kind = isRule ? "table-rule" : "table";
      line.table = table;
      if (!isRule) {
        const row = parseTableRow(raw, from);
        row.line = index;
        // Org column alignment row: all cells contain only <l>, <c> or <r>.
        // It is metadata, not a data row.
        const isAlignmentRow =
          row.cells.length > 0 &&
          row.cells.every((cell) => cell.align !== undefined && cell.text === "");
        if (isAlignmentRow) {
          table.alignments = row.cells.map((cell) => cell.align);
        } else {
          table.rows.push(row);
        }
      } else if (table.rows.length > 0) {
        table.ruleAfter.push(table.rows.length - 1);
      }
      tableLines.push(line);
      lines.push(line);
      continue;
    }
    if (table) finishTable();

    // --- Display math (LaTeX delimiters and bare environments) ----------
    {
      const mathStart = detectMathBlockStart(raw);
      if (mathStart) {
        mathBlock = {
          id: mathBlocks.length,
          startLine: index,
          endLine: index,
          from,
          to,
          latex: "",
          display: true,
          kind: mathStart.kind,
          env: mathStart.env,
        };
        line.kind = "math-block";
        line.mathBlock = mathBlock;
        lines.push(line);
        if (mathStart.kind === "env" && mathBlockEnds(raw, mathBlock)) {
          finishMathBlock(index);
        }
        continue;
      }
    }

    // --- Blank ------------------------------------------------------------
    if (raw.trim() === "") {
      line.kind = "blank";
      lines.push(line);
      continue;
    }

    // --- Block start ------------------------------------------------------
    const blockStart = /^\s*#\+BEGIN_([A-Za-z0-9_-]+)(?:\s+(.*?))?\s*$/i.exec(raw);
    if (blockStart) {
      const name = blockStart[1].toUpperCase();
      const type = BLOCK_TYPES[name] ?? "special";
      const lang = type === "src" ? (blockStart[2] ?? "").trim().split(/\s+/)[0] : undefined;
      block = {
        id: blocks.length,
        type,
        beginLine: index,
        lang,
        beginFrom: from,
        beginTo: to,
      };
      blocks.push(block);
      line.kind = "block-start";
      line.block = block;
      lines.push(line);
      continue;
    }

    // --- Drawer -----------------------------------------------------------
    const drawerStart = /^\s*:([A-Za-z][A-Za-z0-9_-]*):\s*$/.exec(raw);
    if (drawerStart) {
      const name = drawerStart[1];
      if (name === "END" && drawer) {
        drawer.endLine = index;
        line.kind = "drawer-end";
        line.drawer = drawer;
        drawer = undefined;
        lines.push(line);
        continue;
      }
      if (DRAWER_NAMES.has(name.toUpperCase()) || isUpperDrawerName(name)) {
        drawer = { id: drawers.length, name, startLine: index };
        drawers.push(drawer);
        line.kind = "drawer-start";
        line.drawer = drawer;
        lines.push(line);
        continue;
      }
    }
    if (drawer) {
      if (/^\s*:END:\s*$/.test(raw)) {
        drawer.endLine = index;
        line.kind = "drawer-end";
        line.drawer = drawer;
        drawer = undefined;
      } else {
        line.kind = "drawer";
        line.drawer = drawer;
      }
      lines.push(line);
      continue;
    }

    // --- Headline ---------------------------------------------------------
    const headingMatch = /^(\*+)(?=\s|$)(.*)$/.exec(raw);
    if (headingMatch) {
      line.kind = "heading";
      line.heading = parseHeading(raw, from, headingMatch, todoActive, todoDone);
      lines.push(line);
      continue;
    }

    // --- List -------------------------------------------------------------
    const listMatch = /^(\s*)([-+*]|\d+[.)])(\s+)(.*)$/.exec(raw);
    if (listMatch) {
      const indent = listMatch[1].length;
      // A star in column zero is a headline, never a list item.
      if (!(listMatch[2] === "*" && indent === 0)) {
        line.kind = "list";
        line.list = parseList(listMatch, from);
        lines.push(line);
        continue;
      }
    }

    // --- Planning / keyword / comment / rule / fixed width ----------------
    const planning = /^\s*(SCHEDULED|DEADLINE|CLOSED):(?=\s|$)/.exec(raw);
    if (planning) {
      line.kind = "planning";
      line.planning = {
        keyword: planning[1],
        from: from + raw.indexOf(planning[1]),
        to: from + raw.indexOf(planning[1]) + planning[1].length,
      };
      lines.push(line);
      continue;
    }

    const keyword = /^\s*#\+([A-Za-z0-9_-]+)(?:\[[^\]]*\])?:\s*(.*)$/.exec(raw);
    if (keyword) {
      line.kind = "keyword";
      if (keyword[1].toUpperCase() === "TITLE") title = keyword[2].trim();
      lines.push(line);
      continue;
    }

    if (/^\s*#(?:\s|$)/.test(raw)) {
      line.kind = "comment";
      lines.push(line);
      continue;
    }

    if (/^\s*-{5,}\s*$/.test(raw)) {
      line.kind = "rule";
      lines.push(line);
      continue;
    }

    if (/^\s*:(?:\s|$)/.test(raw)) {
      line.kind = "fixed-width";
      lines.push(line);
      continue;
    }

    lines.push(line);
  }

  if (block) {
    // Unterminated block: mark its last line so styling can close the box.
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].block === block) {
        lines[i].blockLast = true;
        break;
      }
    }
  }
  finishTable();
  if (mathBlock) finishMathBlock(rawLines.length - 1);

  return {
    lines,
    blocks,
    tables,
    drawers,
    mathBlocks,
    todoActive,
    todoDone,
    title,
  };
}

function parseHeading(
  raw: string,
  from: number,
  match: RegExpExecArray,
  todoActive: Set<string>,
  todoDone: Set<string>
): HeadingData {
  const stars = match[1];
  const starsFrom = from;
  const starsTo = from + stars.length;
  let cursor = stars.length;
  // Skip the whitespace after the stars.
  while (cursor < raw.length && /\s/.test(raw[cursor])) cursor++;

  let keyword: HeadingData["keyword"];
  // Org lets users define arbitrary TODO keywords (#+TODO: 待办 | 完成), so
  // recognise the first word when it is in the configured sets. The default
  // sets still cover TODO/DONE etc.
  const keywordMatch = /^(\S+)(?=\s|$)/.exec(raw.slice(cursor));
  if (keywordMatch) {
    const word = keywordMatch[1];
    if (todoActive.has(word) || todoDone.has(word)) {
      const kFrom = from + cursor;
      const kTo = kFrom + word.length;
      keyword = { text: word, from: kFrom, to: kTo, done: todoDone.has(word) };
      cursor += word.length;
      while (cursor < raw.length && /\s/.test(raw[cursor])) cursor++;
    }
  }

  let priority: HeadingData["priority"];
  const priorityMatch = /^\[#([A-Za-z0-9])\]/.exec(raw.slice(cursor));
  if (priorityMatch) {
    priority = {
      text: priorityMatch[1],
      from: from + cursor,
      to: from + cursor + priorityMatch[0].length,
    };
    cursor += priorityMatch[0].length;
    while (cursor < raw.length && /\s/.test(raw[cursor])) cursor++;
  }

  let titleEnd = raw.length;
  const tags: TagSpan[] = [];
  const tagMatch = /(^|\s)(:[\p{L}\p{N}_@#%]+(?::[\p{L}\p{N}_@#%]+)*:)\s*$/u.exec(raw);
  if (tagMatch) {
    const tagGroup = tagMatch[2];
    const groupStart = from + tagMatch.index + tagMatch[1].length;
    let pos = groupStart;
    // group is ":a:b:c:". Consecutive tags share their separating colon, so
    // each span includes the shared colon on the left and the next tag starts
    // one character before the previous span ended. The final span stops at
    // the line end — never on the following newline.
    const names = tagGroup.slice(1, -1).split(":");
    for (const name of names) {
      if (!name) continue;
      const spanFrom = pos;
      const spanTo = Math.min(from + raw.length, pos + name.length + 2);
      tags.push({ name, from: spanFrom, to: spanTo });
      pos = spanTo - 1;
    }
    titleEnd = tagMatch.index;
    // Remove whitespace immediately before the tags from the title.
    while (titleEnd > cursor && /\s/.test(raw[titleEnd - 1])) titleEnd--;
  }

  let titleFrom = from + cursor;
  if (titleFrom > from + titleEnd) titleFrom = from + titleEnd;

  return {
    level: stars.length,
    starsFrom,
    starsTo,
    keyword,
    priority,
    tags,
    titleFrom,
    titleTo: from + titleEnd,
  };
}

function parseList(match: RegExpExecArray, from: number): ListData {
  const indent = match[1].length;
  const marker = match[2];
  const markerFrom = from + indent;
  const markerTo = markerFrom + marker.length;
  const ordered = /^\d/.test(marker);
  const number = ordered ? parseInt(marker, 10) : 0;

  let contentStart = match.index + match[1].length + marker.length + match[3].length;
  const afterMarker = match[4];
  let checkbox: ListData["checkbox"];
  const cb = /^\[([ Xx-])\]\s+/.exec(afterMarker);
  if (cb) {
    const cbFrom = from + contentStart;
    const cbTo = cbFrom + 3;
    checkbox = { from: cbFrom, to: cbTo, checked: cb[1].toLowerCase() === "x" };
    contentStart += cb[0].length;
  }

  return {
    indent,
    markerFrom,
    markerTo,
    ordered,
    number,
    checkbox,
    contentFrom: from + contentStart,
  };
}

function parseTableRow(raw: string, from: number): TableRow {
  const row: TableRow = { line: 0, cells: [] };
  // Find pipe positions. Escaped pipes (\vert) are rare; we ignore them.
  const pipes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "|" && raw[i - 1] !== "\\") pipes.push(i);
  }
  if (pipes.length === 0) return row;

  const starts = pipes.slice();
  const ends = pipes.slice(1);
  // Content after the last pipe belongs to the last cell when the line does
  // not end with a pipe.
  if (raw.slice(pipes[pipes.length - 1] + 1).trim() !== "") {
    ends.push(raw.length);
  }

  for (let i = 0; i < ends.length; i++) {
    const start = starts[i] + 1;
    const end = ends[i];
    let text = raw.slice(start, end);
    let cellFrom = from + start;
    let cellTo = from + end;
    // Trim whitespace while keeping absolute offsets accurate.
    const leading = text.length - text.trimStart().length;
    const trailing = text.length - text.trimEnd().length;
    cellFrom += leading;
    cellTo -= trailing;
    text = raw.slice(start + leading, end - trailing);

    let align: TableCell["align"];
    const alignMatch = /^<([lcr])>\s?/.exec(text);
    if (alignMatch) {
      align = alignMatch[1] === "l" ? "left" : alignMatch[1] === "c" ? "center" : "right";
      cellFrom += alignMatch[0].length;
      text = text.slice(alignMatch[0].length);
    }
    row.cells.push({ from: cellFrom, to: cellTo, text, align });
  }
  return row;
}
