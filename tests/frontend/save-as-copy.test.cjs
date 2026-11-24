// Incarico 005 — Save As is a copy; rename/move is explicit.
//
// The copy flow sends old_path:"" plus an explicit source_path, keeps the source
// untouched, adopts the destination only on a valid confirmation, and refuses a
// destination that aliases the source. The title click stays an explicit
// rename/move with the 003/004 source-revision/read-only/partial rules.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createApp,
  deferRoute,
  deferred,
  jsonResponse,
  conflictBody,
  revOf,
} = require("./harness.cjs");

function ctrlShiftS(app) {
  return app.press({ key: "S", code: "KeyS", ctrlKey: true, shiftKey: true });
}

function submit(app, name) {
  const input = app.document.getElementById("fsFileNameInput");
  input.value = name;
  input.dispatchEvent(new app.win.Event("input", { bubbles: true }));
  app.click("btnFsConfirm");
}

function saveOk(path, revision) {
  return jsonResponse({ success: true, path, revision, read_only: false });
}

test("Ctrl+Shift+S saves a copy of the dirty buffer and keeps the source", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  app.append(" draft");
  ctrlShiftS(app);
  await app.flush();

  assert.equal(app.fsModalOpen(), true);
  assert.match(app.document.getElementById("fsModalTitle").textContent, /salva con nome/i);
  assert.match(app.document.getElementById("btnFsConfirm").textContent, /salva con nome/i);
  assert.equal(app.saveCalls().length, 0, "Save As must not trigger a plain save");

  submit(app, "copy.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);
  const payload = app.renameCalls()[0].body;
  assert.equal(payload.old_path, "", "a copy does not carry the source as old_path");
  assert.equal(payload.source_path, "/docs/a.md", "the copy declares its source explicitly");
  assert.equal(payload.expected_revision, "", "a copy needs no source baseline");
  assert.equal(payload.content, "alpha draft", "the copy writes the buffer, not a re-read");

  renames.at(0).resolve(saveOk("/docs/copy.md", revOf("alpha draft")));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/copy.md");
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);
  assert.equal(app.files["/docs/a.md"].content, "alpha", "the source document is untouched");
  assert.equal(app.files["/docs/copy.md"].content, "alpha draft");

  // Later edits go to the copy only.
  app.append("!");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.path, "/docs/copy.md");
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha draft"));
});

test("Ctrl+S still saves the current document instead of opening a dialog", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  app.append(" draft");
  app.ctrlS();
  await app.flush();

  assert.equal(app.fsModalOpen(), false);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.path, "/docs/a.md");
});

test("the title click is an explicit rename that moves the source on full success", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  app.click("docTitleBtn");
  await app.flush();
  assert.match(app.document.getElementById("fsModalTitle").textContent, /rinomina|sposta/i);
  assert.match(app.document.getElementById("btnFsConfirm").textContent, /rinomina/i);

  submit(app, "a2.md");
  await app.flush();
  const payload = app.renameCalls()[0].body;
  assert.equal(payload.old_path, "/docs/a.md");
  assert.equal(payload.source_path, undefined, "a rename is not a copy");
  assert.equal(payload.expected_revision, revOf("alpha"));

  renames.at(0).resolve(saveOk("/docs/a2.md", revOf("alpha")));
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/a2.md");
  assert.equal(app.files["/docs/a.md"], undefined, "a successful rename removes the source");
  assert.equal(app.files["/docs/a2.md"].content, "alpha");
});

test("the menu Save As is a copy, not a rename", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  app.click("actionSaveAs");
  await app.flush();
  assert.match(app.document.getElementById("fsModalTitle").textContent, /salva con nome/i);
  submit(app, "copy.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.renameCalls()[0].body.old_path, "");
  assert.equal(app.renameCalls()[0].body.source_path, "/docs/a.md");
});

