# TypeCraft ✍️

**The minimalist, distraction-free, high-performance Markdown editor for all platforms.**

TypeCraft combines the deep immersion and iconic **Typewriter Mode with Focus Dimming** from **iA Writer** with the seamless **Hybrid Live Preview & Table Editing** of **Typora**, built on top of the ultra-lightweight **single-binary architecture** proven in **PubCraft**.

---

## 🌟 The Best of Both Worlds

### From iA Writer:
- **Continuous Typewriter Scrolling**: The active line remains fixed vertically at center (`45vh`). The document moves beneath your typing fingers smoothly using sub-pixel caret tracking (`requestAnimationFrame` + invisible mirror offset calculation).
- **3-Level Focus Mode (Sentence / Paragraph / Off)**: Press `Ctrl+D` to isolate your current sentence or paragraph. Surrounding text gently fades out (`30% opacity`), eliminating cognitive clutter.
- **Genuine Typography Included**: Embedded authentic **iA Writer Mono**, **iA Writer Duo**, and **iA Writer Quattro** fonts, plus classical editorial serif typefaces (**EB Garamond**, **Lora**).
- **Tactile Typewriter Mechanical Sound (Web Audio API)**: Toggle organic mechanical key clicks and carriage return bells with `Ctrl+Alt+T` (100% synthesized in code, zero audio assets needed).
- **Disappearing Zen Chrome**: As you type, toolbars and counters fade out completely.

### From Typora:
- **Seamless Live Preview**: Switch effortlessly between raw focus writing (`Ctrl+1`), formatted live preview (`Ctrl+2`), or synchronized dual split view (`Ctrl+3`).
- **Interactive Task Lists**: Checkboxes (`- [ ]` and `- [x]`) are clickable directly on screen and immediately sync with the underlying Markdown file and auto-save.
- **Formatted Tables**: Clean rounded markdown tables with alternating row zebra stripes.
- **Code Blocks with Fast Copy**: Syntax tags and dedicated copy-to-clipboard button.
- **Local Images**: `![alt](./img.png)` is resolved against the document folder and served by the app (no broken images, no path guessing).
- **Math Formulas**: Inline `$E=mc^2$` and block `$$\sum_{i=1}^n x_i$$` are protected from Markdown parsing and rendered as styled TeX source. *KaTeX is not bundled yet (see Roadmap), so formulas are not typeset.*
- **Dynamic Outline (TOC) Drawer**: Real-time table of contents (`Ctrl+Shift+O`) listing H1–H6 headings with instant click-to-jump navigation.

### From PubCraft's Engineering:
- **Zero-Dependency Single Binary**: No Electron bloat, no Node.js runtime required. Compiles to an independent 11 MB binary using Go.
- **Instant Launch (<50ms)** and tiny memory footprint (<25MB RAM).
- **Native Window Integration**: Automatically launches in app window mode via Chrome, Chromium, Brave, or Edge (`--app`), or system default browser.
- **Two-Phase Atomic Saving**: Writes to a temp file and syncs to disk before replacement, guaranteeing zero data loss.

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
- **Task list checkboxes are actually clickable**: `marked` emits `disabled` inputs, which never fire `click`; the click handler also counted `[x]` in ordinary prose and could toggle the wrong line. Both are fixed.
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
  touched; a file opened at launch reads its `mtime` immediately, so the first auto-save no longer skips
  the conflict check.

**Engineering**
- 6 new regression tests (19 total, `go test ./...` green, `go vet` clean).

---

## 🗺️ Roadmap (gaps vs iA Writer / Typora)

- Bundle KaTeX for real math typesetting (and Mermaid for diagrams).
- Find & replace in document (with regex), and a word-count target.
- Syntax Control / Style Check (parts of speech via NLP is not portable in Go; a dictionary-based cliché/filler pass is feasible).
- Table editing affordances (add/remove row/column), image drag & drop.
- Library/folder sidebar with pinning and smart filters (`#tag`), export to PDF/DOCX via Pandoc.
