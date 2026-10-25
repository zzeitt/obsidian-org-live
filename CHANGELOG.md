# Changelog

## 0.2.3 — 2026-10-25

### Community scan fixes (second pass)

- Raised `minAppVersion` to `1.13.0` to match the declarative settings APIs
  (`getSettingDefinitions`, `getControlValue`, `setControlValue`, `update`).
- Removed the deprecated imperative `display()` settings fallback; 1.13+ now
  renders the settings entirely from definitions, including settings search.
  This also removes the plugin-name settings heading.
- Removed the last `document.create*` path: detached widget nodes are created
  through a hidden `document.body.createDiv()` Obsidian host.
- Removed all CSS `!important` rules; marker lines use a higher-specificity
  `cm-line` selector instead.

Remaining recommendation: GitHub artifact attestations for release assets.

## 0.2.2 — 2026-10-25

### Community scan fixes

- Manifest description no longer contains the word “Obsidian”.
- Removed direct `innerHTML` assignments from the live table, reading view and
  Prism code hydration. HTML fragments now go through Obsidian's
  `sanitizeHTMLToDom` and DOM append/replace APIs.
- Settings heading uses `Setting.setHeading()`; the tab now also implements
  `getSettingDefinitions()` for settings search on Obsidian 1.13+.
- Replaced `document.createElement` with an Obsidian-aware detached
  `DocumentFragment.createEl` helper.
- Fixed Outline `this` aliasing, unhandled `openLinkText` promise,
  `requestAnimationFrame` in popouts, Prism `any` typing, unnecessary regex
  escapes, and unused imports.
- The 0.2.2 release intentionally omits `versions.json` from release assets
  (it remains at the repo root); Obsidian only downloads `main.js`,
  `manifest.json` and `styles.css`.

Remaining scan recommendations: build provenance attestations and a small
number of CSS `!important` rules used to collapse Org marker lines.

## 0.2.1 — 2026-10-24

### Fixed

- Source-block fold control is now rendered inside the language-flair header
  widget, so it is not clipped by the full-line replace and is clearly visible
  when folded.
- Suppress the expected MathJax “not loaded yet” warning on first render; only
  real KaTeX/MathJax failures are logged after loading.
- Preserve Org headline levels above 6 in the core Outline bridge.

### Docs

- Added `docs/community-submission.md` for the new `community.obsidian.md`
  portal workflow (the old `obsidian-releases` PR route is deprecated).

## 0.2.0 — 2026-10-24

### Features

- **Code block folding**: `#+BEGIN_SRC` / `#+END_SRC` and quote, example,
  center, verse, comment and export blocks can be folded from an inline
  chevron. `foldService`, `foldKeymap` and CM6 fold state are used; editing and
  undo do not modify the document.
- **Core Outline integration**: Org headlines appear in Obsidian's core
  Outline view with their hierarchy, TODO keyword and Chinese titles. Clicking
  an item jumps to the headline and focuses the Org Live editor. Markdown
  outlines are delegated to the original implementation and remain unchanged.
  The bridge is guarded and falls back silently if Obsidian's internal outline
  shape changes.
- Added `shots/fold-src.png`, `shots/outline-org.png`, and verification steps.

### Notes

- Outline integration necessarily wraps the core outline view's private
  `getHeadings`/`update` methods because Obsidian does not expose a public API
  for headings in non-Markdown files. The bridge only affects `.org` files and
  restores the original methods on unload.

## 0.1.1 — 2026-10-23

### Fixed

- **LaTeX / Markdown math delimiters now render**:
  - inline `\(...\)`
  - display `\[...\]`
  - multi-line `$$ ... $$`
  - bare display environments `\begin{align}`, `align*`, `equation`, `equation*`,
    `gather`, `multline`, `flalign`, `alignat`, `eqnarray`, `displaymath`
- Multi-line display math is rendered as one block in live preview and reading
  view. Placing the cursor inside reveals the raw lines for editing; moving away
  renders the formula again.
- Added `test/math-formats.org` as a regression corpus.

## 0.1.0 — 2026-10-23

Initial public beta.

### Features

- Native `.org` file view registered by the plugin; no extra extension plugin required.
- Live preview with cursor-sensitive markup revealing.
- Reading view with Obsidian `.markdown-preview-view.markdown-rendered` styling.
- Native Markdown visual parity through `HyperMD-*`, `cm-*`, `cm-hashtag`, `task-list-item-checkbox`, `code-block-flair`, `math` and `inline-title`.
- TODO states (including custom/Chinese keywords), priorities, tags, planning lines, property drawers, `#+KEYWORD` metadata cards.
- Emphasis, inline code/verbatim, links, bare URLs, timestamps, cookies, footnotes, inline and display math.
- Lists, checkboxes, tables (including `<l>/<c>/<r>` alignment rows), source blocks with Prism highlighting, quotes, examples, center, verse, comments, fixed-width and rules.
- Interactive checkboxes that save, internal links, tag search, table click-to-edit and TODO cycling.
- Bilingual settings: Automatic / English / 中文; command and view-action labels update immediately.
- Mobile/iOS adaptation: native mobile selection, safe-area/toolbar padding, touch targets, horizontal table scrolling and Markdown-style code wrapping.
- BRAT/release-ready manifest, `versions.json` and assets.

### Fixed during verification

- Block/cross-line decorations moved from `ViewPlugin` to `StateField` to satisfy Obsidian's patched CodeMirror.
- Multiple Org tags merging the next source line due to shared-colon range calculation.
- MathJax rendering requiring `loadMathJax`/`finishRenderMath` and a bounded retry.
- Code highlighting in live preview bridged from Prism tokens to CM6 classes.
- Reading-view heading tags inheriting h1/h2 sizes.
- Column-alignment rows incorrectly rendered as data rows.
- Missing padding in live table cells.
- Language flair overlapping wrapped code on narrow screens.
- Forced code no-wrap creating a global horizontal scrollbar in live preview.

### Known limitations

- No metadata-cache integration for outline/backlinks/graph/tag pane in non-Markdown files.
- No headline folding indicators yet.
- Tables are read-only in live preview; click a cell to edit the raw table.
- Footnote definitions are rendered inline.
- Not a full Org implementation (no Babel/`#+INCLUDE`/macros/agenda/export backends).
- Mobile layout verified via viewport emulation; actual iOS device testing is ongoing.
