# Visual verification — Org Live

Date: 2026-10-24
Obsidian: 1.14.5 (Electron 39.5.1)
Vault: `<test-vault>`
Enabled community plugins: **org-live only** (`orgmode-cm6` disabled; no UNITADE needed)

## Test material

- `test/org-live-demo.org` — headings (levels 1–5), TODO/DONE/WAITING/custom
  完成, priority, tags (Latin + Chinese), planning lines, emphasis, links,
  lists/tasks, tables, source/quote/example/center/verse, rule, comment,
  fixed-width, inline and display math, footnote.
- `test/markdown-reference.md` — equivalent Markdown for visual comparison.
- `test/writeup-redacted.org` — sanitized engineering writeup: metadata card,
  property drawer, aligned 5-column table, long URL, long code lines, quote,
  math, Chinese section, nested tasks, footnote. All names/hosts/tokens are
  placeholders.
- `test/math-formats.org` — bare `\begin{align}`, inline `\(...\)`, multi-line
  `\(...\)`, `\[...\]`, multi-line `$$...$$`, same-line `$...$`/`$$...$$`, and
  an `equation` environment.

The files are copied to the vault by `scripts/deploy.mjs`.

## Procedure

1. `ORG_TEST_VAULT="<test-vault>" npm run deploy` — builds, copies the plugin to
   `.obsidian/plugins/org-live`, writes `community-plugins.json` as
   `["org-live"]` (original list backed up as
   `community-plugins.json.org-live-backup`), and copies the demo.
2. Start Obsidian with `--remote-debugging-port=9222`.
3. Drive the real Obsidian renderer with `scripts/cdp.mjs`:
   - open the file,
   - set live/reading mode,
   - move the cursor,
   - scroll,
   - capture screenshots with `Page.captureScreenshot`,
   - target the separate Settings window with `--target Settings`,
   - emulate a 390×844 mobile viewport with `--mobile` and `body.is-mobile`.
4. Compare against the Markdown reference and against Obsidian's own computed
   DOM/CSS values.

## Screenshots

| File | What it shows |
| --- | --- |
| `shots/final-clean-live.png` | Clean-load live preview: inline title, metadata card, title levels, TODO, tags, properties card, planning line, emphasis, links, timestamp, math, CJK |
| `shots/final-live-top.png` | Live preview top (earlier build; same layout) |
| `shots/final-live-code.png` | Live preview: lists, table widget, Prism-highlighted source block, quote, example, center, rule, comment, fixed-width |
| `shots/final-live-bottom.png` | Live preview: display math, WAITING headline, planning, footnote |
| `shots/final-live-cjk.png` | Custom Chinese TODO keyword 完成 and Chinese tags 中文/测试 |
| `shots/final-reading-top.png` | Reading view top: inline title, metadata card, heading, properties card, tags |
| `shots/final-reading-mid.png` | Reading view: lists, tasks, table, priority, footnote |
| `shots/final-reading-bottom.png` | Reading view: Prism code, quote, example, center, rule, fixed-width, display math |
| `shots/final-markdown-reading.png` | Native Markdown reading view used for visual comparison |
| `shots/settings-en.png` | English settings page |
| `shots/settings-zh.png` | Chinese settings page |
| `shots/mobile-live-top.png` | 390×844 mobile live preview (sidebar hidden) |
| `shots/mobile-writeup-code.png` | Mobile long-code wrapping and language flair spacing |
| `shots/mobile-writeup-table.png` | Mobile 5-column table with horizontal scrolling |
| `shots/mobile-writeup-reading.png` | Mobile reading view: table scroll + wrapped code |
| `shots/writeup-live-top.png` | Sanitized writeup live preview |
| `shots/writeup-live-code.png` | Sanitized writeup code/table section |
| `shots/writeup-table.png` | Alignment row applied, no stray row |
| `shots/writeup-reading-top.png` | Sanitized writeup reading view |
| `shots/writeup-reading-bottom.png` | Chinese tasks/footnote section |
| `shots/math-live-top.png` | Bare `align` environment in live preview |
| `shots/math-live-inline.png` | Inline `\(...\)` and multi-line math section |
| `shots/math-reading-top.png` | Reading view: `align` + inline LaTeX delimiters |
| `shots/fold-src.png` | Folded source block with inline chevron, plus quote/example/center fold indicators |
| `shots/outline-org.png` | Org headlines in Obsidian's core Outline pane, including Chinese titles |
| `shots/regression-020-reading.png` | 0.2.0 reading-view regression (math, table, tags, tasks, code) |

