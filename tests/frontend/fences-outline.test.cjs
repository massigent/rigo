"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("./harness.cjs");

async function withDoc(text, check) {
  const app = await createApp({ files: { "/docs/a.md": { content: text, mod_time: 1000 } } });
  try {
    app.click("btnModeSplit");
    await app.advance(500);
    await check(app);
  } finally {
    await app.close();
  }
}
const outline = (app) => [...app.document.querySelectorAll("#outlineList .outline-item")];
const preview = (app) => app.document.getElementById("previewContent");
const headings = (app) => [...preview(app).querySelectorAll(":is(h1,h2,h3,h4,h5,h6)")];
const labels = (nodes) => nodes.map((node) => node.textContent);

test("longer backtick/tilde closers end code; repeated outline titles jump to their own source", () =>
  withDoc("# Same\n\n```js\n# fake\n````\n\n~~~\n# fake2\n~~~~\n\n# Same\n\n# Same-1\n", (app) => {
    assert.deepEqual(labels(outline(app)), ["Same", "Same", "Same-1"]);
    const h = headings(app);
    assert.deepEqual(labels(h), ["Same", "Same", "Same-1"]);
    assert.ok(h.every((node) => node.id));
    assert.equal(new Set(h.map((node) => node.id)).size, 3);
    assert.equal(preview(app).querySelectorAll("pre .btn-copy-code").length, 2);
    assert.equal(preview(app).querySelector("pre code.language-js").textContent, "# fake");
    outline(app)[1].click();
    assert.equal(app.editor.selectionStart, app.value().lastIndexOf("# Same\n"));
  }));

test("quoted and indented code cannot become headings, but quoted and Setext headings can", () =>
  withDoc("> ~~~\n> # fake\n> ~~~~\n> ## Quoted\n\n    ## Indented\n\nSetext\n======\n\n````\n### Unclosed", (app) => {
    assert.deepEqual(labels(headings(app)), ["Quoted", "Setext"]);
    assert.deepEqual(labels(outline(app)), ["Quoted", "Setext"]);
    outline(app)[0].click();
    assert.equal(app.editor.selectionStart, app.value().indexOf("## Quoted"));
    outline(app)[1].click();
    assert.equal(app.editor.selectionStart, app.value().indexOf("Setext"));
  }));

test("math stays literal in table spans and fences; copy preserves the code text", () =>
  withDoc("| A | B |\n|---|---|\n| `$x\\|y$` | $z_1$ |\n\n~~~txt\n$$x$$\n\n~~~~\n", async (app) => {
    const p = preview(app);
    assert.equal(p.querySelector("td code").textContent, "$x|y$");
    assert.equal(p.querySelector("td code .math-tex"), null);
    assert.equal(p.querySelector("td .math-tex").textContent, "z_1");
    assert.equal(p.querySelector("pre code").textContent, "$$x$$\n");
    let copied;
    Object.defineProperty(app.win, "isSecureContext", { value: true });
    Object.defineProperty(app.win.navigator, "clipboard", { value: { writeText: async (text) => { copied = text; } } });
    p.querySelector(".btn-copy-code").click();
    await app.flush();
    assert.equal(copied, "$$x$$\n");
  }));

test("leading tabs and tabs after list markers keep literal code and source heading offsets", () =>
  withDoc("\t$x$\n\n-\titem\n\t```\n\t$y$\n\t```\n\n-\t# Nested heading\n", (app) => {
    assert.deepEqual(labels([...preview(app).querySelectorAll("pre code")]), ["$x$", "$y$"]);
    assert.equal(preview(app).querySelector("pre .math-tex"), null);
    assert.deepEqual(labels(outline(app)), ["Nested heading"]);
    outline(app)[0].click();
    assert.equal(app.editor.selectionStart, app.value().indexOf("# Nested heading"));
  }));

test("headings after multiline math keep exact source offsets and valid anchor IDs", () =>
  withDoc("$$\n# formula text\n$$\n\n# `x_y` &amp; $z_1$\n\n# 123\n\n# È già\n", (app) => {
    assert.deepEqual(labels(headings(app)), ["x_y & z_1", "123", "È già"]);
    assert.deepEqual(labels(outline(app)), ["x_y & z_1", "123", "È già"]);
    assert.ok(headings(app).every((heading) => /^[A-Za-z][\w:.-]*$/.test(heading.id)));
    outline(app)[0].click();
    assert.equal(app.editor.selectionStart, app.value().indexOf("# `x_y`"));
    const old = outline(app)[1];
    app.type("# New\n" + app.value());
    app.editor.setSelectionRange(0, 0);
    old.click();
    assert.equal(app.editor.selectionStart, 0);
  }));

test("tasks whose source mapping is unresolved are visibly disabled and cannot edit", () =>
  withDoc("1. [ ] a\n   - [ ] b\n c", (app) => {
    const boxes = [...preview(app).querySelectorAll("input[type=checkbox]")];
    const text = app.value();
    assert.equal(boxes.length, 2);
    for (const box of boxes) {
      assert.equal(box.disabled, true);
      box.dispatchEvent(new app.win.MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    assert.equal(app.value(), text);
    assert.equal(app.beforeUnloadBlocked(), false);
    assert.equal(app.saveCalls().length, 0);
  }));
