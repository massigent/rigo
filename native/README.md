# Rigo native (Rust prototype)

A browser-free reimplementation of the Rigo editor: **pure Rust + egui**,
one 14 MB binary, no WebView, no Chromium, no browser launch chain. This is a
**prototype on the `rust-native` branch**: it proves the architecture, ports
the core document protocol and the signature editing features, and documents
what full parity would still require.

## What is already there

- **Document protocol, ported 1:1 from the Go backend**: content revisions
  (`sha256:<hex>`, compared for equality only), atomic saves (temp file +
  rename + fsync, file mode preserved), read-only policy (no write bits →
  refused before any conflict handling), conflict detection with one-shot
  force consent, deleted files never silently recreated, external-change
  watchdog (clean buffer → reload; dirty buffer → warning only).
- **The signature features**: typewriter scrolling (exact caret row centered
  at 45%, instant while typing, animated on caret jumps, never during pointer
  selections — the 1.0.4 lesson is baked in), 3-level focus dimming
  (sentence/paragraph, same tokenizer as the web app) rendered inside the
  editor itself via a per-run colored layout, three view modes
  (raw / live / split), outline panel with real parser headings (fake ones in
  code fences are skipped) and click-to-jump.
- **Markdown preview**: pulldown-cmark → egui (headings, bold/italic/code,
  links, block quotes, ordered/unordered/task lists, code blocks, rules,
  tables as text). Raw HTML is rendered as literal text: nothing is ever
  executed.
- **Four themes** (Carta, Sepia, Notte, OLED), IBM Plex fonts (SIL OFL)
  bundled at `native/assets/fonts/`, status bar (Ln/Col, words,
  chars), native file dialogs via xdg-desktop-portal (no GTK build dep,
  Fedora-friendly).
- **20 headless tests** — the UI render is driven with a bare `egui::Context`
  in every view mode, and the whole protocol is unit-tested (conflicts,
  read-only, atomicity, mode preservation, watchdog adoption).

## Run it

```sh
cd native
cargo run            # debug
cargo run --release  # the 14 MB binary
cargo test           # 20 tests, fully headless, no display needed
```

Requirements: Rust 1.75+ and, at runtime only, a display (X11/Wayland).
No system libraries: the GUI stack is pure Rust.

## Honest roadmap to parity (what a rewrite really costs)

- Preview: images (needs texture loading from disk), click-to-open links,
  tables rendered as real tables, copy-code buttons.
- Editor: drag-to-select niceties parity, Undo/redo history, find/replace.
- Web-only features to port: task checkbox click → source edit, math
  protection, TOC click with exact source offsets (byte↔char maps), sounds
  (rodio), print/export, recents menu (the storage hook already exists).
- Packaging: `.deb`/`.rpm`/AppImage for the Rust binary; cross-compilation
  for Windows (MSVC) and macOS.

Estimated effort to close all of it: weeks, not days — which is exactly why
this lives on a branch and not on `main`.