test("a copy onto the source path is refused clearly without any effect", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  app.append(" draft");
  ctrlShiftS(app);
  await app.flush();
  submit(app, "a.md");
  await app.flush();

  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.confirmMessages.length, 0, "same-path is not an overwrite consent");
  assert.equal(app.status(), "⚠️ Destinazione uguale al documento originale");
  assert.doesNotMatch(app.statusKind(), /saving/);
  assert.doesNotMatch(app.status(), /salvataggio/i);
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), "alpha draft");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.files["/docs/a.md"].content, "alpha", "the source is untouched");

  await app.advance(2000);
  assert.equal(app.renameCalls().length, 1, "no silent fallback to save/rename");
});

test("declining the destination overwrite keeps both files and ends the saving state", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  app.append(" draft");
  ctrlShiftS(app);
  await app.flush();
  submit(app, "b.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);

  app.confirmAnswers.push(false);
  renames.at(0).resolve(jsonResponse(conflictBody("target_exists"), 409));
  await app.flush();

  assert.equal(app.renameCalls().length, 1, "cancelling does not retry");
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), "alpha draft");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.files["/docs/a.md"].content, "alpha", "the source is not removed");
  assert.equal(app.files["/docs/b.md"].content, "beta", "the destination is untouched");
  assert.doesNotMatch(app.status(), /salvataggio/i, "the transient saving indicator ends");
  assert.doesNotMatch(app.statusKind(), /saving/);
});

test("a copy queued behind a running save waits and never touches the source", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  const renames = deferRoute(app, "POST /api/rename");
  app.append(" draft");
  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 1);

  ctrlShiftS(app);
  await app.flush();
  submit(app, "copy.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 0, "the copy waits for the save in flight");

  saves.at(0).resolve(saveOk("/docs/a.md", revOf("alpha draft")));
  await app.flush();
  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.renameCalls()[0].body.old_path, "");
  assert.equal(app.renameCalls()[0].body.source_path, "/docs/a.md");
  assert.equal(app.renameCalls()[0].body.content, "alpha draft");

  renames.at(0).resolve(saveOk("/docs/copy.md", revOf("alpha draft")));
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/copy.md");
  assert.equal(app.files["/docs/a.md"].content, "alpha draft", "the source keeps its own save");
});

test("edits made while the copy is in flight are saved to the copy, not the source", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  app.append(" draft");
  ctrlShiftS(app);
  await app.flush();
  submit(app, "copy.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);

  app.append(" more"); // typed while the copy request is in flight

  renames.at(0).resolve(saveOk("/docs/copy.md", revOf("alpha draft")));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/copy.md");
  // The follow-up of the copy writes the newest buffer to the new path; once it
  // is confirmed the document is clean again.
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.path, "/docs/copy.md");
  assert.equal(app.lastSave().body.content, "alpha draft more");
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha draft"));
  assert.equal(app.lastSave().body.force, false);
  assert.equal(app.saveCalls().filter((c) => c.body.path === "/docs/a.md").length, 0,
    "no write is sent to the old source path");
  assert.equal(app.files["/docs/a.md"].content, "alpha", "the source is never touched by the copy");
  assert.equal(app.beforeUnloadBlocked(), false);
});

test("a partial copy failure is disclosed and never adopts the destination", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  app.append(" draft");
  ctrlShiftS(app);
  await app.flush();
  submit(app, "copy.md");
  await app.flush();

  renames.at(0).resolve(jsonResponse({
    success: false,
    error: "write_failed",
    partial: true,
    path: "/docs/copy.md",
    message: "rename incomplete: destination written, source not removed: I/O error",
  }, 500));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), "alpha draft");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.status(), "⚠️ Rinomina incompleta — sorgente non rimosso");
  assert.doesNotMatch(app.statusKind(), /saving/);
  assert.ok(app.alertMessages.some((m) => /destination written, source not removed/.test(m)));
  await app.advance(2000);
  assert.equal(app.renameCalls().length, 1, "no retry/rollback");
});

