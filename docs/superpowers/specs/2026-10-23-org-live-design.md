# Org Live — Design

Date: 2026-10-23
Status: implemented (v0.1.0)

## Intent

Make `.org` files feel like Markdown notes inside Obsidian: open them directly,
edit them in a live preview that renders Org syntax, switch to a reading view,
and inherit the active theme rather than shipping a second design system.

The motivating problem is not "parse every Org construct". It is the *feel*:
heading hierarchy, inline markup, lists, code, tables, links, tags and math
should look and behave the way Obsidian's Markdown does, including Chinese
mixed-script typography.

## Goals

- Register `.org` as a first-class Obsidian file type; no second plugin
  (UNITADE, Orgmode cm6, etc.) is required or enabled.
- Live preview with cursor-sensitive revealing of raw Org syntax.
- Reading view with real HTML.
- Visual parity by reusing Obsidian's Markdown/CM6 classes and CSS variables.
- Editing must be real editing: save, undo, links, checkboxes, TODO cycling.
- Bilingual English/Chinese settings UI suitable for the international
  community, with command/action labels following the setting.
- Work on Obsidian mobile (iOS) as well as desktop: native selection, safe
  areas, touch targets and responsive tables.
- Be installable as a GitHub beta via BRAT.
- Work in the test vault with only this plugin enabled, verified visually.

## Non-goals

- A complete Org implementation (Babel, agenda, export backends, `#+INCLUDE`,
  macros, org-protocol).
- Replacing Emacs.
- Indexing Org files in Obsidian's metadata cache, outline, graph, tag pane or
  backlink pane. Obsidian has no public write API for non-Markdown metadata.
- A custom syntax highlighter/theme. Prism and the active theme do that.

## Anti-goals

- A separate visual language that ignores the user's theme.
- Rewriting Markdown CSS to approximate Obsidian; instead, reuse the classes.
- Silent data loss (the plugin uses `TextFileView` and CM6 history/save).
- Loading conflicting `.org` plugins in the verification vault.

## Constraints and research

Obsidian's CodeMirror is a patched build:

- A `ViewPlugin` may only provide inline decorations. Block widgets and
  decorations that replace line breaks throw
  `RangeError: Block decorations may not be specified via plugins`.
- The supported place for those is `StateField` + `EditorView.decorations`.
- Obsidian's Markdown live preview already defines the visual vocabulary:
  `HyperMD-header-N`, `cm-header-N`, `cm-strong`, `cm-em`, `cm-inline-code`,
  `HyperMD-list-line-N`, `cm-list-N`, `HyperMD-codeblock`, `cm-hashtag`,
  `task-list-item-checkbox`, `code-block-flair`, `math`, etc.
- Reading view styling is scoped to `.markdown-preview-view.markdown-rendered`
  and `inline-title`.
- AsciiDoc and Typst plugins use the same broad architecture: a
  `TextFileView` subclass with an embedded CM6 `EditorView`, plus a rendered
  preview; they also document the patched-CodeMirror limitations.
- `getLanguage()` (Obsidian 1.8.7+) gives the configured app language; it is
  used for `auto`. This sets the plugin's minimum app version.
- On mobile, Obsidian is a Capacitor/WKWebView app. Native text selection is
  more reliable than CM6's drawn selection, so `drawSelection()` is skipped
  when `Platform.isMobileApp` is true.

References:

- <https://github.com/dzruyk/obsidian-asciidoc>
- <https://github.com/azyarashi/obsidian-typst-mate>
- <https://docs.obsidian.md/Plugins/Editor/Decorations>
- <https://discuss.codemirror.net/t/block-decoration-error-uncaught-rangeerror-block-decorations-may-not-be-specified-via-plugins/4102>

## Architecture

```
Plugin (main.ts)
  registers .org -> OrgView
  registers commands + settings
  loads MathJax and Prism lazily, then refreshes views

OrgView (TextFileView)
  contentEl has Obsidian markdown-source-view classes
  ├─ editor host: CodeMirror 6 EditorView
  │    ├─ history / drawSelection / lineWrapping / keymaps
  │    ├─ orgLivePreview StateField (block + line + inline decorations)
  │    └─ update listener -> requestSave / preview refresh
  └─ preview host: reading view root (.markdown-preview-view.markdown-rendered)

org/parse.ts       structural parser (headlines, lists, tables, blocks, drawers)
org/inline.ts      inline scanner (emphasis, links, timestamps, math, tags, URLs)
org/inlineRender.ts HTML inline rendering + MathJax hydration
org/highlight.ts   Prism -> CM6 token classes for live code blocks
preview/render.ts   full HTML reading view + Prism hydration
editor/livePreview.ts  decorations and widgets
editor/orgEditor.ts    editor state, keymaps, list continuation
util/links.ts      link/tag opening and resource resolution
```

### File type ownership

