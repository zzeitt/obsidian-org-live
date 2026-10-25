import { App, EventRef, Plugin, TFile } from "obsidian";
import { VIEW_TYPE_ORG } from "../constants";
import { parseOrgDoc } from "../org/parse";

/**
 * Bridge Org headings into Obsidian's core Outline view.
 *
 * The core outline view is hard-coded to accept only Markdown files:
 *
 *   getHeadings() { if (this.file?.extension !== "md") return []; ... }
 *
 * There is no public API for registering headings for another file type. We
 * therefore wrap `getHeadings` on each outline view instance, return parsed
 * Org headings for `.org` files and delegate to the original method for
 * everything else. Clicking an injected item is intercepted and routed to the
 * Org Live view's `setEphemeralState({line})`.
 *
 * All internal calls are guarded; if Obsidian changes the outline view shape,
 * the bridge simply does nothing and Markdown outlines keep working.
 */

interface PositionLike {
  line: number;
  col: number;
  offset: number;
}

interface HeadingCacheLike {
  heading: string;
  level: number;
  position: { start: PositionLike; end: PositionLike };
}

interface OutlineItemLike {
  heading?: HeadingCacheLike;
  selfEl?: HTMLElement;
}

interface OutlineViewLike {
  file?: TFile;
  containerEl: HTMLElement;
  cachedHeadingDom?: OutlineItemLike[];
  getHeadings?: (...args: unknown[]) => HeadingCacheLike[];
  update?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

interface PatchRecord {
  originalGetHeadings: (...args: unknown[]) => HeadingCacheLike[];
  originalUpdate?: (...args: unknown[]) => unknown;
  onClick: (event: MouseEvent) => void;
}

function extractOrgHeadings(source: string): HeadingCacheLike[] {
  const doc = parseOrgDoc(source);
  const headings: HeadingCacheLike[] = [];

  for (const line of doc.lines) {
    if (line.kind !== "heading" || !line.heading) continue;
    const heading = line.heading;
    const title = line.text
      .slice(heading.titleFrom - line.from, heading.titleTo - line.from)
      .trim();
    if (!title) continue;

    const label = heading.keyword ? `${heading.keyword.text} ${title}` : title;
    headings.push({
      heading: label,
      level: heading.level,
      position: {
        start: { line: line.index, col: 0, offset: line.from },
        end: { line: line.index, col: line.text.length, offset: line.to },
      },
    });
  }

  return headings;
}

export class OrgOutlineBridge {
  private headings = new Map<string, HeadingCacheLike[]>();
  private patched = new Set<OutlineViewLike>();
  private records = new WeakMap<OutlineViewLike, PatchRecord>();

  constructor(
    private app: App,
    private plugin: Plugin
  ) {}

  start(): void {
    this.app.workspace.onLayoutReady(() => this.patchAll());

    this.register(this.app.workspace.on("layout-change", () => this.patchAll()));
    this.register(this.app.workspace.on("active-leaf-change", () => this.patchAll()));
    this.register(
      this.app.workspace.on("file-open", (file) => {
        this.patchAll();
        if (file?.extension === "org") this.refresh(file.path);
      })
    );
    this.register(
      this.app.vault.on("delete", (file) => {
        this.headings.delete(file.path);
        this.refresh(file.path);
      })
    );
    this.register(
      this.app.vault.on("rename", (file, oldPath) => {
        const cached = this.headings.get(oldPath);
        if (cached) {
          this.headings.delete(oldPath);
          this.headings.set(file.path, cached);
        }
        this.refresh(file.path);
        if (oldPath !== file.path) this.refresh(oldPath);
      })
    );
  }

  destroy(): void {
    for (const view of this.patched) {
      const record = this.records.get(view);
      if (!record) continue;
      view.getHeadings = record.originalGetHeadings;
      if (record.originalUpdate) view.update = record.originalUpdate;
      view.containerEl.removeEventListener("click", record.onClick, true);
      this.records.delete(view);
    }
    this.patched.clear();
    this.headings.clear();
  }

  /** Called by OrgView whenever its text changes. */
  updateFile(file: TFile | null | undefined, source: string): void {
    if (!file) return;
    this.headings.set(file.path, extractOrgHeadings(source));
    this.refresh(file.path);
  }

  private register(ref: EventRef): void {
    this.plugin.registerEvent(ref);
  }

  private patchAll(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("outline")) {
      this.patch(leaf.view as unknown as OutlineViewLike);
    }
  }

  private patch(view: OutlineViewLike): void {
    if (!view?.containerEl || this.patched.has(view)) return;
    const originalGetHeadings = view.getHeadings;
    if (typeof originalGetHeadings !== "function") return;

    const originalUpdate = view.update;

    view.getHeadings = () => {
      const file = view.file;
      if (file?.extension === "org") {
        return this.headings.get(file.path) ?? [];
      }
      return originalGetHeadings.call(view);
    };

    if (typeof originalUpdate === "function") {
      view.update = () => {
        const result = originalUpdate.call(view);
        this.decorate(view);
        return result;
      };
    }

    const onClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      const item = target?.closest(".tree-item-self") as HTMLElement | null;
      if (!item || !view.containerEl.contains(item)) return;
      const line = item.dataset.orgLine;
      if (line == null) return;
      const file = view.file;
      if (!file || file.extension !== "org") return;
      event.preventDefault();
      event.stopPropagation();
      void this.navigate(file, Number(line));
    };

    view.containerEl.addEventListener("click", onClick, true);
    this.records.set(view, { originalGetHeadings, originalUpdate, onClick });
    this.patched.add(view);

    // Decorate/re-render if this view is already bound to an Org file.
    try {
      view.update?.();
    } catch (error) {
      console.warn("Org Live: outline update failed", error);
    }
    this.decorate(view);
  }

  private decorate(view: OutlineViewLike): void {
    const items = view.cachedHeadingDom;
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const element = item?.selfEl;
      const line = item?.heading?.position?.start?.line;
      if (element && typeof line === "number") {
        element.dataset.orgLine = String(line);
      }
    }
  }

  private refresh(path: string | undefined): void {
    if (!path) return;
    for (const view of this.patched) {
      if (view.file?.path !== path) continue;
      try {
        view.update?.();
      } catch (error) {
        console.warn("Org Live: outline refresh failed", error);
      }
      this.decorate(view);
    }
  }

  private async navigate(file: TFile, line: number): Promise<void> {
    let leaf = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_ORG)
      .find((candidate) => (candidate.view as unknown as OutlineViewLike).file?.path === file.path);

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(file);
    }

    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view as unknown as {
      setEphemeralState?: (state: { line: number }) => void;
      editor?: { state: { doc: { lines: number; line(n: number): { from: number } } }; dispatch: (spec: unknown) => void; focus: () => void };
    };

    const apply = () => {
      if (typeof view.setEphemeralState === "function") {
        view.setEphemeralState({ line });
        return;
      }
      // Fallback for a view that has no ephemeral-state support yet.
      if (!view.editor) return;
      const number = Math.max(1, Math.min(view.editor.state.doc.lines, line + 1));
      const from = view.editor.state.doc.line(number).from;
      view.editor.dispatch({ selection: { anchor: from }, scrollIntoView: true });
      view.editor.focus();
    };

    apply();
    window.setTimeout(apply, 80);
  }
}
