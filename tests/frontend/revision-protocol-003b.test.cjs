// Incarico 003b — protocol error handling and init snapshot failures.
//
// HTTP 200 is only a confirmation when the body matches the revision protocol:
// these tests pin the strict behaviour (no dirty-clearing, no path/baseline
// adoption, no overwrite consent from unknown conflicts, no retry loops).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createApp,
  deferred,
  jsonResponse,
  textResponse,
  conflictBody,
  revOf,
} = require("./harness.cjs");

async function submitRename(app) {
  app.click("docTitleBtn");
  await app.flush();
  app.document.getElementById("fsFileNameInput").value = "b.md";
  app.click("btnFsConfirm");
  await app.flush();
}

test("a save 200 without a JSON body is a protocol error, not a saved document", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  app.routes["POST /api/save"] = () => textResponse("OK", 200);
  app.append(" local");
  app.ctrlS();
  await app.flush();

  assert.equal(app.beforeUnloadBlocked(), true, "the text is not persisted");
  assert.equal(app.status(), "⚠️ Risposta del server non valida");
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), "alpha local");

  // No baseline/path was adopted from the untrusted answer.
  app.ctrlS();
  await app.flush();
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));
});

test("a save 200 with success:false is a protocol error", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  app.routes["POST /api/save"] = () => jsonResponse({
    success: false,
    path: "/docs/a.md",
    revision: revOf("alpha local"),
  });
  app.append(" local");
  app.ctrlS();
  await app.flush();

  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.status(), "⚠️ Risposta del server non valida");
  assert.equal(app.value(), "alpha local");
});

test("a rename 200 without a valid revision keeps the document dirty and in place", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  app.routes["POST /api/rename"] = () => jsonResponse({ success: true, path: "/docs/b.md" });
  app.append(" local");
  await submitRename(app);

  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.status(), "⚠️ Risposta del server non valida");
  assert.equal(app.pathLabel(), "/docs/a.md", "the untrusted path is not adopted");
  assert.equal(app.value(), "alpha local");
  assert.equal(app.renameCalls().length, 1, "no blind retry");
  assert.ok(app.alertMessages.length >= 1);
});

test("an unknown save conflict (JSON or not) never becomes overwrite consent", async (t) => {
  for (const body of [jsonResponse(conflictBody("unrecognized"), 409), textResponse("legacy", 409)]) {
    const app = await createApp();
    t.after(() => app.close());
    app.routes["POST /api/save"] = () => body;
    app.append(" local");
    app.ctrlS();
    await app.flush();

    assert.equal(app.confirmMessages.length, 0);
    assert.equal(app.saveCalls().length, 1, "no implicit force retry");
    assert.equal(app.beforeUnloadBlocked(), true);
    assert.equal(app.status(), "⚠️ Conflitto non riconosciuto dal server");
  }
});

test("an unknown rename conflict never triggers the overwrite question or retry", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  app.routes["POST /api/rename"] = () => jsonResponse(conflictBody("unrecognized"), 409);
  app.append(" local");
  await submitRename(app);

  assert.equal(app.confirmMessages.length, 0);
  assert.equal(app.renameCalls().length, 1, "no overwrite:true retry");
  assert.equal(app.status(), "⚠️ Conflitto non riconosciuto dal server");
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.beforeUnloadBlocked(), true);
});

test("a delayed save retry body cannot clean another document", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const retryBody = deferred();
  let calls = 0;
  app.routes["POST /api/save"] = () => {
    calls += 1;
    if (calls === 1) return jsonResponse(conflictBody("revision_mismatch"), 409);
    return { ok: true, status: 200, json: () => retryBody.promise };
  };

  app.append(" local");
  app.ctrlS();
  await app.flush();
  assert.equal(calls, 2, "one authorized retry");
  assert.equal(app.confirmMessages.length, 1);

  app.click("actionNew");
  app.type("new document text");
  const status = app.status();

  retryBody.resolve({ success: true, path: "/docs/a.md", revision: revOf("alpha local") });
  await app.flush();

  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.value(), "new document text");
  assert.equal(app.status(), status, "the old success cannot alter the new status");
  assert.equal(app.beforeUnloadBlocked(), true);
});

test("a delayed rename retry body cannot take over another document", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const retryBody = deferred();
  let calls = 0;
  app.routes["POST /api/rename"] = () => {
    calls += 1;
    if (calls === 1) return jsonResponse(conflictBody("target_exists"), 409);
    return { ok: true, status: 200, json: () => retryBody.promise };
  };

  await submitRename(app);
  assert.equal(calls, 2);
  assert.equal(app.confirmMessages.length, 1);

  app.click("actionNew");
  app.type("new document text");
  const status = app.status();

  retryBody.resolve({ success: true, path: "/docs/b.md", revision: revOf("alpha") });
  await app.flush();

  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.value(), "new document text");
  assert.equal(app.status(), status);
  assert.equal(app.renameCalls().length, 2, "no further request for the old session");
});

