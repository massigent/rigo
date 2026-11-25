# TypeCraft ✍️

**A local-first Markdown editor for focused writing.**

Write in plain Markdown, then switch between source, rendered preview, and a synchronized split view. Typewriter scrolling and sentence or paragraph focus keep the current passage in view. Your documents stay in ordinary files on disk; no account is required. A single Go executable serves the interface in your browser.

[Download for Linux, Windows and macOS](https://github.com/massigent/typecraft/releases/tag/v1.0.5) · [Release notes](docs/releases/v1.0.5.md) · [Italiano](README.it.md)

---

## Features

### Focused writing
- **Continuous Typewriter Scrolling**: The active line remains fixed vertically at center (`45vh`). The document moves beneath your typing fingers smoothly using sub-pixel caret tracking (`requestAnimationFrame` + invisible mirror offset calculation).
- **3-Level Focus Mode (Sentence / Paragraph / Off)**: Press `Ctrl+D` to isolate your current sentence or paragraph. Surrounding text gently fades out (`30% opacity`), eliminating cognitive clutter.
- **Genuine Typography Included**: Embedded authentic **iA Writer Mono**, **iA Writer Duo**, and **iA Writer Quattro** fonts, plus classical editorial serif typefaces (**EB Garamond**, **Lora**).
- **Tactile Typewriter Mechanical Sound (Web Audio API)**: Toggle organic mechanical key clicks and carriage return bells with `Ctrl+Alt+T` (100% synthesized in code, zero audio assets needed).
- **Disappearing Zen Chrome**: As you type, toolbars and counters fade out completely.

### Markdown and preview
- **Seamless Live Preview**: Switch effortlessly between raw focus writing (`Ctrl+1`), formatted live preview (`Ctrl+2`), or synchronized dual split view (`Ctrl+3`).
- **Interactive Task Lists**: Checkboxes (`- [ ]` and `- [x]`) are clickable directly on screen and immediately sync with the underlying Markdown file and auto-save.
- **Formatted Tables**: Clean rounded markdown tables with alternating row zebra stripes.
- **Code Blocks with Fast Copy**: Syntax tags and dedicated copy-to-clipboard button.
- **Local Images**: `![alt](./img.png)` is resolved against the document folder and served by the app (no broken images, no path guessing).
- **Math Formulas**: Inline `$E=mc^2$` and block `$$\sum_{i=1}^n x_i$$` are protected from Markdown parsing and rendered as styled TeX source. *KaTeX is not bundled yet (see Roadmap), so formulas are not typeset.*
- **Dynamic Outline (TOC) Drawer**: Real-time table of contents (`Ctrl+Shift+O`) listing H1–H6 headings with instant click-to-jump navigation.

### Local operation
- **Single Go executable:** no Electron or Node.js runtime. A browser is required for the interface.
- **Desktop launcher:** launches in a supported browser's standalone window mode or opens in the default browser.
- **File protection:** saves replace files atomically, detect external edits, and respect read-only files. Save As writes a copy rather than moving the original.

---

## 🎨 4 Signature Themes

1. **☀️ iA Clean (Light)**: Crisp white paper, deep charcoal ink, iA electric blue caret.
2. **📜 Sepia Paper (Warm)**: Calming warm book tone for long reading and writing sessions.
3. **🌙 Typora Night (Slate)**: Dark slate gray for low-light environments.
4. **⬛ OLED Pure Black**: True `#000000` with luminous neon accents.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| **Ctrl + S** (Cmd+S) | Save file immediately |
| **Ctrl + Shift + S** | Save as (choose a new path) |
| **Ctrl + O** (Cmd+O) | Open Markdown file |
| **Ctrl + N** (Cmd+N) | New document |
| **Ctrl + P** | Print / Save as PDF (always rendered) |
| **Ctrl + D** (Cmd+D) | Cycle Focus Mode: Off ➔ Sentence ➔ Paragraph |
| **Ctrl + T** (Cmd+T) | Toggle Typewriter Scrolling |
| **Ctrl + Alt + T** | Toggle Typewriter Mechanical Sound |
| **Ctrl + Shift + O** | Toggle Outline (TOC) Drawer |
| **Ctrl + 1** | Focus Raw Mode |
| **Ctrl + 2** | Live Preview Mode |
| **Ctrl + 3** | Dual Split Mode |
| **Ctrl + B** | Bold (`**text**`) |
| **Ctrl + I** | Italic (`*text*`) |
| **Ctrl + K** | Insert Link (`[text](url)`) |
| **F11** | Fullscreen Zen Mode |
| **Esc** | Close drawers / menus / wake HUD |

---

## 🛠️ Build & Run

### Quick Start (Linux):
```bash
./typecraft
```

### Cross-Compilation for All Platforms:
```bash
# Build for current machine
make build

# Cross-compile for Linux (x64/arm64), macOS (Intel/Apple Silicon), and Windows (x64)
make cross-compile
```
Pre-built binaries will be placed in `dist/`:
- `typecraft-linux-amd64`
- `typecraft-linux-arm64`
- `typecraft-macos-amd64`
- `typecraft-macos-arm64`
- `typecraft-windows-amd64.exe`

### AppImage packaging (Linux):
`make appimage` requires `appimagetool` on `PATH` (or an explicit `APPIMAGETOOL=/path/to/appimagetool`).
It always builds a fresh Linux amd64 ELF, stages the desktop file, icon and `AppRun` in a private
temporary directory under `dist/`, and publishes `dist/TypeCraft-x86_64.AppImage` only after success:

```bash
make appimage

# Optional overrides
make appimage APPIMAGETOOL=/path/to/appimagetool DIST_DIR=release
```

`make install-appdir` builds a fresh Linux amd64 binary at
`TypeCraft.AppDir/usr/bin/typecraft` for local desktop testing; that ignored file is not used by the AppImage target.
Failed builds remove their staging directory and partial AppImage, leaving any previous artifact intact.

### Native Linux packages (x86_64)

`make deb` uses `dpkg-deb`, and `make rpm` uses `rpmbuild`. `make linux-packages` builds both native packages and the AppImage in `dist/`. The targets do not install system dependencies.

```bash
# Ubuntu
sudo apt install ./dist/typecraft_1.0.5-1_amd64.deb

# Fedora
sudo dnf install ./dist/typecraft-1.0.5-1.x86_64.rpm

# AppImage (no installation required)
chmod +x dist/TypeCraft-x86_64.AppImage
./dist/TypeCraft-x86_64.AppImage
```

On a system without FUSE, launch the AppImage with `APPIMAGE_EXTRACT_AND_RUN=1`. After installing the DEB or RPM, open **TypeCraft** from the applications menu or run `typecraft`.

### Windows and macOS packages

Download the Windows x64 setup from [Releases](https://github.com/massigent/typecraft/releases/tag/v1.0.5) and run it from your Windows account. On macOS, download the ZIP for Apple Silicon (`arm64`) or Intel (`amd64`), extract it, and move `TypeCraft.app` to Applications. These builds are not signed with a distribution certificate or notarized.

To cross-build on Linux, run `make windows-installer` (requires NSIS and `icotool`) or `make macos-packages` (requires Python 3 and `png2icns`). Run `sh tests/desktop-packaging-smoke.sh` after both builds to inspect the outputs with 7-Zip and Python.

---

## 📄 License
MIT License. Created with craftsmanship for writers and programmers.

---

## 🔧 What changed in 1.0.2

A review pass against real iA Writer and Typora builds fixed the following:

**Correctness / data safety**
- **Single-instance forwarding now works**: opening a second file from the file manager used to make the new process exit while the running window never learned about it (the path was written as raw text to the HTTP port). The primary now receives it over an authenticated control channel and the UI opens it via Server-Sent Events.
- **Closing the window no longer "bricks" the launcher**: the server used to stay alive with no UI, so every later launch (double-click on the AppImage, desktop icon) answered "already running" and showed nothing. A launch with no attached window now re-opens the UI.
- **Markdown is sanitized before rendering**: `marked` passed raw HTML through, so a document opened from anywhere could run script in the app origin — which holds the file API token. A strict allow-list (tags, attributes, URL schemes, no `on*`, no `style`) now runs on every render, plus a CSP, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`.
- **Print from Focus mode no longer prints a blank page** (`.pane.hidden` used to win over the print rule) and the print layout is no longer clipped to one screen.
- **HTML export** no longer contains the per-block "Copy" buttons and no longer exports a stale/empty preview.
- **Auto-save no longer pops the "Save as" dialog** on the welcome document; an untitled buffer stays untitled until you ask for a path, and a disk conflict during auto-save no longer opens a blocking modal.
- **Unsaved changes are protected** by a `beforeunload` guard.

**Feature fixes**
- **Task list checkboxes toggle the exact marker**: each Markdown task checkbox is mapped through Marked's own token tree to the precise marker in the buffer (bulleted, numbered, nested, quoted and duplicate tasks, including `[X]`). Prose `[x]`, HTML authors, inline/fenced/indented code and stale previews cannot shift or authorise an edit; ignored clicks do not dirty the document, and read-only tasks are disabled.
- **Checkmark visibility** (a `::after` on an `<input>` never renders) and **Focus dimming text no longer drifts** away from the caret (the highlighted line had a heavier weight, which changed glyph widths).
- **Links open in the external browser** instead of navigating the editor away, and links to other local `.md` files open inside TypeCraft.
- **Local images** now resolve relative to the document (`/api/asset`), with a broken-image placeholder.
- **Math** is stashed before Markdown parsing, so `$x_1 * y_2$` is no longer mangled into emphasis; block math no longer leaves stray empty paragraphs.
- **Theme/font/typewriter/focus/sound state is restored** in the HUD on launch.
- **Windows paths**: document titles, recents and save-as paths no longer break on `\`.
- **Bold/italic/link shortcuts preserve the undo stack** (`execCommand` instead of overwriting `.value`).
- **Empty documents open as empty** instead of being replaced by the welcome text.
- `.mkd/.mdwn/.mdx` are now listed in the file tree (they were accepted by the API but hidden).

**Engineering**
- Server gains `ReadHeaderTimeout`/`IdleTimeout`, security headers and `/api/events`, `/api/asset`, `/api/internal/open`.
- 6 new regression tests (`go test -race`).

---

## 🔧 What changed in 1.0.5

A usability defect fix reported against 1.0.4. Full detail in `docs/releases/v1.0.5.md`.

- **Double click selects the word again**: with typewriter scrolling enabled, every single click recentered
  the view, so the text moved under the cursor between the two clicks of a word selection and the second
  click landed a line above the intended word. The click recentering is now deferred by the double-click
  window and cancelled by any new mousedown; a click with `detail > 1` (second/third click of a selection)
  never recenters. Keyboard-driven recentering is unchanged.

---

## 🔧 What changed in 1.0.4

A second hardening review on top of 1.0.3. Full detail in `docs/releases/v1.0.4.md`.

**Security**
- **No token on the browser command line**: the app window used to open at a URL carrying the session
  token, readable by other local users through `/proc/<pid>/cmdline`. The page now receives the token
  from the `/api/init` handshake (including the startup-error response), and every fetch authenticates
  with the `X-Typecraft-Token` header; the query string form remains only for `EventSource` and
  `<img>`, which cannot set headers.
- **Bounded request bodies**: `/api/save`, `/api/rename` and `/api/mkdir` cap their JSON payloads at
  32 MiB (`413` beyond), so a runaway client cannot buffer an unbounded document in memory.
- **Fail-hard secrets**: if `crypto/rand` is unavailable the app refuses to start instead of falling
  back to a timestamp-derived (predictable) token.
- **Constant-time control secret**: the single-instance channel compares its secret like the UI
  token.

**Correctness and UX**
- **"Save as" prefers `~/Documents` on every locale**, not only on Italian homes.
- **`recents.json` is written atomically**, like a document save, so a crash cannot truncate it.
- **`/api/init` reports the real OS** (the field existed but was never set).
- **Windows file browser**: breadcrumbs and the workspace label split on both path separators, and a
  drive (`C:`) is a clickable root crumb.
- **External reloads keep the caret and viewport in place** instead of jumping to the end of the file.
- **Dead code removed**: the unused `/api/export/html` endpoint, an unreachable modal and an unused
  formatting case.

**Process**
- **CI on every push and pull request**: `gofmt` check, `go vet`, Go unit tests, the 146 jsdom
  frontend tests and a build now run before a release is cut (`release.yml` only fired on tags).

---

## 🔧 What changed in 1.0.3

A review pass backed by executable evidence (the real engine driven in jsdom, plus the compiled
binary probed over HTTP). Full detail in `REVIEW-1.0.3.md`.

**Visible bugs**
- **Code blocks are code blocks again**: Live Preview used to detach code from the Markdown and put it
  back as *source*, so the preview showed literal ``` backticks inside a `<p>` — no `<pre>`, no
  highlighting, no working "Copy" button. The fence is now rendered to HTML when it is detached
  (`<pre class="code-block"><code class="language-xx">`, escaped, unclosed fences tolerated), and
  inline code gets its own `<code>`.
- **An untitled document no longer writes a file behind your back**: the first keystroke on the welcome
  text created `~/Documents/Untitled.md` (and later sessions overwrote it). Auto-save no longer invents
  a path; the status stays `○ Unsaved` and `Ctrl+S` asks for a name.
- **`Ctrl+Alt+T` (sound) works on macOS**: with Option held `e.key` is `†`, so the shortcut never fired;
  it now uses `e.code`.

**Security**
- **`/api/asset` is confined to the document folder**: it served any image on disk (including `.svg`)
  while claiming otherwise; now `pathWithin()` resolves symlinks before comparing.
- **`/api/rename` can no longer delete arbitrary files**: `old_path` must be a Markdown document.
- **DNS-rebinding guard fixed**: `http://127.0.0.1.evil.com` and `http://localhost.evil.com` passed the
  prefix test; the host is now compared exactly.
- **Host/Origin boundary completed**: every request — landing page, `/static/*`, the `/api/init`
  handshake, tokenised APIs, `/api/events`, `/api/internal/open` and unknown paths — now needs the
  actual listener authority (`127.0.0.1:<port>` or `localhost:<port>`, hostname case-insensitive). A
  valid token does not authorise a foreign Host, so a rebinding name that resolves to 127.0.0.1 gets a
  `403` before any content or token is served. An `Origin` header, when present, must be same-origin
  (same scheme, host and port; no userinfo, path, query, fragment or multiple values); without it the
  request is allowed only after a valid Host and still needs the API token (or the internal control
  secret). `Forwarded`/`X-Forwarded-*` grant no trust, and rejections keep the security headers. This
  is a local loopback boundary, not isolation from other processes running as the same user.
- **Token compared in constant time** (`subtle.ConstantTimeCompare`).

**Data**
- **Saving preserves file permissions** (every save used to turn a `0644`/`0640` into `0600`) and syncs
  the directory entry too.
- **"Save as" no longer overwrites silently**: the backend answers `409` and only replaces with
  `overwrite: true`, which the UI sends after an explicit confirmation.
- **The extension you type is no longer rewritten** (the bug Typora fixed in 1.13.7): unsupported
  extensions get a `400` listing what is allowed, with one explicit question when the name really looks
  like a file type.
- **External change watchdog** (`/api/stat`, every 5 s — Typora 1.13.7): a clean buffer reloads
  (`● Reloaded from disk`), a dirty one shows `⚠️ Changed on disk` and not a single typed line is
  touched.
- **Saves and conflicts use opaque content revisions** (`sha256:<hex>` of the file bytes) instead of
  timestamps: an external edit is detected even when `mtime` and size are identical, a save with a stale
  baseline gets a structured `409` (never a silent overwrite), a file deleted on disk is not recreated,
  and a rename verifies the source revision before touching anything. `mod_time` stays metadata;
  oversized integer timestamps are no longer the baseline. `/api/stat` now hashes the file on every
  poll (one read per window every 5 s), which is the price for detecting same-metadata changes.
  Legacy API clients that sent only `mod_time` must read a revision and send `expected_revision`
  (`428 revision_required` otherwise).
- **Read-only documents are protected by the backend, not only by the UI**: a file with no write bits
  (or without effective write access for the process) is reported as `read_only` and cannot be saved,
  renamed or replaced by the atomic write, even with an explicit content-conflict override; a protected
  destination is refused too. The editor is locked (including toolbar, tables and preview task boxes),
  autosave is suspended, and an explicit **Save a copy** writes a new document with `old_path` empty so
  the original is never modified or deleted. POSIX mode bits are the app policy; Windows/POSIX ACLs
  beyond the process view are only advisory and surface as a `write_forbidden` error at write time
  (a read-only filesystem, `EROFS`, is a write refusal too). A rename needs removal rights on the
  source directory, not only write access to the file: when the destination was written but the
  source could not be removed, the answer is an explicit **incomplete/partial** error (source kept,
  no automatic rollback, no active-document switch), never a fake success. At launch, an unreadable
  active file is reported instead of being shown as a clean empty document, and a protocol-invalid
  server answer keeps the buffer dirty with an explicit warning (no path/baseline adoption, no blind
  retry).
- **Save As keeps the original**: «Salva con nome» (`Ctrl/Cmd+Shift+S` or the menu) writes the current
  buffer to a new path and leaves the source untouched; only «Rinomina / Sposta» (click on the title)
  moves the file, and only on full success. Save As sends an explicit `source_path` and the backend
  refuses a destination that is the source itself (same path, symlink alias, same file/hard link), so a
  copy can never clobber the original (symlink chains, dangling links, symlinked folders and hard links
  are refused or fail explicitly; the dialog suggests a `*-copia.md` name). A destination that is a
  symlink entry the source path traverses (for example a directory link needed to reach the original)
  is refused as `copy_same_source` even when the final referents differ or `overwrite` is set.
  Relative link targets are resolved from the link's physical directory, including symlinked folders and
  the existing prefix of a missing path; a distinct destination entry whose referent is missing still
  requires explicit overwrite consent. Cancelling or a denied destination leaves the source and the
  dirty buffer intact, and edits typed while an unconfirmed copy was pending are kept in the buffer
  instead of being auto-saved onto the source.

**Engineering**
- Current regression suite: 79 top-level Go tests (`go test -race -shuffle=on ./...`) and 118
  frontend tests after `npm ci`; `go vet`, JS/CJS/MJS syntax checks and `git diff --check` are clean.
- Copy-identity verification is a preflight serialized with this process's writes, **not** a filesystem
  CAS: an external process can still mutate the paths between verification and the atomic write.
  Symlink chains are bounded (40 hops) and hard links are conservatively refused as aliases.

---

## 🗺️ Roadmap (gaps vs iA Writer / Typora)

- Bundle KaTeX for real math typesetting (and Mermaid for diagrams).
- Find & replace in document (with regex), and a word-count target.
- Syntax Control / Style Check (parts of speech via NLP is not portable in Go; a dictionary-based cliché/filler pass is feasible).
- Table editing affordances (add/remove row/column), image drag & drop.
- Library/folder sidebar with pinning and smart filters (`#tag`), export to PDF/DOCX via Pandoc.
