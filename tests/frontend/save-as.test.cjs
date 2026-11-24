// Incarico 001 — Save As / rename coordination with ordinary saves.
//
// The Save As dialog is opened and submitted through the real DOM (title
// button, file name input, confirm button); the controller is unchanged.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createApp,
  deferRoute,
  jsonResponse,
  textResponse,
  conflictBody,
  revOf,
} = require("./harness.cjs");

function saveOk(path, modTime) {
  return jsonResponse({ success: true, path, mod_time: modTime });
}

async function openSaveAs(app) {
  app.click("docTitleBtn");
  await app.flush();
  assert.equal(app.fsModalOpen(), true, "the Save As dialog is open");
}

function submitSaveAs(app, name) {
  const input = app.document.getElementById("fsFileNameInput");
  input.value = name;
  input.dispatchEvent(new app.win.Event("input", { bubbles: true }));
  app.click("btnFsConfirm");
}

test("typing during Save As keeps the buffer dirty and the follow-up writes the new path", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  const saves = deferRoute(app, "POST /api/save");

  await openSaveAs(app);
  submitSaveAs(app, "a2.md");
  await app.flush();

  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.renameCalls()[0].body.old_path, "/docs/a.md");
  assert.equal(app.renameCalls()[0].body.new_path, "/docs/a2.md");
  assert.equal(app.renameCalls()[0].body.content, "alpha");

  // Type while the rename is on the wire. The autosave debounce fires, but the
  // write must wait for the rename instead of sending the old path.
  app.append("!");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 0, "no save can be sent while the rename is pending");

  renames.at(0).resolve(saveOk("/docs/a2.md", 7000));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a2.md");
  assert.equal(app.title(), "a2.md — TypeCraft");
  assert.notEqual(app.status(), "● Salvato", "text typed during the rename is not persisted yet");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.path, "/docs/a2.md", "the follow-up uses the new path");
  assert.equal(app.lastSave().body.content, "alpha!");

  saves.at(0).resolve(saveOk("/docs/a2.md", 7001));
  await app.flush();
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);
});

test("a late Save As answer cannot take possession of a new document", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  await openSaveAs(app);
  submitSaveAs(app, "a2.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);

  app.click("actionNew");
  await app.flush();
  assert.equal(app.pathLabel(), "Senza titolo");

  renames.at(0).resolve(saveOk("/docs/a2.md", 7000));
  await app.flush();

  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.title(), "Senza titolo.md — TypeCraft");
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.value(), "");
  assert.equal(app.saveCalls().length, 0);
});

test("an in-flight autosave lands before the rename and never recreates the source", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  const renames = deferRoute(app, "POST /api/rename");

  app.append("!");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);

  await openSaveAs(app);
  submitSaveAs(app, "a2.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 0, "the rename waits for the running save");

  saves.at(0).resolve(saveOk("/docs/a.md", 1111));
  await app.flush();
  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.renameCalls()[0].body.old_path, "/docs/a.md");
  assert.equal(app.renameCalls()[0].body.content, "alpha!");
  assert.equal(app.renameCalls()[0].body.expected_revision, revOf("alpha!"), "the baseline confirmed by the save");

  renames.at(0).resolve(saveOk("/docs/a2.md", 2222));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a2.md");
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.saveCalls().length, 1, "the old autosave was not replayed on the old path");

  await app.advance(2000);
  assert.equal(app.saveCalls().length, 1, "nothing recreates /docs/a.md after the rename");
});

test("duplicate Save As submissions produce a single rename", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  await openSaveAs(app);
  submitSaveAs(app, "a2.md");
  submitSaveAs(app, "a3.md");
  await app.flush();

  assert.equal(renames.count, 1, "the duplicate submit is ignored");
  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.renameCalls()[0].body.new_path, "/docs/a2.md");
});

test("an existing target asks for overwrite once and retries with the flag", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  await openSaveAs(app);
  submitSaveAs(app, "b.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);

  renames.at(0).resolve(jsonResponse(conflictBody("target_exists"), 409));
  await app.flush();

  assert.equal(app.confirmMessages.length, 1);
  assert.equal(app.renameCalls().length, 2);
  assert.equal(app.renameCalls()[1].body.overwrite, true);
  assert.equal(app.renameCalls()[1].body.new_path, "/docs/b.md");
  assert.equal(app.renameCalls()[1].body.expected_revision, revOf("alpha"), "the source baseline is not lost on the overwrite retry");

  renames.at(1).resolve(saveOk("/docs/b.md", 8000));
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/b.md");
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.fsModalOpen(), false);
});

