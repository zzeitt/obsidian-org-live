# Org Live

[English](README.md) | [中文](README.zh-CN.md) · [GitHub](https://github.com/zzeitt/obsidian-org-live) · [Latest release](https://github.com/zzeitt/obsidian-org-live/releases)

Org Live opens, edits and reads `.org` files natively in Obsidian, with the same live-preview feel as Obsidian's Markdown editor. It does not ship a separate design system: it reuses Obsidian's own Markdown/CM6 classes, so the active theme styles headings, code, tags, tables and links the same way.

![Live preview](shots/final-clean-live.png)

## Features

- **Native `.org` file type** — the plugin registers the extension itself. No UNITADE or other extension-owner plugin is required.
- **Live preview** — raw Org markup is revealed only around the cursor; everything else renders like Markdown.
- **Reading view** — toggle with the book/pencil action in the view header.
- **Org structure** — headlines, TODO/custom TODO keywords, priorities, tags, planning lines, property drawers, `#+KEYWORD` metadata, tables, source/quote/example/center/verse blocks, comments, fixed-width text and rules.
- **Inline syntax** — bold, italic, underline, verbatim, code, strike, links, bare URLs, timestamps, footnote references, cookies and math.
- **Interactions** — clickable checkboxes that save, internal links, tag search, table-cell click-to-edit, TODO cycling, list continuation and indentation.
- **Bilingual settings** — Automatic / English / 中文. Command names and view-action labels update immediately.
- **Mobile ready** — `isDesktopOnly: false`, native selection on iOS, safe-area/toolbar padding, touch-sized checkboxes, horizontally scrollable tables and Markdown-style code wrapping.
- **Chinese friendly** — Unicode tags (`:中文:测试:`), custom Chinese TODO keywords (`#+TODO: 待办 | 完成`), CJK emphasis boundaries.

## Native Markdown visual parity

| Org | Reused Obsidian / Markdown structure |
| --- | --- |
| Headline level N | `HyperMD-header-N`, `cm-header-N` |
| Bold / italic / strike / inline code | `cm-strong`, `cm-em`, `cm-strikethrough`, `cm-inline-code` |
| Links | `cm-hmd-internal-link`, `cm-link` + `cm-underline` |
| Lists / checkboxes | `HyperMD-list-line-N`, `cm-list-N`, `list-bullet`, `task-list-item-checkbox` |
| Quote | `HyperMD-quote`, `cm-quote` |
| Source block | `HyperMD-codeblock`, `code-block-flair`, Prism token classes |
| Table | `cm-embed-block cm-table-widget markdown-rendered` |
| Tags | `cm-hashtag` / `<a class="tag">#tag</a>` in reading view |
| Math | Obsidian `renderMath` + MathJax |
| Reading view | `.markdown-preview-view.markdown-rendered`, `inline-title` |

Org-only concepts (TODO, priority, planning, drawers/metadata cards, timestamps, fixed-width, comments) use small styles built on theme variables.

## Install

### BRAT (recommended for beta and mobile)

1. Install **BRAT** from Obsidian's community plugins.
2. In BRAT choose **Add Beta Plugin** and enter:
   ```
   zzeitt/obsidian-org-live
   ```
   On mobile you can also open this URI: `obsidian://brat?plugin=zzeitt/obsidian-org-live`
3. Enable **Org Live** in Settings → Community plugins.
4. Disable any other plugin that owns `.org` files (for example **Orgmode cm6**). Only one plugin can own an extension; Org Live registers `.org` itself, so UNITADE is not needed.

Requires Obsidian **1.8.7+** (uses the public `getLanguage()` API). iOS/Android are supported.

### Manual install

Copy `main.js`, `manifest.json` and `styles.css` into:

```
<vault>/.obsidian/plugins/org-live/
```

Then enable **Org Live** and disable conflicting `.org` plugins.

## Mobile / iOS

The view is a `TextFileView` with an embedded CodeMirror 6 editor, which works on Obsidian mobile:

- iOS/Android use the native text selection and selection handles; desktop keeps CM6's drawn cursor.
- Content respects `safe-area-inset-bottom` and the mobile toolbar height.
- Checkboxes and tag targets are enlarged; tables scroll horizontally; long code wraps the way Obsidian's Markdown live preview does.
- The header book/pencil action and all commands are available on mobile.

Verified with a 390×844 viewport emulation and mobile CSS. An actual iOS device check is still recommended; the screenshots are in `shots/mobile-*.png`.

![Mobile live preview](shots/mobile-live-top.png)

## Bilingual settings

Settings → Org Live → **Interface language**:

- **Automatic (follow Obsidian)**
- **English**
- **中文**

The whole settings page, the reading-view action label and the three commands are localized. Changing the language updates the current session immediately.

| English | 中文 |
| --- | --- |
| ![English settings](shots/settings-en.png) | ![中文设置](shots/settings-zh.png) |

## Usage

- Click any `.org` file in the file explorer.
- Use the **book** icon to enter reading view and the **pencil** icon to return to live preview.
- Commands:
  - `Org Live: Toggle reading view`
  - `Org Live: Cycle TODO state`
  - `Org Live: Enter live preview`
- Settings:
  - Interface language
  - Live preview
  - Render tables
  - Render math
  - Show property drawers / leading `#+KEYWORD` metadata

You can bind `Toggle reading view` to the same shortcut you use for Markdown reading view (often `Ctrl/Cmd+E`).

## Sanitized writeup

`test/writeup-redacted.org` is a realistic engineering-review writeup with **all hosts, tokens, people and customer names replaced by placeholders** (`example.com`, `<REDACTED_TOKEN>`, `<Team>`, `<Redacted>`). It covers headings, TODO states, priorities, tags, property drawers, metadata, tables with column alignment, long URLs, long code lines, quotes, math, Chinese text, nested task lists and footnotes.

![Writeup live preview](shots/writeup-live-top.png)

Rendering this writeup surfaced and fixed:

- Org `<l>|<c>|<r>` column-alignment rows being treated as data rows.
- Missing table cell padding in the live table widget.
- Code-block language flair overlapping wrapped code on narrow screens.
- Forced no-wrap code creating a global horizontal scrollbar (Obsidian Markdown wraps code in live preview).

## Known limitations

- Obsidian's metadata cache is not writable for non-Markdown files, so the **outline, backlinks, graph and tag pane do not index Org headings/links/tags**. Clicking a tag performs a text search for `:tag:`.
- Headline folding indicators are not implemented yet.
- Tables are rendered read-only in live preview; click a cell to edit the raw table.
- Footnote definitions are shown inline rather than collected into a footnote section.
- Not a complete Org implementation: no Babel, `#+INCLUDE`, macros, agenda, or export backends.
- Mobile layout was verified through viewport emulation; please report iOS-specific keyboard/selection issues.

## Development

```bash
npm install
npm run check     # TypeScript
npm run build     # main.js
ORG_TEST_VAULT="/path/to/TestVault" npm run deploy
```

`npm run deploy` builds, copies the plugin into the test vault, enables only `org-live`, and copies the test corpora. It intentionally does not hard-code a vault path.

Visual verification uses Obsidian's Electron remote debugging:

```bash
# Start Obsidian with --remote-debugging-port=9222
node scripts/cdp.mjs --open org-live-demo.org --mode live --shot shots/out.png
node scripts/cdp.mjs --mode preview --shot shots/reading.png
node scripts/cdp.mjs --target Settings --shot shots/settings.png
node scripts/cdp.mjs --mobile --shot shots/mobile.png
node scripts/cdp.mjs --info
```

Test material:

- `test/org-live-demo.org` — broad syntax corpus.
- `test/markdown-reference.md` — Markdown comparison note.
- `test/writeup-redacted.org` — sanitized writeup / regression corpus.
- `docs/visual-verification.md` — verification log and screenshots.
- `docs/superpowers/specs/2026-10-23-org-live-design.md` — architecture and design decisions.

## References

Implementation ideas were informed by existing Obsidian markup-language plugins:

- [dzruyk/obsidian-asciidoc](https://github.com/dzruyk/obsidian-asciidoc) — `TextFileView` + embedded CM6 and patched-CodeMirror notes.
- [azyarashi/obsidian-typst-mate](https://github.com/azyarashi/obsidian-typst-mate) — custom text view, CM6 editor, reading/source switching.
- [Obsidian Decorations documentation](https://docs.obsidian.md/Plugins/Editor/Decorations) — ViewPlugin vs StateField.
- [CodeMirror block-decoration discussion](https://discuss.codemirror.net/t/block-decoration-error-uncaught-rangeerror-block-decorations-may-not-be-specified-via-plugins/4102).

## License

MIT
