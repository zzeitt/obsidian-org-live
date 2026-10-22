import { setIcon, TextFileView, WorkspaceLeaf } from "obsidian";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type OrgLivePlugin from "../main";
import { VIEW_TYPE_ORG } from "../constants";
import {
  createOrgEditorState,
  cycleTodo as cycleTodoCommand,
  livePreviewExtension,
} from "../editor/orgEditor";
import { refreshOrgPreview } from "../editor/livePreview";
import { renderOrgPreview } from "../preview/render";

export class OrgView extends TextFileView {
  editor: EditorView | null = null;
  private mode: "live" | "preview" = "live";
  private editorHost: HTMLElement | null = null;
  private previewHost: HTMLElement | null = null;
  private modeAction: HTMLElement | null = null;
  private livePreviewCompartment = new Compartment();
  private suppressChange = false;
  private pendingPreviewScrollRatio: number | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: OrgLivePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_ORG;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Org";
  }

  getIcon(): string {
    return "file-text";
  }

  protected async onOpen(): Promise<void> {
    // Reuse Obsidian's Markdown live-preview shell classes. Every theme already
    // targets these, which is what makes the Org view look native.
    this.contentEl.addClasses([
      "org-view",
      "markdown-source-view",
      "cm-s-obsidian",
      "mod-cm6",
      "node-insert-event",
      "is-readable-line-width",
      "is-live-preview",
    ]);
    this.editorHost = this.contentEl.createDiv({ cls: "org-editor-host" });
    this.previewHost = this.contentEl.createDiv({ cls: "org-preview-host" });
    this.createEditor();
    this.modeAction = this.addAction(
      "book-open",
      this.plugin.t("action.readingView"),
      () => this.toggleMode()
    );
    this.registerDomEvent(this.contentEl, "click", (event) => {
      if (this.mode === "live" && this.editor && event.target === this.editorHost) {
        this.editor.focus();
      }
    });
  }

  protected async onClose(): Promise<void> {
    await this.save();
    this.editor?.destroy();
    this.editor = null;
  }

  private createEditor(): void {
    if (!this.editorHost) return;
    const state = createOrgEditorState(this.data ?? "", {
      app: this.app,
      sourcePath: this.sourcePath(),
      displayTitle: this.displayTitle(),
      settings: this.plugin.settings,
      livePreviewCompartment: this.livePreviewCompartment,
      onDocChanged: () => this.handleDocChanged(),
    });
    this.editor = new EditorView({ state, parent: this.editorHost });
    this.applyMode(false);
  }

  private sourcePath(): string {
    return this.file?.path ?? "";
  }

  private displayTitle(): string {
    return this.file?.basename ?? "Org";
  }

  private handleDocChanged(): void {
    if (this.suppressChange) return;
    this.data = this.editor?.state.doc.toString() ?? this.data;
    this.requestSave();
    if (this.mode === "preview") this.renderPreview();
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data;
    if (!this.editor) return;
    if (clear || this.editor.state.doc.toString() !== data) {
      this.suppressChange = true;
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: data },
        selection: { anchor: 0 },
        scrollIntoView: false,
      });
      this.suppressChange = false;
    }
    if (this.mode === "preview") this.renderPreview();
  }

  getViewData(): string {
    return this.editor?.state.doc.toString() ?? this.data ?? "";
  }

  clear(): void {
    this.data = "";
    if (this.editor) {
      this.suppressChange = true;
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: "" },
        selection: { anchor: 0 },
      });
      this.suppressChange = false;
    }
    this.previewHost?.empty();
  }

  toggleMode(): void {
    this.setMode(this.mode === "live" ? "preview" : "live");
  }

  setMode(mode: "live" | "preview"): void {
    if (this.mode === mode) {
      if (mode === "live") this.focusEditor();
      return;
    }
    if (mode === "preview" && this.mode === "live" && this.editor) {
      const scroller = this.editor.scrollDOM;
      const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      this.pendingPreviewScrollRatio = scroller.scrollTop / max;
    }
    this.mode = mode;
    this.applyMode();
  }

  private applyMode(focus = true): void {
    this.contentEl.toggleClass("is-preview-mode", this.mode === "preview");
    this.updateModeAction();
    if (this.mode === "preview") {
      this.renderPreview();
    } else if (focus) {
      this.editor?.focus();
    }
  }

  private updateModeAction(): void {
    if (!this.modeAction) return;
    const toPreview = this.mode !== "preview";
    setIcon(this.modeAction, toPreview ? "book-open" : "pencil");
    const label = this.plugin.t(
      toPreview ? "action.readingView" : "action.livePreview"
    );
    this.modeAction.setAttribute("aria-label", label);
    this.modeAction.setAttribute("title", label);
  }

  /** Update localized labels without rebuilding the editor. */
  refreshLocale(): void {
    this.updateModeAction();
  }

  renderPreview(): void {
    if (!this.previewHost) return;
    const existing = this.previewHost.querySelector<HTMLElement>(".org-preview");
    const scrollTop = existing?.scrollTop ?? 0;
    const ratio = this.pendingPreviewScrollRatio;
    this.pendingPreviewScrollRatio = null;

    const source = this.editor?.state.doc.toString() ?? this.data ?? "";
    const preview = renderOrgPreview(source, this.app, this.sourcePath(), {
      settings: this.plugin.settings,
      fallbackTitle: this.displayTitle(),
      onToggleTask: (from, to, checked) => {
        this.editor?.dispatch({
          changes: { from, to, insert: checked ? "[X]" : "[ ]" },
          userEvent: "input",
        });
      },
    });
    this.previewHost.empty();
    this.previewHost.appendChild(preview);

    if (ratio != null) {
      requestAnimationFrame(() => {
        const max = Math.max(0, preview.scrollHeight - preview.clientHeight);
        preview.scrollTop = ratio * max;
      });
    } else {
      preview.scrollTop = scrollTop;
    }
  }

  refreshSettings(): void {
    if (!this.editor) return;
    this.editor.dispatch({
      effects: [
        this.livePreviewCompartment.reconfigure(
          livePreviewExtension({
            app: this.app,
            sourcePath: this.sourcePath(),
            displayTitle: this.displayTitle(),
            settings: this.plugin.settings,
            livePreviewCompartment: this.livePreviewCompartment,
            onDocChanged: () => this.handleDocChanged(),
          })
        ),
        refreshOrgPreview.of(null),
      ],
    });
    this.updateModeAction();
    if (this.mode === "preview") this.renderPreview();
  }

  cycleTodo(): void {
    if (!this.editor) return;
    if (cycleTodoCommand(this.editor)) {
      this.editor.focus();
    }
  }

  focusEditor(): void {
    this.editor?.focus();
  }
}