## Measurements against native Markdown

From the live Markdown view:

- `h1` = 25.888 px, `h2` = 23.392 px, `h3` = 21.088 px.
- Live Markdown tag = 14 px, padding 3.5 px / 9.1 px.
- These are theme values; Org gets them automatically because it emits
  `HyperMD-header-N` and the native `cm-hashtag` structure.

Observed Org results:

- Headings use the same computed sizes.
- Heading tags are 14 px after the reading-view cap; live heading tags were
  already 14 px.
- Code blocks use the same Prism token colors as the Markdown reference.
- Lists/task spacing comes from `HyperMD-list-line-N` and `.task-list-item-checkbox`.

## Interaction checks

Performed through CDP against the real app:

| Check | Result |
| --- | --- |
| Open `.org` | `viewType: org-live-view`, no error notices |
| Toggle reading view | `org-live: Toggle reading view`, icon changes book/pencil |
| Checkbox in live preview | `[X]` → `[ ]`; file saved after debounce |
| Checkbox in reading view | `[ ]` → `[X]`; preview re-rendered |
| Internal link | opened `test.org.md` in a Markdown view |
| Tag click | global search opened with `:demo:` / `:中文:` |
| Table cell click | table widget removed, cursor at the raw cell line |
| TODO cycle | `NEXT` → `DONE`; file saved |
| `renderTables` setting off/on | 0 widgets/4 raw lines ↔ 1 widget/0 raw lines |
| Language switch (English → 中文) | settings labels, command names and the reading-view action label all changed immediately |
| Settings window | separate Electron window captured with `--target Settings` |
| Mobile live preview | 390 px content width, metadata/heading/body reflow, 20 px checkbox targets |
| Mobile code block | long code wraps without a global horizontal scrollbar; flair no longer overlaps |
| Mobile tables | 5-column table: container 306 px client / 367 px scroll width in live, 306/359 in reading; horizontal scroll works |
| Math formats | `test/math-formats.org`: 9 MathJax containers in live and reading; 5 block-math widgets; `\begin{align}`, `\(...\)`, multi-line `\(...\)`, `\[...\]`, multiline `$$`, `equation` all render |
| Math editing | cursor inside the align block → math widget removed, 6 raw source lines visible; cursor away → widget restored |
| Code folding (src) | 64 → 59 visible lines, `▸` indicator, document text length unchanged; click again restores 64 |
| Code folding (quote) | 64 → 62 visible lines, chevron stays visible at the first content line, restores on unfold |
| Core Outline | 6 Org headlines with hierarchy/TODO/Chinese; clicking `WAITING` moved to line 65 and scrolled; heading edits updated the outline live |
| Markdown Outline regression | `markdown-reference.md` still shows Heading one/two/three through the original method |
| Console | no exceptions on load or interactions |

## Bilingual settings verification

Obsidian 1.14.4 exposes `getLanguage()`; `auto` follows it. The settings page
was opened through `app.setting.openTabById("org-live")` and the language
dropdown was driven through the DOM.

- English labels: Interface language, Live preview, Render tables, Render math,
  Show property drawers.
- Chinese labels: 界面语言、实时预览、渲染表格、渲染数学、显示属性抽屉.
- Command registry names updated in place from `Toggle reading view` to
  `切换阅读视图`, etc.
- The view action aria-label changed from `Reading view` to `阅读视图` and back.
- Setting restored to `auto` after the test.

## Mobile / iOS verification

Tested with CDP `Emulation.setDeviceMetricsOverride` at 390×844 and
`deviceScaleFactor: 2`, plus `body.is-mobile` to activate the mobile CSS. The
desktop sidebars were hidden for the screenshots; on a real phone Obsidian
uses its drawer layout, so the content width will be the full viewport.

