# Notes for coding agents working on Rigo

Rigo (formerly TypeCraft) is a single Go binary that embeds `web/` and serves the editor on a
loopback HTTP port. This file records the verification commands, the packaging
requirements and the repeatable release procedure, including the lessons that
cost a red CI run to learn.

## Verify before claiming anything works

```sh
gofmt -l .            # must print nothing
go vet ./...
go test ./...         # backend + HTTP boundary + protocol tests

cd tests/frontend
npm ci               # once; node_modules/ is gitignored
npm test             # 150 jsdom tests driving the real web/static/js/app.js
```

The frontend suite is the authority on the document-session protocol: it loads
the real `index.html` and the real scripts, and stubs only `fetch`, timers and
`EventSource`. If a change touches save/rename/watchdog/readonly flows, add a
regression test there.

Packaging smoke tests (run against freshly built artifacts):

```sh
sh tests/packaging-smoke.sh                     # needs: make, go
sh tests/desktop-packaging-smoke.sh 1.0.5 dist  # needs: 7z, file, python3
```

## Building the distributable artifacts

`make cross-compile`, `make linux-packages` (deb + rpm + AppImage),
`make windows-installer` (NSIS), `make macos-packages` (icns + zip).
Tool requirements: `dpkg-deb`, `rpmbuild`, `makensis`, `icotool`, `png2icns`,
`appimagetool` (not packaged in Debian: download the official AppImage and run
it with `APPIMAGE_EXTRACT_AND_RUN=1`), `python3` for `packaging/macos-zip.py`.

On a host without these tools and without root, a Debian 12 rootfs extracted
into a user namespace works well (`bwrap`, `--uid 0`, plus
`APT::Sandbox::User "root"` in apt.conf). Build binaries outside or inside —
the Makefile is self-contained either way. `dist/` is gitignored: artifacts are
published on the `downloads` branch, never on `main`.

## Release procedure (repeatable, fully automated by CI)

1. Bump the version in **both** `Makefile` (`VERSION`) and `main.go` (`version`)
   — they must match.
2. Write `docs/releases/vX.Y.Z.md`. Its **first line is the release title**; the
   workflow reads this file from the tagged commit.
3. Update `README.md` and `README.it.md`: download links, install examples and
   a changelog section for the new version.
4. Run the full verification above, build all artifacts into `dist/` and
   generate `SHA256SUMS` over the six release files (same format as the existing
   ones: `sha256sum <6 files> > dist/SHA256SUMS`).
5. Commit to `main` and push.
6. Add `vX.Y.Z/` (six packages + `SHA256SUMS`) to the `downloads` branch (a
   `git worktree` keeps the main checkout clean) and update its `README.md`.
   Push `downloads`.
7. Create the **annotated** tag `vX.Y.Z` on the version-bump commit and push
   it. `release.yml` then downloads the artifacts from the `downloads` branch,
   verifies `SHA256SUMS` and publishes the GitHub release on its own.

Properties of the automation, learned the hard way:

- **The release workflow is immutable-by-design:** it exits 0 without changes if
  the release already exists. Fixing a published release means cutting a new
  version; never move a tag that already produced a release (moving it *before*
  the release exists, e.g. to include a workflow fix, is fine).
- **Never replace the `curl` artifact downloads with `gh api`.** `gh api` with
  the raw media type decodes the body through a charset transform and fails on
  binary files with `transform: short source buffer` (x/text `ErrShortSrc`).
  This killed the first execution of the workflow (v1.0.4, run #1) and was
  reproduced locally with the same repo and token. `curl` streams bytes
  verbatim; the `sha256sum --strict -c` right after is the integrity gate.
- **GitHub's upload/release endpoints occasionally return 500/502** ("Error
  creating policy") and can leave an asset stuck in `starter` state: delete it
  by id and re-upload. The rerun API can 500 as well. A valid fallback is
  completing the release through the REST API (`POST /releases`, then upload
  each asset with retries), replicating the workflow's title/notes exactly.
- The whole chain was exercised successfully for v1.0.5: tag push → green
  workflow → release with verified assets, no manual intervention.

## Licensing rules (do not regress these)

- The app is **MIT** (`LICENSE`). Every bundled component must be redistributable; keep
  `THIRD-PARTY.md` and `packaging/copyright` in sync whenever a dependency or font changes.
- **Only OFL (or equally permissive) fonts may be bundled.** Never add a typeface whose vendor
  forbids bundling in an editor — the v1.1.0 audit removed exactly such a set. New icons must be
  original: `tools/icon` generates the current one from geometry, no third-party artwork.
- Do not put other products' names in the UI, in theme/font identifiers or in package metadata;
  comparative mentions belong in historical review documents only.

## Where to be extra careful (architecture invariants)

- **HTTP boundary:** every request passes `localBoundaryMiddleware` (exact
  Host/Origin policy against the listener authority) before any handler. The
  UI token is delivered by the `/api/init` handshake — also in its 503 error
  body — and travels on fetches as the `X-Rigo-Token` header; the query
  form is only for `EventSource` and `<img>`. Do not reintroduce the token in
  the launched browser URL (it was readable via `/proc/<pid>/cmdline`).
- **Document-session protocol** (`web/static/js/app.js`): `docSession`,
  `writeChain`, `writeEpoch`, `captureContext`/`unchangedSince`. Any async
  response is applied only if the document on screen is still the one it was
  captured for. Read the block comments at the top of the state before changing
  save/rename/watchdog logic.
- **Disk revisions are content fingerprints** (`sha256:<hex>`), compared for
  equality only — never by order, never parsed as numbers. Legacy `mod_time`
  is metadata.
- **Write endpoints** use `decodeJSONBody` (32 MiB cap, 413) and saves go
  through `atomicWrite`. Read-only protection and rename/copy aliasing checks
  are policy, documented inline: preserve them.
- The preview HTML always goes through `web/static/js/sanitize.js` (allow-list,
  fail-closed). The `marked` bundle is v12: renderer methods take positional
  arguments; a newer marked would break `livepreview.js` — update the renderers
  if the bundle is ever upgraded.
- UI strings are Italian by design (the product ships an Italian UI); release
  notes and code comments are English. Keep both READMEs in sync.
