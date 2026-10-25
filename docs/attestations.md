# Build provenance attestations

Status: **prepared, blocked by GitHub token scope**.

The current GitHub token has these scopes:

```
admin:public_key, gist, read:org, repo
```

It does **not** include `workflow`, so GitHub refuses writes to
`.github/workflows/`. A temporary Contents API test returned `Not Found` for a
workflow file, confirming the block. No attestation workflow exists in the
repository yet.

## Enable and run

1. Authorize the workflow scope (interactive):
   ```bash
   gh auth refresh -s workflow
   ```
   Or add the workflow through the GitHub web UI.
2. Copy `docs/attestation-workflow.yml` to `.github/workflows/release.yml`.
3. Commit and push the workflow file.
4. Either:
   - push a new version tag (recommended for the next release), or
   - run the **Release and attest** workflow manually with `tag: 0.2.3` to
     rebuild the existing assets on GitHub Actions and attach attestations.
5. Verify:
   ```bash
   gh attestation verify main.js --repo zzeitt/obsidian-org-live
   ```
6. Re-run the community scan.

The workflow builds with `npm ci && npm run build`, attests `main.js`,
`manifest.json` and `styles.css`, then uploads them to the release. It uses the
same source and pinned esbuild version as the local build.

The attestation recommendation is not a blocker for the current directory
listing; the plugin page is already live. It is a provenance improvement for
future releases.
