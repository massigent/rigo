// Performance regression tests for the two hot per-keystroke paths.
//
// 1. Typewriter line cache: the reuse rule is pure and decides whether the
//    current line's cached first-row Y may be trusted. It must accept the
//    typing flow (one contiguous edit at the caret, same line) and refuse
//    everything that cannot be proven (line change, zero delta, edits that
//    imply text above changed).
// 2. Focus dimming: the backdrop must keep three persistent spans and update
//    only the current span while typing inside a sentence; crossing a
//    boundary refreshes before/after; the class names follow the mode.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("./harness.cjs");
const fs = require("node:fs");
const path = require("node:path");

// typewriter.js assigns to window: load it through a minimal stub.
function loadTypewriterClass() {
  const window = {};
  const fn = new Function("window", "document", "localStorage",
    require("fs").readFileSync(require("path").join(__dirname, "../../web/static/js/typewriter.js"), "utf8"));
  fn(window, { body: { classList: { toggle: () => {} } }, createElement: () => ({ style: {} }) },
    { getItem: () => null, setItem: () => {} });
  return window.TypewriterEngine;
}

test("line cache rule accepts the typing flow inside one line", () => {
  const E = loadTypewriterClass();
  const text = "prima riga\nseconda riga ancora";
  const lineStart = text.lastIndexOf("\n") + 1;

  // Cached after a full measure with the caret mid-line.
  const cache = { lineStart, lineTopY: 123.0, textLen: text.length, sel: 24 };

  // One character typed at the caret: delta 1 == caret delta 1.
  const typed = text.slice(0, 24) + "X" + text.slice(24);
  assert.equal(E.lineCacheValid(typed, 25, cache), true);

  // Backspace: one deletion at the caret.
  assert.equal(E.lineCacheValid(text.slice(0, 23) + text.slice(24), 23, cache), true);

  // Arrow move (no edit): refused, nothing is proven about the text.
  assert.equal(E.lineCacheValid(text, 23, cache), false);
  assert.equal(E.lineCacheValid(text, 25, cache), false);

  // A different line entirely: refused.
  assert.equal(E.lineCacheValid(text, 5, cache), false);

  // An edit whose size does not match the caret move (e.g. text changed
  // elsewhere): refused.
  assert.equal(E.lineCacheValid(text + "a", 24, cache), false);

  // Paste above the line with the caret after it: caret moved without an
  // edit at the old caret — refused.
  const pastedAbove = "nuova\n" + text;
  assert.equal(E.lineCacheValid(pastedAbove, cache.sel, cache), false);

  // No cache: refused.
  assert.equal(E.lineCacheValid(text, 24, null), false);

  // Backspace at the line start joins lines: the line start moved — refused.
  const joined = text.slice(0, lineStart - 1) + text.slice(lineStart);
  assert.equal(E.lineCacheValid(joined, lineStart - 1, cache), false);
});

test("focus dimming updates incrementally and keeps the spans persistent", async (t) => {
  const app = await createApp({ activeFile: "/docs/a.md" });
  t.after(() => app.close());
  const win = app.win;
  const backdrop = win.document.getElementById("focusBackdrop");
  const engine = win.focusDim;

  engine.mode = "sentence";
  engine.applyMode();

  const text = "Prima frase. Seconda frase! Terza.";
  app.setValue(text);
  app.editor.setSelectionRange(16, 16); // inside "Seconda"
  engine.render();
  const spansBefore = backdrop.querySelectorAll(":scope > span");
  assert.equal(spansBefore.length, 3, "three persistent spans");
  const [before, current, after] = spansBefore;
  assert.equal(current.className, "focus-current");
  // The tokenizer consumes the whitespace after the punctuation (the original
  // regex is [.!?]+[\s]*), so the current span ends with the space.
  assert.equal(current.textContent, "Seconda frase! ");
  assert.equal(before.textContent, "Prima frase. ");
  assert.equal(after.textContent, "Terza.");

  // Typing inside the current sentence: same three span NODES (no rebuild),
  // only the current span's content changes.
  const typed = "Prima frase. Seconda fraseX! Terza.";
  app.setValue(typed);
  app.editor.setSelectionRange(17, 17);
  engine.render();
  const spansAfter = backdrop.querySelectorAll(":scope > span");
  assert.equal(spansAfter[0], before, "the span nodes are reused, not recreated");
  assert.equal(spansAfter[1], current);
  assert.equal(spansAfter[2], after);
  assert.equal(current.textContent, "Seconda fraseX! ");
  assert.equal(before.textContent, "Prima frase. ");
  assert.equal(after.textContent, "Terza.");

  // Crossing a sentence boundary refreshes before/after.
  app.editor.setSelectionRange(4, 4); // inside "Prima"
  engine.render();
  assert.equal(current.textContent, "Prima frase. ");
  assert.equal(before.textContent, "");
  assert.equal(after.textContent, "Seconda fraseX! Terza.");

  // Paragraph mode keeps its own dimmed class on the side spans.
  engine.mode = "paragraph";
  engine.applyMode();
  const [b2, c2, a2] = backdrop.querySelectorAll(":scope > span");
  assert.match(b2.className, /focus-dimmed-paragraph/);
  assert.match(a2.className, /focus-dimmed-paragraph/);
  assert.equal(c2.textContent, typed); // the whole paragraph is current
});
