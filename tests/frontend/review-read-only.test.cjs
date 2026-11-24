"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, deferRoute, jsonResponse } = require("./harness.cjs");

test("REVIEW 004: a protected destination refusal ends the saving status of a normal dirty document", async (t) => {
  const app = await createApp({
    files: { "/docs/b.md": { content: "protected target", mod_time: 2000, read_only: true } },
  });
  t.after(() => app.close());
  app.append(" draft");
  assert.match(app.status(), /salvataggio/i);
  app.click("docTitleBtn");
  await app.flush();
  app.document.getElementById("fsFileNameInput").value = "b.md";
  app.click("btnFsConfirm");
  await app.flush();

  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.confirmMessages.length, 0, "permissions are not an overwrite conflict");
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.editor.readOnly, false, "only the destination is protected");
  assert.equal(app.value(), "alpha draft");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.files["/docs/a.md"].content, "alpha");
  assert.equal(app.files["/docs/b.md"].content, "protected target");
  assert.doesNotMatch(app.status(), /salvataggio/i, "the refusal must terminate the transient saving indicator");
  assert.doesNotMatch(app.statusKind(), /saving/);
  await app.advance(2000);
  assert.equal(app.saveCalls().length, 0, "no hidden retry after the denied rename");
});

test("REVIEW 004b: a generic I/O partial outcome is disclosed without adopting the destination or retrying", async (t) => {
  const app = await createApp();
  t.after(() => app.close());
  const renames = deferRoute(app, "POST /api/rename");
  app.append(" draft");
  app.click("docTitleBtn");
  await app.flush();
  app.document.getElementById("fsFileNameInput").value = "b.md";
  app.click("btnFsConfirm");
  await app.flush();
  renames.at(0).resolve(jsonResponse({
    success: false, error: "write_failed", partial: true,
    path: "/docs/b.md",
    message: "rename incomplete: destination written, source not removed: I/O error",
  }, 500));
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), "alpha draft");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.doesNotMatch(app.status(), /salvataggio/i);
  assert.doesNotMatch(app.statusKind(), /\b(?:saving|saved)\b/);
  assert.ok(app.alertMessages.some((m) => /destination written, source not removed/.test(m)),
    "the generic I/O path must disclose the destination side effect too");
  await app.advance(2000);
  assert.equal(app.saveCalls().length, 0);
  assert.equal(app.renameCalls().length, 1);
});
