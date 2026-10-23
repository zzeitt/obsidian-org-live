import { App, Platform } from "obsidian";
import { Compartment, EditorState, Extension } from "@codemirror/state";
import { Command, EditorView, KeyBinding, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { codeFolding, foldKeymap, foldService } from "@codemirror/language";
import { orgLivePreview } from "./livePreview";
import { orgFoldForLine } from "./fold";
import { orgFoldIndicators } from "./foldIndicator";
import { OrgLiveSettings } from "../settings";

const LIST_RE = /^(\s*)([-+*]|\d+[.)])(\s+)(\[[ Xx-]\]\s+)?(.*)$/;

export const continueList: Command = (view) => {
  const state = view.state;
  const selection = state.selection.main;
  if (!selection.empty) return false;
  const line = state.doc.lineAt(selection.head);
  if (selection.head !== line.to) return false;

  const match = LIST_RE.exec(line.text);
  if (!match) return false;
  const [, indent, marker, , checkbox, content] = match;
  if (indent.length === 0 && marker === "*") return false;

  if (content.trim() === "") {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
      selection: { anchor: line.from },
    });
    return true;
  }

  let nextMarker = marker;
  if (/^\d/.test(marker)) {
    const digits = /^\d+/.exec(marker)?.[0] ?? "1";
    nextMarker = `${parseInt(digits, 10) + 1}${marker.slice(digits.length)}`;
  }
  const prefix = checkbox ? "[ ] " : "";
  view.dispatch(state.replaceSelection(`\n${indent}${nextMarker} ${prefix}`));
  return true;
};

function selectedLines(view: EditorView): number[] {
  const lines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return [...lines];
}

export const indentList: Command = (view) => {
  const changes: { from: number; insert: string }[] = [];
  for (const number of selectedLines(view)) {
    const line = view.state.doc.line(number);
    if (!/^\s*(?:[-+*]|\d+[.)])\s/.test(line.text)) return false;
    changes.push({ from: line.from, insert: "  " });
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
};

export const outdentList: Command = (view) => {
  const changes: { from: number; to: number }[] = [];
  for (const number of selectedLines(view)) {
    const line = view.state.doc.line(number);
    const spaces = Math.min(2, /^ */.exec(line.text)?.[0].length ?? 0);
    if (spaces > 0) changes.push({ from: line.from, to: line.from + spaces });
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
};

const KNOWN_TODO = new Set([
  "TODO",
  "NEXT",
  "STARTED",
  "WAITING",
  "HOLD",
  "HOLDING",
  "BLOCKED",
  "IN-PROGRESS",
  "INPROGRESS",
  "DONE",
  "CANCELED",
  "CANCELLED",
  "FINISHED",
]);

/** Cycle TODO -> DONE -> (none) -> TODO on the headline at the cursor. */
export function cycleTodo(view: EditorView): boolean {
  const state = view.state;
  const line = state.doc.lineAt(state.selection.main.head);
  const stars = /^\*+/.exec(line.text);
  if (!stars) return false;
  let cursor = stars[0].length;
  const leading = /^\s*/.exec(line.text.slice(cursor))?.[0] ?? "";
  cursor += leading.length;
  const rest = line.text.slice(cursor);
  const keyword = /^([A-Z][A-Z0-9_@-]*)(?=\s|$)/.exec(rest);

  if (keyword && KNOWN_TODO.has(keyword[1])) {
    const current = keyword[1];
    const from = line.from + cursor;
    const to = from + current.length;
    if (current === "TODO" || current === "NEXT" || current === "WAITING" || current === "STARTED") {
      view.dispatch({ changes: { from, to, insert: "DONE" } });
    } else {
      // Remove the keyword and the whitespace that follows it.
      let end = to;
      while (end < line.to && /\s/.test(state.sliceDoc(end, end + 1))) end++;
      view.dispatch({ changes: { from, to: end, insert: "" } });
    }
    return true;
  }

  const insertAt = line.from + cursor;
  view.dispatch({ changes: { from: insertAt, insert: "TODO " } });
  return true;
}

const orgKeymap: readonly KeyBinding[] = [
  { key: "Enter", run: continueList },
  { key: "Tab", run: indentList },
  { key: "Shift-Tab", run: outdentList },
];

export interface OrgEditorOptions {
  app: App;
  sourcePath: string;
  displayTitle: string;
  settings: OrgLiveSettings;
  livePreviewCompartment: Compartment;
  onDocChanged: () => void;
}

export function livePreviewExtension(options: OrgEditorOptions): Extension {
  if (!options.settings.livePreview) return [];
  return orgLivePreview({
    app: options.app,
    sourcePath: options.sourcePath,
    displayTitle: options.displayTitle,
    settings: options.settings,
  });
}

export function createOrgEditorState(doc: string, options: OrgEditorOptions): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      // iOS/Android need the native selection so the system selection handles
      // and the keyboard work correctly. Desktop keeps CM6's drawn cursor.
      ...(Platform.isMobileApp ? [] : [drawSelection()]),
      EditorView.lineWrapping,
      EditorState.allowMultipleSelections.of(true),
      EditorView.contentAttributes.of({
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      }),
      codeFolding(),
      foldService.of((state, lineStart) => {
        const info = orgFoldForLine(state, state.doc.lineAt(lineStart).number - 1);
        return info ? { from: info.from, to: info.to } : null;
      }),
      orgFoldIndicators(),
      keymap.of([...foldKeymap, ...orgKeymap, ...defaultKeymap, ...historyKeymap]),
      options.livePreviewCompartment.of(livePreviewExtension(options)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) options.onDocChanged();
      }),
    ],
  });
}