`Plugin.registerView()` + `Plugin.registerExtensions(["org"], VIEW_TYPE_ORG)`.
The plugin therefore owns `.org`. If another plugin owns it, registration
fails gracefully with a Notice. This is why the verification vault enables
only `org-live`; the previously installed `orgmode-cm6` is disabled.

### Why a StateField and not a ViewPlugin

The decoration set includes:

- a block inline-title widget,
- a whole-block metadata/properties card for top `#+KEYWORD` lines,
- whole-table widgets,
- whole-drawer property cards,
- hidden block-marker lines.

These affect vertical layout and sometimes cross line breaks. Obsidian's
patched CM6 forbids them from `ViewPlugin`. The implementation therefore uses
one `StateField<DecorationSet>` provided via `EditorView.decorations`.
Structural documents are cached per `Text` instance, and inline parsing has a
small bounded cache, so selection-only transactions reuse parsed data.

### Native-class strategy

Rather than define `.org-h1` etc., the decorations add the classes Obsidian
already styles:

| Org construct | Emitted classes / DOM |
| --- | --- |
| Headline level N | line `HyperMD-header HyperMD-header-N`; title `cm-header cm-header-N`; markers `cm-formatting cm-formatting-header…` when active |
| Bold / italic / underline / strike | `cm-strong`, `cm-em`, `cm-underline`, `cm-strikethrough` |
| Verbatim / code | `cm-inline-code` |
| List | `HyperMD-list-line-N`; bullet span `cm-formatting-list-ul` + `list-bullet`; content `cm-list-N` |
| Task | line `HyperMD-task-line`; `label.task-list-label` + `input.task-list-item-checkbox` |
| Quote | `HyperMD-quote` / `cm-quote` |
| Code block | `HyperMD-codeblock[-begin|-end][-bg]`; `code-block-flair`; Prism token → `cm-*` |
| Table | `cm-embed-block cm-table-widget markdown-rendered` |
| Tag | `cm-hashtag cm-hashtag-begin/end cm-meta cm-tag-tag` |
| Link | `cm-hmd-internal-link` / `cm-link` + nested `cm-underline` |
| Math | `math` + Obsidian `renderMath` |
| Rule | line `hr` + `<hr>` |
| Inline title | block widget `div.inline-title` |
| Reading view | `.markdown-preview-view.markdown-rendered` + `inline-title` |

Org-only concepts (TODO, priority, planning, drawers/metadata cards,
timestamps, fixed-width, comments) keep small custom styles built on theme
variables.

### Cursor-sensitive live preview

- A heading hides its stars when the cursor is not on the heading line.
- Inline markup reveals itself only when the selection touches the token.
- Tables become raw styled rows when the cursor enters the table.
- Source-block begin/end markers hide unless the cursor is on that marker;
  the language stays visible as a `code-block-flair`.
- Block-quote/example/center/verse/comment markers are zero-height when
  inactive.
- Property drawers and top `#+KEYWORD` metadata become cards when inactive,
  and reveal raw lines when clicked/cursored.

### Reading view

`preview/render.ts` builds HTML with escaped text and standard Markdown
structures (`h1..h6`, `p`, `ul/ol`, `table`, `pre`, `blockquote`, `hr`), then:

- places it under `.markdown-preview-view.markdown-rendered` so the theme's
  reading-view CSS applies;
- renders `#+TITLE` / filename as `.inline-title`;
- renders top keywords as a properties card (excluding `TITLE`);
- renders property drawers as compact cards;
- hydrates math with `renderMath` + `finishRenderMath`;
- highlights code with Obsidian's Prism via `loadPrism()`;
- wires links and task checkboxes.

## Parser scope

Structural lines: headings, planning, lists (including checkboxes and ordered
items), tables and rules, drawers, `#+BEGIN_/END_` blocks (src/quote/example/
center/verse/comment/export), `#+KEYWORD` lines, comments, fixed-width text,
horizontal rules.

Tables support Org `<l>/<c>/<r>` alignment rows: a row whose cells contain only
alignment markers is treated as column metadata, removed from the data rows and
applied to every cell. Rules still split header and body rows.

Inline: emphasis, verbatim/code, links (`[[target][desc]]` and `[[target]]`),
bare URLs, timestamps, footnote references, cookies, math (`$…$`, `$$…$$`,
`\(…\)`, `\[…\]`) and tags. CJK characters count as emphasis boundaries, and
tags accept Unicode letters/numbers. TODO keywords come from the default set
plus `#+TODO:`/`#+SEQ_TODO:`/`#+TYP_TODO:` declarations, so Chinese keywords
work.

Display math also accepts multi-line blocks: `$$…$$`, `\[…\]`, multi-line
`\(…\)`, and bare LaTeX display environments (`align`, `align*`, `equation`,
`gather`, `multline`, `flalign`, `alignat`, `eqnarray`, `displaymath`). These
become `math-block` lines with a `MathBlockData` range/latex payload, render as
one block, and reveal raw lines when the cursor is inside.

