# TypeCraft frontend tests (incarichi 001 / 001b)

Node + [jsdom](https://github.com/jsdom/jsdom) suite for the real frontend
controller `web/static/js/app.js`. It loads the real `web/index.html` and every
real script of the page (same order as the `<script>` tags) and drives the
controller only through DOM events: there are no test hooks in production code.

The suite lives **outside** the `//go:embed web` tree on purpose: tests, npm
manifests and `node_modules` are development assets and must never be shipped in
the binary. Do not move it back under `web/`.

- `fetch` is replaced by a controllable double; every response can be deferred
  (`deferRoute`) so late answers can be resolved out of order.
- Window timers are fake (`@sinonjs/fake-timers`), so the 600 ms autosave
  debounce and the 5 s external-change watchdog are deterministic: no test
  sleeps and no test depends on wall-clock timing.
- `confirm`, `alert`, `EventSource` and `requestAnimationFrame` are minimal
  doubles; everything else is the production code.

## Run

```sh
cd tests/frontend
npm ci          # or: npm install (first run)
npm test        # node --test
```

Single command from the repository root:

```sh
(cd tests/frontend && npm ci && npm test)
```

Dependencies are dev-only (`jsdom`, `@sinonjs/fake-timers`) and are pinned by
`package-lock.json`. The application itself remains a single offline Go binary
with no Node runtime dependency.

## Dev assets are not embedded (run after `npm ci`)

`web` is embedded with `//go:embed web`; `tests/frontend` is not. A Go test
checks both the embedded FS and the on-disk `web` tree for `node_modules`, test
directories, `package.json`/`package-lock.json` and `*.test.*`/`*.spec.*` files:

```sh
go test -race -run TestEmbeddedWebAssetsExcludeDevFiles -v .
```

Reproducible inspection of what the compiler will embed, with dependencies
installed:

```sh
go list -json . | python3 -c 'import json,sys; f=json.load(sys.stdin).get("EmbedFiles") or []; print(len(f), "files"); print([p for p in f if "node_modules" in p or p.endswith(("package.json","package-lock.json"))])'
```

Expected: a handful of real assets only (currently 15) and an empty list of dev
files, even with `tests/frontend/node_modules` populated.

## Coverage (incarico 001 requirements)

`document-session.test.cjs`

1. typing during a save: buffer stays dirty, `beforeunload` protects it, the
   newest text is persisted by exactly one follow-up pass and only then the
   document is reported as saved;
2. late answer of A after "New": the new buffer stays unnamed and nothing is
   written to A (autosave or explicit save);
3. late answer of A after opening B: B's path/title/content/status are intact;
4. two opens resolved in reverse order (newest wins) and typing during an open
   (ask again, or cancel without losing the typed text);
5. watchdog: stale stat/reload after a document change, after typing and after
   a save that made the buffer clean in the meantime;
6. pending autosave invalidated by a document change, reopening the same path
   starts a new session (no stale mtime);
7. repeated saves (coalesced, no overlap), network error and 409 conflict
   (no false clean, no uncontrolled retry);
8. untitled buffer: zero autosaves, no dialog, and the SSE open flow still asks
   before discarding local edits.

`save-as.test.cjs`

9. Save As/rename in flight: typing keeps the buffer dirty, the follow-up write
   targets the new path, the old path is never recreated, a late answer cannot
   take over another document, duplicate submissions send one rename, and the
   overwrite confirmation is asked once.

`watchdog.test.cjs` contains the detailed watchdog cases listed in point 5.