test("an init failure does not replace text typed while it was loading", async (t) => {
  const app = await createApp({ deferInit: true });
  t.after(() => app.close());

  app.type("typed during boot");
  app.initGate.resolve(jsonResponse({ success: false, error: "snapshot_unstable" }, 503));
  await app.flush();

  assert.equal(app.value(), "typed during boot", "the typed text is not replaced");
  assert.equal(app.status(), "⚠️ Impossibile leggere il documento attivo");
  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.beforeUnloadBlocked(), true);

  // It stays an untitled buffer: Ctrl+S asks for a name, no write to a guess.
  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 0);
  assert.equal(app.fsModalOpen(), true);
});

test("an init 200 with an invalid revision is not adopted as an open document", async (t) => {
  const app = await createApp({ deferInit: true });
  t.after(() => app.close());

  app.initGate.resolve(jsonResponse({
    token: "test-token",
    active_file: "/docs/a.md",
    active_dir: "/docs",
    default_dir: "/docs",
    recents: [],
    file_content: "alpha",
    file_revision: "not-a-revision",
    file_exists: true,
  }));
  await app.flush();

  assert.equal(app.pathLabel(), "Senza titolo", "no untrusted path is adopted");
  assert.equal(app.status(), "⚠️ Revisione del documento non valida");
  assert.equal(app.beforeUnloadBlocked(), false, "an empty welcome buffer is not dirty");

  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 0);
  assert.equal(app.fsModalOpen(), true);
});

test("an init 200 for an active file that no longer exists is not turned into a saveable buffer", async (t) => {
  const app = await createApp({ deferInit: true });
  t.after(() => app.close());

  app.initGate.resolve(jsonResponse({
    token: "test-token",
    active_file: "/docs/a.md",
    active_dir: "/docs",
    default_dir: "/docs",
    recents: [],
    file_content: "",
    file_revision: "",
    file_exists: false,
  }));
  await app.flush();

  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.status(), "⚠️ Il documento attivo non esiste piu'");

  // No automatic recreation of the known-deleted path.
  app.type("typed after the failure");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 0);
  assert.equal(app.status(), "○ Non salvato");
  assert.equal(app.beforeUnloadBlocked(), true);
});

test("a late valid init does not replace a document adopted (Save As) while it was loading", async (t) => {
  const app = await createApp({ deferInit: true });
  t.after(() => app.close());

  app.type("boot document");
  app.click("docTitleBtn");
  await app.flush();
  app.document.getElementById("fsFileNameInput").value = "new.md";
  app.click("btnFsConfirm");
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/new.md");

  app.initGate.resolve(jsonResponse({
    token: "test-token",
    active_file: "/docs/a.md",
    active_dir: "/elsewhere",
    default_dir: "/docs",
    recents: [],
    file_content: "alpha",
    file_revision: revOf("alpha"),
    file_exists: true,
  }));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/new.md", "the adopted path wins");
  assert.equal(app.title(), "new.md — Rigo");
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.value(), "boot document");
  assert.equal(app.beforeUnloadBlocked(), false);
  assert.equal(
    app.callsTo("GET", "/api/workspace").filter((c) => c.query.path === "/elsewhere").length,
    0,
    "the old active_dir is not applied as the adopted document's workspace"
  );

  app.append("!");
  app.ctrlS();
  await app.flush();
  assert.equal(app.lastSave().body.path, "/docs/new.md");
  assert.equal(app.lastSave().body.expected_revision, revOf("boot document"));
  assert.equal(app.lastSave().body.force, false);
});

test("typing during boot is kept when the init snapshot is valid, without adopting the file", async (t) => {
  const app = await createApp({ deferInit: true });
  t.after(() => app.close());

  app.type("draft typed before init");
  app.initGate.resolve(jsonResponse({
    token: "test-token",
    active_file: "/docs/a.md",
    active_dir: "/docs",
    default_dir: "/docs",
    recents: [],
    file_content: "alpha",
    file_revision: revOf("alpha"),
    file_exists: true,
  }));
  await app.flush();

  assert.equal(app.value(), "draft typed before init", "the typed text is not replaced");
  assert.equal(app.pathLabel(), "Senza titolo", "the boot file is not adopted over local typing");
  assert.equal(app.status(), "○ Non salvato");
  assert.equal(app.beforeUnloadBlocked(), true);
});
