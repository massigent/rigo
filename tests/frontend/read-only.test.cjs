// Incarico 004 — read-only document policy (backend flag + UI protection).
//
// The backend decides `read_only`; the controller must lock the editor, block
// programmatic edits and autosave, keep the text/dirty when protection appears
// during editing, and offer an explicit "save a copy" flow that never touches
// the protected source.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createApp,
  deferRoute,
  jsonResponse,
  revOf,
} = require("./harness.cjs");

function readOnlyFile(content) {
  return { content, mod_time: 1000, read_only: true };
}

async function openSaveCopy(app, name) {
  app.ctrlS();
  await app.flush();
  assert.equal(app.fsModalOpen(), true, "explicit save on a protected document opens the copy dialog");
  const title = app.document.getElementById("fsModalTitle").textContent;
  assert.match(title, /copia/i);
  app.document.getElementById("fsFileNameInput").value = name;
  app.click("btnFsConfirm");
  await app.flush();
}

test("a read-only document is locked, shows the indicator and never edits or autosaves", async (t) => {
  const app = await createApp({ files: { "/docs/a.md": readOnlyFile("alpha\n\n- [ ] task") } });
  t.after(() => app.close());

  assert.equal(app.editor.readOnly, true);
  assert.equal(app.status(), "🔒 Sola lettura");
  assert.match(app.statusKind(), /readonly/);
  assert.equal(app.beforeUnloadBlocked(), false);

  const before = app.value();

  // Formatting toolbar and shortcuts are no-ops on a protected document.
  for (const id of ["tbBold", "tbItalic", "tbH1", "tbUl", "tbTask", "tbTable"]) {
    app.click(id);
    await app.flush();
  }
  app.press({ key: "b", ctrlKey: true });
  app.press({ key: "i", ctrlKey: true });
  app.click("btnModeSplit");
  app.win.livePreview.render(app.value());
  const checkbox = app.document.querySelector("#previewContent input[type=checkbox]");
  if (checkbox) checkbox.click();
  await app.flush();

  assert.equal(app.value(), before, "no formatting/table/task edit may modify a protected document");
  assert.equal(app.fsModalOpen(), false, "the table modal is not even opened");

  // Native typing is blocked by editor.readOnly; a stray input event must not
  // arm autosave or writes either.
  app.editor.dispatchEvent(new app.win.Event("input", { bubbles: true }));
  await app.advance(600);
  assert.equal(app.saveCalls().length, 0);
  assert.equal(app.fsModalOpen(), false);
});

test("opening and New reset the read-only mode; stale stat results are ignored", async (t) => {
  const app = await createApp({ files: { "/docs/ro.md": readOnlyFile("read only\n") } });
  t.after(() => app.close());

  app.emitSse("/docs/ro.md");
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/ro.md");
  assert.equal(app.editor.readOnly, true);
  assert.equal(app.status(), "🔒 Sola lettura");

  // Reopening a normal document unlocks the editor.
  app.emitSse("/docs/b.md");
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/b.md");
  assert.equal(app.editor.readOnly, false);
  assert.notEqual(app.status(), "🔒 Sola lettura");

  // A stale read-only stat for the previous document cannot lock the new one.
  const stats = deferRoute(app, "GET /api/stat");
  await app.advance(5000);
  assert.equal(stats.count, 1);
  app.emitSse("/docs/a.md");
  await app.flush();
  stats.at(0).resolve(jsonResponse({
    path: "/docs/ro.md", exists: true, revision: revOf("read only\n"), read_only: true, mod_time: 1000,
  }));
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.editor.readOnly, false, "an old read-only answer cannot lock the current document");

  // New always starts writable.
  app.click("actionNew");
  await app.flush();
  assert.equal(app.editor.readOnly, false);
});

test("becoming read-only while dirty keeps text and dirty, cancels autosave and does not write", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const stats = deferRoute(app, "GET /api/stat");
  await app.advance(4999); // no watchdog tick yet
  app.type("edited text");
  await app.advance(1); // watchdog tick at 5000, autosave debounce not fired yet
  assert.equal(stats.count, 1);

  stats.at(0).resolve(jsonResponse({
    path: "/docs/a.md", exists: true, revision: revOf("alpha"), read_only: true, mod_time: 1000,
  }));
  await app.flush();

  assert.equal(app.editor.readOnly, true);
  assert.equal(app.value(), "edited text");
  assert.equal(app.beforeUnloadBlocked(), true, "the dirty buffer is still protected");
  assert.equal(app.status(), "🔒 Sola lettura — modifiche non salvate");
  assert.equal(app.saveCalls().length, 0);

  await app.advance(2000);
  assert.equal(app.saveCalls().length, 0, "the pending autosave was cancelled");

  // Becoming writable again re-enables editing but does not write by itself.
  await app.advance(3000); // next watchdog tick
  assert.equal(stats.count, 2);
  stats.at(1).resolve(jsonResponse({
    path: "/docs/a.md", exists: true, revision: revOf("alpha"), read_only: false, mod_time: 1000,
  }));
  await app.flush();
  assert.equal(app.editor.readOnly, false);
  assert.equal(app.saveCalls().length, 0, "a permission change alone does not save");

  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));
  assert.equal(app.lastSave().body.force, false);
});