test("declining the overwrite confirmation leaves the document unchanged", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  await openSaveAs(app);
  submitSaveAs(app, "b.md");
  await app.flush();

  app.confirmAnswers.push(false);
  renames.at(0).resolve(jsonResponse(conflictBody("target_exists"), 409));
  await app.flush();

  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), "alpha");
  assert.equal(app.status(), "● Salvato");
});

test("a failed rename keeps the source and leaves the pending edits dirty", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  await openSaveAs(app);
  submitSaveAs(app, "a2.md");
  app.append("!");
  await app.flush();

  renames.at(0).resolve(textResponse("disk full", 500));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.title(), "a.md — TypeCraft");
  assert.equal(app.alertMessages.length, 1);
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.saveCalls().length, 0);

  // The normal autosave still targets the document that is really on screen.
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.path, "/docs/a.md");
  assert.equal(app.lastSave().body.content, "alpha!");
});

test("Save As names an untitled buffer and later autosaves use the new path", async (t) => {
  const app = await createApp({ activeFile: "" });
  t.after(() => app.close());

  app.type("# hello");
  assert.equal(app.status(), "○ Non salvato");

  const renames = deferRoute(app, "POST /api/rename");
  await openSaveAs(app);
  submitSaveAs(app, "doc.md");
  await app.flush();

  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.renameCalls()[0].body.old_path, "");
  assert.equal(app.renameCalls()[0].body.content, "# hello");
  assert.equal(app.renameCalls()[0].body.expected_revision, "", "a new document has no source baseline");

  renames.at(0).resolve(jsonResponse({ success: true, path: "/docs/doc.md", mod_time: 9000 }));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/doc.md");
  assert.equal(app.title(), "doc.md — TypeCraft");
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);

  app.append("!");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.path, "/docs/doc.md");
  assert.equal(app.lastSave().body.expected_revision, revOf("# hello"), "the rename response is the new baseline");
});

test("a rename waiting in the queue is never sent for an abandoned document", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  const renames = deferRoute(app, "POST /api/rename");

  app.append("A edit");
  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 1);

  // The rename is queued behind the blocked save.
  await openSaveAs(app);
  submitSaveAs(app, "a2.md");
  await app.flush();
  assert.equal(renames.count, 0);

  // New document before the queue reaches the rename.
  app.click("actionNew");
  await app.flush();
  saves.at(0).resolve(saveOk("/docs/a.md", 1111));
  await app.flush();

  assert.equal(app.renameCalls().length, 0, "no destructive rename is sent for the old session");
  assert.equal(app.pathLabel(), "Senza titolo");
});

test("a changed source during Save As is a distinct conflict with no overwrite question", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  app.append("!");
  await openSaveAs(app);
  submitSaveAs(app, "a2.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.renameCalls()[0].body.expected_revision, revOf("alpha"));

  renames.at(0).resolve(jsonResponse(conflictBody("source_changed", revOf("alpha external")), 409));
  await app.flush();

  assert.equal(app.confirmMessages.length, 0, "the overwrite question belongs to target_exists only");
  assert.equal(app.renameCalls().length, 1, "no retry with overwrite:true");
  assert.equal(app.value(), "alpha!", "the typed text stays intact");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.status(), "⚠️ Il documento e' cambiato su disco");
  assert.equal(app.alertMessages.length, 1);
});

test("a missing source during Save As keeps the buffer and creates nothing", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  await openSaveAs(app);
  submitSaveAs(app, "a2.md");
  await app.flush();

  renames.at(0).resolve(jsonResponse(conflictBody("source_missing"), 409));
  await app.flush();

  assert.equal(app.confirmMessages.length, 0);
  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.status(), "⚠️ File sorgente rimosso su disco");
  assert.equal(app.alertMessages.length, 1);
});

test("an overwrite retry that hits a source change reports the source, not the destination", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  await openSaveAs(app);
  submitSaveAs(app, "b.md");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);

  // Destination exists: the user confirms the overwrite.
  renames.at(0).resolve(jsonResponse(conflictBody("target_exists"), 409));
  await app.flush();
  assert.equal(app.confirmMessages.length, 1);
  assert.equal(app.renameCalls().length, 2);
  assert.equal(app.renameCalls()[1].body.overwrite, true);

  // Between the two requests the source changed externally.
  renames.at(1).resolve(jsonResponse(conflictBody("source_changed", revOf("alpha external")), 409));
  await app.flush();

  assert.equal(app.renameCalls().length, 2, "no further retry");
  assert.equal(app.confirmMessages.length, 1, "no second overwrite question");
  assert.equal(app.value(), "alpha", "the buffer is not modified");
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.status(), "⚠️ Il documento e' cambiato su disco");
  assert.ok(app.alertMessages.some((m) => /cambiato su disco/i.test(m)), "the source conflict is reported as such");
});
