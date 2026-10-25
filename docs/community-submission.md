# Community marketplace submission

Status: **prepared, portal submission pending an Obsidian account login**.

The old `obsidianmd/obsidian-releases` pull-request flow is deprecated. Obsidian
now uses the **community.obsidian.md** portal, which requires signing in with an
Obsidian account and connecting a GitHub account. That interactive account step
cannot be completed from this CLI environment, so no marketplace listing exists
yet. BRAT remains the install path until the portal review is complete.

## Verified prerequisites

- Public source repo: <https://github.com/zzeitt/obsidian-org-live>
- `README.md`, `LICENSE`, and `manifest.json` at the repo root.
- Manifest at `main` HEAD:
  - `id`: `org-live` (unique, does not contain “obsidian”)
  - `version`: `0.2.2`
  - `minAppVersion`: `1.8.7`
  - `isDesktopOnly`: false
- Git tag `0.2.2` matches the manifest version.
- GitHub release `0.2.2` contains binary assets:
  - `main.js`
  - `manifest.json`
  - `styles.css`
  - `versions.json`
- Build script (`npm run build`) produces `main.js` from source.
- No telemetry, analytics, remote code execution, `eval`, or `new Function`.
- Mobile support is declared (`isDesktopOnly: false`).

## Submit through the portal

1. Sign in at <https://community.obsidian.md> with an Obsidian account.
2. Connect the GitHub account `zzeitt` (read-only verification of repo ownership).
3. Open **Plugins → New plugin** and submit:
   ```
   https://github.com/zzeitt/obsidian-org-live
   ```
4. Wait for the automated review. It checks manifest, releases, source/build,
   and policies. Fix errors by publishing a new incremental release; the
   directory reads `manifest.json` from the default branch HEAD.
5. After approval the plugin becomes searchable/installable from Obsidian's
   Community plugins browser. Future releases propagate automatically.

Official docs:

- <https://docs.obsidian.md/plugins/releasing/submit-plugin>
- <https://docs.obsidian.md/community-directory/set-up-and-claim>
- <https://docs.obsidian.md/community-directory/faq>

## Notes for review

The core Outline integration wraps the outline view instance's private
`getHeadings`/`update` methods because Obsidian exposes no public API for
headings in non-Markdown files. The bridge only answers for `.org` files,
delegates every other file to the original methods, and restores them on
unload. If a future Obsidian release changes those methods, the bridge becomes
a no-op rather than affecting Markdown outlines.

Until the plugin is admitted, BRAT remains the immediate install path:

```
zzeitt/obsidian-org-live
```

or on mobile:

```
obsidian://brat?plugin=zzeitt/obsidian-org-live
```
