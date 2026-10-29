import { EditorState, Text } from "@codemirror/state";
import { foldedRanges } from "@codemirror/language";
import { BlockType, OrgDoc, parseOrgDoc } from "../org/parse";
import { getTodoKeywordVersion } from "../org/todoKeywords";

const docCache = new WeakMap<Text, { version: number; doc: OrgDoc }>();

export function orgDocForText(text: Text): OrgDoc {
  const version = getTodoKeywordVersion();
  const cached = docCache.get(text);
  if (cached && cached.version === version) return cached.doc;
  const doc = parseOrgDoc(text.toString());
  docCache.set(text, { version, doc });
  return doc;
}

export interface OrgFoldInfo {
  /** Fold range start (hidden content starts here). */
  from: number;
  /** Fold range end. */
  to: number;
  /** Zero-based line where the fold control is shown. */
  indicatorLine: number;
  type: BlockType;
  folded: boolean;
}

function isRangeFolded(state: EditorState, from: number, to: number): boolean {
  const iterator = foldedRanges(state).iter();
  while (iterator.value) {
    if (iterator.from <= from && iterator.to >= to) return true;
    iterator.next();
  }
  return false;
}

function infoForBlock(
  state: EditorState,
  doc: OrgDoc,
  block: OrgDoc["blocks"][number]
): OrgFoldInfo | null {
  if (block.endLine == null) return null;
  const begin = doc.lines[block.beginLine];
  const end = doc.lines[block.endLine];
  if (!begin || !end) return null;

  const isSrc = block.type === "src";
  // Src folds from the end of the #+BEGIN_SRC line, keeping the header/flair
  // visible. Other blocks fold from the first content line, keeping a chevron
  // at its start.
  const indicatorLine = isSrc ? block.beginLine : block.beginLine + 1;
  if (indicatorLine > block.endLine) return null;
  const indicator = doc.lines[indicatorLine];
  if (!indicator) return null;

  const from = isSrc ? begin.to : indicator.from;
  const to = end.to;
  if (to <= from) return null;

  return {
    from,
    to,
    indicatorLine,
    type: block.type,
    folded: isRangeFolded(state, from, to),
  };
}

export function orgFoldableBlocks(state: EditorState): OrgFoldInfo[] {
  const doc = orgDocForText(state.doc);
  const result: OrgFoldInfo[] = [];
  for (const block of doc.blocks) {
    const info = infoForBlock(state, doc, block);
    if (info) result.push(info);
  }
  return result;
}

/** Fold range for the block containing the given zero-based line. */
export function orgFoldForLine(state: EditorState, lineNumber: number): OrgFoldInfo | null {
  const doc = orgDocForText(state.doc);
  for (const block of doc.blocks) {
    if (block.endLine == null) continue;
    if (lineNumber < block.beginLine || lineNumber > block.endLine) continue;
    return infoForBlock(state, doc, block);
  }
  return null;
}