Known parser simplifications: line-oriented, no nested blocks, no multiline
inline math, table cells split on unescaped `|`, tags are recognised at the
end of headlines.

## Interactions

- Checkbox widgets toggle `[ ]`/`[X]` and trigger saving (2 s debounce via
  `TextFileView.requestSave`).
- Reading-view checkboxes dispatch the same edit, then re-render.
- Internal links call `workspace.openLinkText`; external links use
  `window.open`.
- Tag clicks open Obsidian's global search with `:tag:` because Obsidian's
  tag index only covers Markdown metadata.
- `Cycle TODO state` (TODO/NEXT/WAITING/STARTED → DONE → none → TODO).
- Enter continues lists with the correct indentation, marker and checkbox;
  Tab/Shift-Tab indent/outdent list items.
- Reading/live switching preserves the live editor scroll ratio in the
  reading view.

## Bilingual UI

`src/i18n.ts` holds typed English and Chinese dictionaries. The setting is
`language: "auto" | "en" | "zh"`; `auto` uses Obsidian's `getLanguage()`
(falling back to English). The language dropdown is the first item in the
settings tab.

- The settings tab re-renders immediately via `display()`.
- `OrgLivePlugin.t()` is used by the settings tab, commands and the view action.
- Command names are registered in the startup language and updated in place
  through Obsidian's command registry after a language change. There is no
  public rename API; if the registry shape changes, names keep the startup
  language until reload.
- The view action label is refreshed without rebuilding the editor.

## Mobile / iOS

- `manifest.isDesktopOnly = false`; mobile app APIs are used only through
  Obsidian's public API (`Platform`, `TextFileView`, `loadPrism`,
  `loadMathJax`).
- `drawSelection()` is omitted on `Platform.isMobileApp` so iOS/Android use
  native selection handles and keyboard behaviour.
- CSS adds `body.is-mobile` rules for safe-area/toolbar bottom padding,
  20 px checkbox targets, 24 px tag targets and touch scrolling.
- Tables are wrapped in `.org-table-container` / `.org-table-widget` with
  horizontal scrolling and 4 px/8 px cells.
- Code wraps rather than forcing horizontal scrolling, matching Obsidian's
  Markdown live preview (`white-space: break-spaces`).
- The code-block language flair has a reserved 2.4em header line so absolute
  positioning cannot overlap wrapped code.
- Actual iPhone keyboard/selection testing remains a device-level check; this
  repository verifies a 390×844 viewport and mobile CSS.

## Settings

- `language` — Auto / English / 中文.
- `livePreview` — disable decorations and edit raw text.
- `renderTables` — table widgets vs. raw styled rows.
- `renderMath` — MathJax vs. source.
- `showProperties` — drawer and top-keyword cards vs. raw lines.

## Verification

Environment: Obsidian 1.14.4 (Electron 39), vault
`<test-vault>`, only the `org-live` community plugin enabled.
Evidence lives in `shots/` and the procedure is in
`docs/visual-verification.md`.

Checks performed:

- `.org` opens directly in the custom view (`viewType: org-live-view`).
- Heading sizes match Markdown h1–h6 because native `HyperMD-header-N` classes
  are used (h1 = 25.888 px, h2 = 23.392 px, h3 = 21.088 px in the test theme).
- Markdown tags are 14 px; Org heading tags are capped to the same fixed size.
- Inline math and display math render with MathJax, including `\(...\)`,
  `\[...\]`, multi-line `$$...$$` and bare `\begin{align}`/`equation`/`gather`
  environments. Cursor-inside reveals the raw math block for editing.
- Code blocks use the same Prism tokens/colors as Markdown reading view.
- Table, list, task and quote visuals match the Markdown reference.
- Checkbox toggling in live and reading modes edits and saves the file.
- Internal link opens `test.org.md`; tag click opens search with `:demo:`.
- TODO cycling changes NEXT→DONE and saves.
- Settings toggles rebuild the view as expected.
- Language switch updates the settings page, command names and view action.
- Mobile 390×844 emulation: metadata/heading reflow, 20 px checkboxes, code
  wrapping, code flair spacing, table horizontal scroll (306/367 px live,
  306/359 px reading).
- Sanitized writeup (`test/writeup-redacted.org`) rendered and inspected; it
  surfaced the alignment-row, table-padding, flair-overlap and code-wrap bugs.
- No console errors on load or during interactions.

## Future work

- Fold indicators and Org headline folding.
- Viewport-scoped inline decorations (ViewPlugin) alongside the StateField
  block layer for very large files.
- Editing table cells in place.
- Optional metadata-cache bridge if Obsidian exposes an API for non-Markdown
  links/tags/headings.
- More complete Org: `#+INCLUDE`, macros, footnote sections, tags/links in
  tables, org-protocol.
- Inline syntax highlighting in source blocks for languages Prism doesn't
  know.
- Real iPhone/iPad testing via BRAT; WKWebView keyboard and selection details.
- A public command-rename API fallback if Obsidian changes the command
  registry.
