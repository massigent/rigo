"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, deferred, jsonResponse, textResponse, conflictBody } = require("./harness.cjs");

async function submitRename(app) {
  app.click("docTitleBtn");
  await app.flush();
  app.document.getElementById("fsFileNameInput").value = "b.md";
  app.click("btnFsConfirm");
  await app.flush();
}

test("REVIEW 003: a save conflict body delivered after New cannot prompt or alter the new session", async (t) => {
  const app = await createApp();
  t.after(() => app.close());
  const body = deferred();
  app.routes["POST /api/save"] = () => ({ ok: false, status: 409, json: () => body.promise });
  app.append(" local");
  app.ctrlS();
  await app.flush();
  app.click("actionNew");
  app.type("new untitled text");
  const status = app.status();
  const confirms = app.confirmMessages.length;
  body.resolve(conflictBody("revision_mismatch"));
  await app.flush();
  assert.equal(app.confirmMessages.length, confirms, "no confirmation from the abandoned session");
  assert.equal(app.status(), status, "the old conflict cannot change the new status");
  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.value(), "new untitled text");
});

test("REVIEW 003: a delayed target_exists body cannot issue an overwrite after its session is abandoned", async (t) => {
  const app = await createApp();
  t.after(() => app.close());
  const body = deferred();
  const realRename = app.routes["POST /api/rename"];
  let requests = 0;
  app.routes["POST /api/rename"] = (call) => {
    requests += 1;
    if (requests === 1) return { ok: false, status: 409, json: () => body.promise };
    return realRename(call);
  };
  await submitRename(app);
  assert.equal(requests, 1);
  app.click("actionNew");
  const confirms = app.confirmMessages.length;
  body.resolve(conflictBody("target_exists"));
  await app.flush();
  assert.equal(app.renameCalls().length, 1, "no new destructive POST for the abandoned session");
  assert.equal(app.confirmMessages.length, confirms);
  assert.equal(app.files["/docs/a.md"].content, "alpha");
  assert.equal(app.files["/docs/b.md"].content, "beta");
});

for (const kind of ["save", "rename"]) {
  for (const revision of [undefined, "not-a-revision"]) {
    test(`REVIEW 003: ${kind} 200 with ${revision === undefined ? "missing" : "invalid"} disk revision remains dirty`, async (t) => {
      const app = await createApp();
      t.after(() => app.close());
      app.append(" local");
      const path = kind === "save" ? "/docs/a.md" : "/docs/b.md";
      app.routes[kind === "save" ? "POST /api/save" : "POST /api/rename"] = () =>
        jsonResponse({ success: true, path, ...(revision === undefined ? {} : { revision }) });
      if (kind === "save") { app.ctrlS(); await app.flush(); }
      else await submitRename(app);
      assert.equal(app.beforeUnloadBlocked(), true, "protocol-invalid success cannot clean local text");
      assert.notEqual(app.status(), "● Salvato");
      assert.equal(app.value(), "alpha local");
      assert.equal(app.pathLabel(), "/docs/a.md", "do not adopt an untrusted path/baseline");
    });
  }
}

test("REVIEW 003: the init fixture supplies the empty-file revision, not a missing baseline", async (t) => {
  const app = await createApp({ files: { "/docs/a.md": { content: "", mod_time: 1000 } } });
  t.after(() => app.close());
  assert.equal(app.value(), "");
  app.type("first content");
  await app.advance(600);
  assert.equal(app.files["/docs/a.md"].content, "first content", "an existing empty file has a valid snapshot baseline");
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);
});

for (const malformed of [false, true]) {
  test(`REVIEW 003: ${malformed ? "non-JSON" : "unknown"} 409 never becomes overwrite consent`, async (t) => {
    const app = await createApp();
    t.after(() => app.close());
    app.routes["POST /api/save"] = () => malformed
      ? textResponse("legacy conflict", 409)
      : jsonResponse({ error: "conflict", conflict: "unrecognized" }, 409);
    app.append(" local");
    app.ctrlS();
    await app.flush();
    assert.equal(app.confirmMessages.length, 0, "only a recognized revision_mismatch can ask for force");
    assert.equal(app.saveCalls().length, 1, "no fallback force on unknown protocol responses");
    assert.equal(app.beforeUnloadBlocked(), true);
  });
}
