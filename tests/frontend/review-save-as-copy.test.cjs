"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, deferRoute, jsonResponse } = require("./harness.cjs");

const cases = [
  { name: "I/O failure", status: 500, body: { success: false, error: "write_failed", message: "I/O error" } },
  { name: "same-source refusal", filename: "a.md", status: 409, body: { success: false, error: "conflict", conflict: "copy_same_source" } },
  { name: "protected destination", status: 403, body: { success: false, error: "read_only", path: "/docs/copy.md" } },
  { name: "declined overwrite", status: 409, cancel: true, body: { success: false, error: "conflict", conflict: "target_exists" } },
];

for (const scenario of cases) {
  test(`REVIEW 005: ${scenario.name} cancels autosave owed by edits during the unconfirmed copy`, async (t) => {
    const app = await createApp();
    t.after(() => app.close());
    const copies = deferRoute(app, "POST /api/rename");
    app.append(" draft");
    app.click("actionSaveAs");
    await app.flush();
    app.document.getElementById("fsFileNameInput").value = scenario.filename || "copy.md";
    app.click("btnFsConfirm");
    await app.flush();
    assert.equal(app.renameCalls().length, 1);
    assert.equal(app.renameCalls()[0].body.old_path, "");
    app.append(" more"); // sets a new debounce while the copy is still pending
    if (scenario.cancel) app.confirmAnswers.push(false);
    copies.at(0).resolve(jsonResponse(scenario.body, scenario.status));
    await app.flush();
    assert.equal(app.pathLabel(), "/docs/a.md");
    assert.equal(app.beforeUnloadBlocked(), true);
    await app.advance(2000);
    assert.equal(app.files["/docs/a.md"].content, "alpha", "unconfirmed copy must not overwrite the original via its pending edit timer");
    assert.equal(app.saveCalls().length, 0, "no hidden write to the original");
    assert.equal(app.value(), "alpha draft more");
    assert.equal(app.beforeUnloadBlocked(), true);
    assert.doesNotMatch(app.status(), /salvataggio/i);
  });
}

test("REVIEW 005b: an autosave already coalesced during a copy is dropped on retry refusal", async (t) => {
  const app = await createApp();
  t.after(() => app.close());
  const copies = deferRoute(app, "POST /api/rename");
  app.append(" draft");
  app.click("actionSaveAs");
  await app.flush();
  app.document.getElementById("fsFileNameInput").value = "copy.md";
  app.click("btnFsConfirm");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);
  app.append(" more");
  await app.advance(600); // debounce fires while the copy is pending, coalescing instead of sending
  assert.equal(app.saveCalls().length, 0);
  app.confirmAnswers.push(true);
  copies.at(0).resolve(jsonResponse({ success: false, error: "conflict", conflict: "target_exists" }, 409));
  await app.flush();
  assert.equal(app.renameCalls().length, 2);
  assert.equal(app.renameCalls()[1].body.overwrite, true);
  app.append(" again"); // also leave a fresh debounce pending when the retry fails
  copies.at(1).resolve(jsonResponse({ success: false, error: "snapshot_unstable" }, 503));
  await app.flush();
  await app.advance(2000);
  assert.equal(app.renameCalls().length, 2, "overwrite consent does not authorize another retry");
  assert.equal(app.saveCalls().length, 0);
  assert.equal(app.files["/docs/a.md"].content, "alpha");
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), "alpha draft more again");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.doesNotMatch(app.status(), /salvataggio/i);
});