test("a backend read-only refusal in flight keeps the text dirty and never forces", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.type("edited");
  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 1);

  saves.at(0).resolve(jsonResponse({ success: false, error: "read_only", path: "/docs/a.md" }, 403));
  await app.flush();

  assert.equal(app.confirmMessages.length, 0, "read-only is not a conflict to overwrite");
  assert.equal(app.editor.readOnly, true);
  assert.equal(app.status(), "🔒 Sola lettura — modifiche non salvate");
  assert.equal(app.value(), "edited");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.saveCalls().length, 1, "no force retry");

  await app.advance(5000);
  assert.equal(app.saveCalls().length, 1);
});

test("save a copy writes a new document without touching the protected source", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const stats = deferRoute(app, "GET /api/stat");
  const renames = deferRoute(app, "POST /api/rename");
  await app.advance(4999);
  app.type("edited text");
  await app.advance(1);
  stats.at(0).resolve(jsonResponse({
    path: "/docs/a.md", exists: true, revision: revOf("alpha"), read_only: true, mod_time: 1000,
  }));
  await app.flush();
  assert.equal(app.editor.readOnly, true);
  assert.equal(app.value(), "edited text");

  await openSaveCopy(app, "copy.md");
  assert.equal(app.renameCalls().length, 1);
  const payload = app.renameCalls()[0].body;
  assert.equal(payload.old_path, "", "a copy must not carry the source path");
  assert.equal(payload.expected_revision, "");
  assert.equal(payload.content, "edited text");
  assert.equal(payload.new_path, "/docs/copy.md");

  renames.at(0).resolve(jsonResponse({
    success: true, path: "/docs/copy.md", revision: revOf("edited text"), read_only: false,
  }));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/copy.md");
  assert.equal(app.title(), "copy.md — Rigo");
  assert.equal(app.editor.readOnly, false, "the copy is a normal writable document");
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);
  assert.equal(app.files["/docs/a.md"].content, "alpha", "the protected source is untouched");
  assert.equal(app.files["/docs/copy.md"].content, "edited text");

  app.append("!");
  await app.advance(600);
  assert.equal(app.lastSave().body.path, "/docs/copy.md");
  assert.equal(app.lastSave().body.expected_revision, revOf("edited text"));
});

test("a protected copy destination is refused and leaves the current document unchanged", async (t) => {
  const app = await createApp({
    files: { "/docs/a.md": readOnlyFile("alpha"), "/docs/b.md": readOnlyFile("beta") },
  });
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  await openSaveCopy(app, "b.md");
  assert.equal(app.renameCalls().length, 1);
  renames.at(0).resolve(jsonResponse({ success: false, error: "read_only", path: "/docs/b.md" }, 403));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.editor.readOnly, true, "the protected source stays locked");
  assert.equal(app.alertMessages.length, 1);
  assert.equal(app.files["/docs/b.md"].content, "beta", "the protected destination is untouched");
  assert.equal(app.files["/docs/a.md"].content, "alpha");
  assert.equal(app.renameCalls().length, 1, "no forced retry");
});

test("a late copy response cannot take over another document", async (t) => {
  const app = await createApp({ files: { "/docs/a.md": readOnlyFile("alpha") } });
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  await openSaveCopy(app, "copy.md");
  assert.equal(app.renameCalls().length, 1);

  app.click("actionNew");
  app.type("new document");
  const status = app.status();

  renames.at(0).resolve(jsonResponse({
    success: true, path: "/docs/copy.md", revision: revOf("alpha"), read_only: false,
  }));
  await app.flush();

  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.value(), "new document");
  assert.equal(app.status(), status);
  assert.equal(app.editor.readOnly, false);
});

test("a partial rename failure is reported honestly and keeps the source dirty", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  app.append(" draft");
  app.click("docTitleBtn");
  await app.flush();
  app.document.getElementById("fsFileNameInput").value = "b.md";
  app.click("btnFsConfirm");
  await app.flush();
  assert.equal(app.renameCalls().length, 1);

  // Destination written, source not removed: the server says so explicitly.
  renames.at(0).resolve(jsonResponse({
    success: false,
    error: "write_forbidden",
    partial: true,
    path: "/docs/b.md",
    message: "rename incomplete: destination written, source not removed",
  }, 403));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a.md", "the failed rename does not adopt the destination");
  assert.equal(app.editor.readOnly, false, "the source stays editable");
  assert.equal(app.value(), "alpha draft");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.status(), "⚠️ Rinomina incompleta — sorgente non rimosso");
  assert.doesNotMatch(app.statusKind(), /saving/);
  assert.ok(app.alertMessages.some((m) => /destinazione.*scritta|originale non e' stato rimosso/i.test(m)));
  await app.advance(2000);
  assert.equal(app.saveCalls().length, 0, "no hidden retry");
  assert.equal(app.renameCalls().length, 1);
});

test("an operational rename permission failure ends the transient saving state", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const renames = deferRoute(app, "POST /api/rename");
  app.append(" draft");
  app.click("docTitleBtn");
  await app.flush();
  app.document.getElementById("fsFileNameInput").value = "b.md";
  app.click("btnFsConfirm");
  await app.flush();

  renames.at(0).resolve(jsonResponse({ success: false, error: "write_forbidden", path: "/docs/b.md" }, 403));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), "alpha draft");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.status(), "⚠️ Scrittura non consentita");
  assert.doesNotMatch(app.statusKind(), /saving/);
  assert.equal(app.renameCalls().length, 1);
});
