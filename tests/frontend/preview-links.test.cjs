"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("./harness.cjs");

async function withLinks(text, check) {
  const files = { "/docs/a.md": { content: text, mod_time: 1000 } };
  for (const path of ["/docs/notes #1.mdx", "/docs/100%2F.md", "C:/notes/file one.txt"]) {
    files[path] = { content: "content of " + path, mod_time: 2000 };
  }
  const app = await createApp({ files });
  try {
    app.click("btnModeSplit");
    await app.advance(300);
    await check(app);
  } finally {
    await app.close();
  }
}

function activate(app, label, type = "click", button = 0) {
  const anchor = [...app.document.querySelectorAll("#previewContent a")].find((node) => node.textContent === label);
  assert.ok(anchor, `preview contains anchor ${label}`);
  const event = new app.win.MouseEvent(type, { bubbles: true, cancelable: true, button });
  anchor.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, `native navigation for ${label} is canceled`);
}

for (const [href, path] of [
  ["notes%20%231.mdx#section", "/docs/notes #1.mdx"],
  ["100%252F.md", "/docs/100%2F.md"],
  ["file:///C:/notes/file%20one.txt", "C:/notes/file one.txt"],
]) {
  test(`preview opens ${href} inside the app and decodes the path only once`, () =>
    withLinks(`[open](${href})`, async (app) => {
      const before = app.win.location.href;
      activate(app, "open");
      await app.flush();
      assert.deepEqual(app.callsTo("GET", "/api/file").map((call) => call.query.path), [path]);
      assert.equal(app.value(), "content of " + path);
      assert.equal(app.win.location.href, before);
    }));
}

test("fragment scroll is scoped to the preview and never changes app history", () =>
  withLinks("# Heading\n\n[jump](#%68eading) [missing](#editor)", (app) => {
    const heading = app.document.querySelector("#previewContent h1");
    let scrolled = 0;
    heading.scrollIntoView = () => { scrolled += 1; };
    app.editor.scrollIntoView = () => assert.fail("fragment must not target app UI");
    const before = app.win.location.href;
    const historyLength = app.win.history.length;
    activate(app, "jump");
    activate(app, "missing");
    assert.equal(scrolled, 1);
    assert.equal(app.win.location.href, before);
    assert.equal(app.win.history.length, historyLength);
  }));

test("unsupported and ambiguous hrefs are inert even with middle-click, while external links are isolated", () =>
  withLinks(
    "[other](manual.pdf) [query](a.md?preview=1) [network](//example.org/a.md) " +
    "[encoded](%2F%5Cexample.org/a.md) [uri](file://example.org/a.md) [bad](a%ZZ.md) " +
    "[scheme](javascript:alert%281%29) [short](https:foo.md) " +
    "[web](https://example.org/a%20b?q=v) [mail](mailto:a@example.org) [phone](tel:+1234)", (app) => {
      const before = app.win.location.href;
      const opened = [];
      app.win.open = (...args) => { opened.push(args); };
      for (const label of ["other", "query", "network", "encoded", "uri", "bad", "scheme", "short"]) {
        activate(app, label);
        activate(app, label, "auxclick", 1);
      }
      assert.deepEqual(app.callsTo("GET", "/api/file"), []);
      assert.deepEqual(opened, []);
      activate(app, "web", "auxclick", 1);
      activate(app, "mail");
      activate(app, "phone");
      assert.deepEqual(opened, ["https://example.org/a%20b?q=v", "mailto:a@example.org", "tel:+1234"]
        .map((href) => [href, "_blank", "noopener,noreferrer"]));
      assert.equal(app.win.location.href, before);
    }));