test("edits during a partial copy failure are not flushed to the source and a new edit re-arms autosave", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  app.append(" draft");
  app.click("actionSaveAs");
  await app.flush();
  submit(app, "copy.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);

  app.append(" more"); // new debounce created while the copy is pending
  renames.at(0).resolve(jsonResponse({
    success: false,
    error: "write_failed",
    partial: true,
    path: "/docs/copy.md",
    message: "rename incomplete: destination written, source not removed: I/O error",
  }, 500));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), "alpha draft more");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.status(), "⚠️ Rinomina incompleta — sorgente non rimosso");
  await app.advance(2000);
  assert.equal(app.saveCalls().length, 0, "the pending edit is not written to the source");
  assert.equal(app.files["/docs/a.md"].content, "alpha", "the source is untouched");

  // The cleanup is not a permanent autosave disable: a new edit saves normally.
  app.append(" again");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.path, "/docs/a.md");
  assert.equal(app.lastSave().body.content, "alpha draft more again");
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));

  // The operation is not retried automatically.
  assert.equal(app.renameCalls().length, 1);
});

test("a late copy success after New cannot take over the new document", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  ctrlShiftS(app);
  await app.flush();
  submit(app, "copy.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);

  app.click("actionNew");
  app.type("new document");
  const status = app.status();

  renames.at(0).resolve(saveOk("/docs/copy.md", revOf("alpha")));
  await app.flush();

  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.value(), "new document");
  assert.equal(app.status(), status);
  assert.equal(app.beforeUnloadBlocked(), true);
});

test("a copy network error cancels the pending edit autosave; a new edit or Ctrl+S works again", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  app.append(" draft");
  app.click("actionSaveAs");
  await app.flush();
  submit(app, "copy.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);

  app.append(" more"); // new debounce created while the copy is pending
  renames.at(0).reject(new Error("offline"));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), "alpha draft more");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.doesNotMatch(app.status(), /salvataggio/i);
  assert.equal(app.files["/docs/a.md"].content, "alpha", "the source is untouched");
  await app.advance(2000);
  assert.equal(app.saveCalls().length, 0, "the pending edit is not written to the source");

  // An explicit save of the current document still works.
  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.path, "/docs/a.md");
  assert.equal(app.lastSave().body.content, "alpha draft more");
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));

  // A new edit re-arms normal autosave.
  app.append(" again");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 2);
  assert.equal(app.lastSave().body.path, "/docs/a.md");
  assert.equal(app.lastSave().body.content, "alpha draft more again");
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha draft more"));
});

test("a malformed 200 copy is a protocol error and does not flush edits to the source", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  // Raw route (not deferRoute): the harness must not fill the missing revision,
  // this test needs the malformed success exactly as the server could send it.
  const body = deferred();
  app.routes["POST /api/rename"] = () => ({ ok: true, status: 200, json: () => body.promise });
  app.append(" draft");
  app.click("actionSaveAs");
  await app.flush();
  submit(app, "copy.md");
  await app.flush();

  app.append(" more");
  body.resolve({ success: true, path: "/docs/copy.md" });
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), "alpha draft more");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.status(), "⚠️ Risposta del server non valida");
  await app.advance(2000);
  assert.equal(app.saveCalls().length, 0);
  assert.equal(app.files["/docs/a.md"].content, "alpha");
});

test("a late copy failure does not cancel the new document's own autosave", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  app.click("actionSaveAs");
  await app.flush();
  submit(app, "copy.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);

  const files = deferRoute(app, "GET /api/file");
  app.emitSse("/docs/b.md");
  await app.flush();
  files.at(0).resolve(jsonResponse({ path: "/docs/b.md", content: "beta", mod_time: 2000 }));
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/b.md");

  app.append(" edit");
  renames.at(0).reject(new Error("old copy failed"));
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/b.md");
  assert.equal(app.value(), "beta edit");
  assert.equal(app.beforeUnloadBlocked(), true);

  await app.advance(600);
  assert.equal(app.saveCalls().length, 1, "the new document keeps its own debounce");
  assert.equal(app.lastSave().body.path, "/docs/b.md");
  assert.equal(app.lastSave().body.content, "beta edit");
});
