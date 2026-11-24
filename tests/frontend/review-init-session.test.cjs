"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, jsonResponse, revOf } = require("./harness.cjs");

const cases = [
  { name: "invalid init snapshot after New and Save As", kind: "invalid", newSession: true },
  { name: "missing init file after New and Save As", kind: "missing", newSession: true },
  { name: "init 503 after New and Save As", kind: "http-error", newSession: true },
  { name: "init network error after New and Save As", kind: "network-error", newSession: true },
  { name: "invalid init snapshot after Save As in the original session", kind: "invalid", newSession: false },
];

for (const scenario of cases) {
  test(`REVIEW 003b: ${scenario.name} cannot change the adopted document`, async (t) => {
    const app = await createApp({ deferInit: true });
    t.after(() => app.close());
    if (scenario.newSession) app.click("actionNew");
    const content = "a document created and saved while init was pending";
    app.type(content);
    app.click("docTitleBtn");
    await app.flush();
    app.document.getElementById("fsFileNameInput").value = "new.md";
    app.click("btnFsConfirm");
    await app.flush();
    assert.equal(app.pathLabel(), "/docs/new.md");
    assert.equal(app.status(), "● Salvato");

    if (scenario.kind === "network-error") {
      app.initGate.reject(new Error("old init request failed"));
    } else if (scenario.kind === "http-error") {
      app.initGate.resolve(jsonResponse({ error: "snapshot_unstable" }, 503));
    } else {
      app.initGate.resolve(jsonResponse({
        token: "test-token",
        active_file: "/docs/a.md",
        active_dir: "/docs",
        file_content: "alpha",
        file_revision: scenario.kind === "invalid" ? "bad" : "",
        file_exists: scenario.kind !== "missing",
        recents: [],
      }));
    }
    await app.flush();

    assert.equal(app.pathLabel(), "/docs/new.md", "late boot must not erase the current path");
    assert.equal(app.title(), "new.md — TypeCraft");
    assert.equal(app.status(), "● Salvato", "an old boot failure is not this document's error");
    assert.equal(app.value(), content);
    assert.equal(app.beforeUnloadBlocked(), false);

    // Baseline must survive too: the next legitimate write is still ordinary,
    // on the adopted path, with its confirmed content revision and no force.
    app.append("!");
    app.ctrlS();
    await app.flush();
    assert.equal(app.lastSave().body.path, "/docs/new.md");
    assert.equal(app.lastSave().body.expected_revision, revOf(content));
    assert.equal(app.lastSave().body.force, false);
    assert.equal(app.files["/docs/new.md"].content, content + "!");
    assert.equal(app.status(), "● Salvato");
  });
}