- 390 px content width; metadata card, headings, tags and planning lines reflow.
- Checkboxes render at the 20 px touch size.
- Long code wraps (Obsidian Markdown live preview also uses `break-spaces`);
  no global horizontal scrollbar.
- Code-block language flair has a reserved header line, so it does not overlap
  wrapped code.
- Tables get 4 px / 8 px cell padding and horizontal scrolling when wider than
  the viewport (live: 306/367 px; reading: 306/359 px).
- Reading view `<pre>` uses `pre-wrap` and no overflow.
- iOS uses the native selection (no `drawSelection`); desktop keeps CM6's
  drawn cursor.

Actual iPhone testing is still pending; this environment only emulates the
viewport and mobile CSS, not WKWebView keyboard behaviour.

## Bugs found and fixed during verification

1. **Multiple Org tags merged the next source line.** Tags share colons
   (`:deep:demo:`), and the span calculation counted the shared colon twice,
   making the last tag end one character into the newline. A cross-line
   replace decoration then removed the newline. Fixed by computing shared-colon
   spans and replacing the tag run with one widget.
2. **`Block decorations may not be specified via plugins`.** Whole-table,
   drawer and inline-title widgets were initially in a `ViewPlugin`.
   Obsidian's patched CM6 forbids block/cross-line decorations there. Moved the
   whole decoration set to a `StateField` provided via
   `EditorView.decorations`.
3. **Math showed raw text.** `renderMath` requires MathJax to be loaded and
   `finishRenderMath` to be flushed. The plugin now loads MathJax, refreshes
   views when ready, and calls `finishRenderMath`.
4. **Code blocks were unhighlighted in live preview.** Added a Prism →
   `cm-*` token bridge; reading view still uses Prism HTML directly.
5. **Heading tags inherited h1/h2 font sizes in reading view.** Capped them to
   the native 14 px tag size.
6. **Org alignment rows rendered as data.** `<l>|<c>|<r>` rows were added as a
   visible empty row. The parser now treats an all-alignment row as column
   metadata and applies it to every cell.
7. **Live table cells had zero padding.** The simplified widget lacked
   Obsidian's `.table-cell-wrapper`; explicit 4 px / 8 px cell padding and
   collapsed borders now match native reading tables.
8. **Code language flair overlapped wrapped code on mobile.** The absolutely
   positioned flair is 27 px tall while the begin line was 19 px. The begin
   line now reserves 2.4em.
9. **Forced code no-wrap caused a global horizontal scrollbar.** Obsidian's
   Markdown live preview wraps code (`white-space: break-spaces`), so the
   override was removed and the editor keeps a vertical scrollbar only.
10. **LaTeX/Markdown math delimiters were not recognized.** Only Org `$...$`
    and same-line `$$...$$` worked. Added inline `\(...\)`/`\[...\]` and
    multi-line/block math (`$$`, `\[...\]`, multi-line `\(...\)`, bare
    `\begin{align}`/`equation`/`gather`/`multline`/`alignat`/`eqnarray`).

## Notes / limitations confirmed visually

- Obsidian's tag pane, backlinks, graph and outline do not index non-Markdown
  files; tag clicks therefore use a text search for `:tag:`.
- Fold indicators are not shown yet.
- The reading view intentionally uses standard Markdown HTML so theme CSS
  applies; Org-only features (TODO, tags, drawers, planning) are layered on
  top.
- Footnote definitions are currently rendered inline; no footnote section.
- Actual iOS device testing remains outstanding (user will test via BRAT).
- The settings language switch updates command names through Obsidian's
  command registry; on a future Obsidian version that removes this internal
  map, names would keep the startup language until reload.
- The core Outline bridge depends on the outline view's private
  `getHeadings`/`update` methods. It is guarded and delegates Markdown to the
  original methods, but a future Obsidian version could require a bridge update.
- Code block folding is inline and view-only; fold state is not persisted
  across reloads. Headline folding is not implemented.
