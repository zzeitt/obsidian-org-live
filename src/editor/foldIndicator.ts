import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { foldEffect, unfoldEffect } from "@codemirror/language";
import { OrgFoldInfo, orgFoldableBlocks } from "./fold";

class OrgFoldWidget extends WidgetType {
  constructor(readonly info: OrgFoldInfo) {
    super();
  }

  eq(other: OrgFoldWidget): boolean {
    return (
      other.info.from === this.info.from &&
      other.info.to === this.info.to &&
      other.info.folded === this.info.folded
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = `org-fold-indicator org-fold-indicator-${this.info.type}${
      this.info.folded ? " is-folded" : ""
    }`;
    span.textContent = this.info.folded ? "▸" : "▾";
    span.title = this.info.folded ? "Unfold block" : "Fold block";
    span.setAttribute("role", "button");
    span.setAttribute("aria-label", span.title);
    span.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const effect = this.info.folded
        ? unfoldEffect.of({ from: this.info.from, to: this.info.to })
        : foldEffect.of({ from: this.info.from, to: this.info.to });
      view.dispatch({ effects: effect });
      view.focus();
    });
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const ranges = [];
  const visible = view.visibleRanges;
  for (const info of orgFoldableBlocks(view.state)) {
    // Src blocks put their fold control inside the language-flair header
    // widget so it cannot be clipped by the full-line replace.
    if (info.type === "src") continue;
    const line = view.state.doc.line(info.indicatorLine + 1);
    const inView = visible.some((range) => line.to >= range.from && line.from <= range.to);
    if (!inView) continue;
    ranges.push(
      Decoration.widget({
        widget: new OrgFoldWidget(info),
        side: -1,
      }).range(line.from)
    );
  }
  return Decoration.set(ranges, true);
}

export function orgFoldIndicators() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate) {
        // Fold effects, doc edits, cursor movement and scrolling can all
        // change which indicators exist or whether they are folded.
        this.decorations = buildDecorations(update.view);
      }
    },
    {
      decorations: (value) => value.decorations,
    }
  );
}
