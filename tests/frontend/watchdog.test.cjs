// Incarico 001 — external-change watchdog vs. async document state.
//
// The watchdog polls /api/stat every 5s and may read /api/file. Its answers
// must be discarded when the document, the buffer revision or the last
// confirmed save changed while the requests were in flight.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createApp,
  deferRoute,
  jsonResponse,
  textResponse,
  revOf,
} = require("./harness.cjs");

function saveOk(path, modTime) {
  return jsonResponse({ success: true, path, mod_time: modTime });
}

test("a stat answer for the previous document is ignored after a document change", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const stats = deferRoute(app, "GET /api/stat");
  await app.advance(5000);
  assert.equal(stats.count, 1);

  // Open B while the stat request for A is still in flight.
  const files = deferRoute(app, "GET /api/file");
  app.emitSse("/docs/b.md");
  await app.flush();
  files.at(0).resolve(jsonResponse({ path: "/docs/b.md", content: "beta", mod_time: 2000 }));
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/b.md");
  const fileCalls = app.callsTo("GET", "/api/file").length;

  stats.at(0).resolve(jsonResponse({ path: "/docs/a.md", exists: true, revision: revOf("external-a"), mod_time: 9999 }));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/b.md");
  assert.equal(app.value(), "beta");
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.callsTo("GET", "/api/file").length, fileCalls, "no reload of the old path");
});

test("a stat answer that raced typing does not trigger a reload", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const stats = deferRoute(app, "GET /api/stat");
  const files = deferRoute(app, "GET /api/file");
  await app.advance(5000);
  assert.equal(stats.count, 1);

  app.append("typed");
  stats.at(0).resolve(jsonResponse({ path: "/docs/a.md", exists: true, revision: revOf("external"), mod_time: 7777 }));
  await app.flush();

  assert.equal(files.count, 0, "the stale stat answer is dropped");
  assert.equal(app.value(), "alphatyped");
  assert.equal(app.beforeUnloadBlocked(), true);
});

test("typing while the reload is in flight keeps the local text", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const stats = deferRoute(app, "GET /api/stat");
  const files = deferRoute(app, "GET /api/file");

  await app.advance(5000);
  stats.at(0).resolve(jsonResponse({ path: "/docs/a.md", exists: true, revision: revOf("external text"), mod_time: 8888 }));
  await app.flush();
  assert.equal(files.count, 1);

  app.append("typed");
  files.at(0).resolve(jsonResponse({ path: "/docs/a.md", content: "external text", mod_time: 8888 }));
  await app.flush();

  assert.equal(app.value(), "alphatyped");
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.beforeUnloadBlocked(), true);
});

test("a file reload answer cannot replace text that another save made clean", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const stats = deferRoute(app, "GET /api/stat");
  const files = deferRoute(app, "GET /api/file");
  const saves = deferRoute(app, "POST /api/save");

  await app.advance(5000);
  stats.at(0).resolve(jsonResponse({ path: "/docs/a.md", exists: true, revision: revOf("external text"), mod_time: 8888 }));
  await app.flush();
  assert.equal(files.count, 1);

  // An explicit save completes between the stat and the file answer.
  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 1);
  saves.at(0).resolve(saveOk("/docs/a.md", 9000));
  await app.flush();
  assert.equal(app.status(), "● Salvato");

  files.at(0).resolve(jsonResponse({ path: "/docs/a.md", content: "external text", mod_time: 8888 }));
  await app.flush();

  assert.equal(app.value(), "alpha", "the reload answer is dropped");
  assert.equal(app.status(), "● Salvato", "and it does not fake a reload");
  assert.equal(app.beforeUnloadBlocked(), false);
});

test("an uncontested change is still reloaded and its revision is used by the next save", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const stats = deferRoute(app, "GET /api/stat");
  const files = deferRoute(app, "GET /api/file");

  await app.advance(5000);
  stats.at(0).resolve(jsonResponse({ path: "/docs/a.md", exists: true, revision: revOf("external"), mod_time: 8888 }));
  await app.flush();
  files.at(0).resolve(jsonResponse({ path: "/docs/a.md", content: "external", mod_time: 8888 }));
  await app.flush();

  assert.equal(app.value(), "external");
  assert.equal(app.status(), "● Ricaricato dal disco");
  assert.equal(app.beforeUnloadBlocked(), false);

  app.append("!");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.content, "external!");
  assert.equal(app.lastSave().body.expected_revision, revOf("external"));
});

test("the watchdog stays quiet while this session has a write on the wire", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("x");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);

  const stats = deferRoute(app, "GET /api/stat");
  await app.advance(5000);
  assert.equal(stats.count, 0, "no stat poll races the write in flight");

  saves.at(0).resolve(saveOk("/docs/a.md", 1111));
  await app.flush();
  assert.equal(app.status(), "● Salvato");
});

async function startSaveAs(app, name) {
  app.click("docTitleBtn");
  await app.flush();
  const input = app.document.getElementById("fsFileNameInput");
  input.value = name;
  input.dispatchEvent(new app.win.Event("input", { bubbles: true }));
  app.click("btnFsConfirm");
  await app.flush();
}

test("a rename started during the stat read discards the stale snapshot", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const stats = deferRoute(app, "GET /api/stat");
  await app.advance(5000);
  assert.equal(stats.count, 1);

  // A rename is a document write: it starts while the stat is still in flight.
  const renames = deferRoute(app, "POST /api/rename");
  await startSaveAs(app, "a2.md");
  assert.equal(app.renameCalls().length, 1);

  const files = deferRoute(app, "GET /api/file");
  stats.at(0).resolve(jsonResponse({ path: "/docs/a.md", exists: true, revision: revOf("external"), mod_time: 8888 }));
  await app.flush();

  assert.equal(files.count, 0, "no reload is started while a rename is on the wire");
  assert.equal(app.value(), "alpha");

  renames.at(0).resolve(jsonResponse({ success: true, path: "/docs/a2.md", mod_time: 9000 }));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a2.md");
  assert.equal(app.value(), "alpha");
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);

  // The rename response is the new baseline, not the discarded snapshot.
  app.append("!");
  await app.advance(600);
  assert.equal(app.lastSave().body.path, "/docs/a2.md");
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));
});

test("a rename completing during the file read discards the stale snapshot", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const stats = deferRoute(app, "GET /api/stat");
  const files = deferRoute(app, "GET /api/file");

  await app.advance(5000);
  stats.at(0).resolve(jsonResponse({ path: "/docs/a.md", exists: true, revision: revOf("external snapshot"), mod_time: 8888 }));
  await app.flush();
  assert.equal(files.count, 1);

  const renames = deferRoute(app, "POST /api/rename");
  await startSaveAs(app, "a2.md");
  assert.equal(app.renameCalls().length, 1);

  // The read answers with a disk snapshot taken before the rename.
  files.at(0).resolve(jsonResponse({
    path: "/docs/a.md",
    content: "external snapshot",
    mod_time: 8888,
  }));
  await app.flush();

  assert.equal(app.value(), "alpha", "the pre-rename snapshot is not applied");
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.notEqual(app.status(), "● Ricaricato dal disco");

  renames.at(0).resolve(jsonResponse({ success: true, path: "/docs/a2.md", mod_time: 9000 }));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/a2.md");
  assert.equal(app.value(), "alpha");
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);
});

test("an external change with identical mtime and size is detected by the content revision", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const stats = deferRoute(app, "GET /api/stat");
  const files = deferRoute(app, "GET /api/file");

  await app.advance(5000);
  // Baseline metadata (mtime 1000) and the same size as "alpha" (5 bytes), but a
  // different content revision: timestamps alone would have missed this.
  stats.at(0).resolve(jsonResponse({
    path: "/docs/a.md", exists: true, revision: revOf("omega"), mod_time: 1000, size: 5,
  }));
  await app.flush();
  assert.equal(files.count, 1, "the revision change triggers a coherent re-read");

  files.at(0).resolve(jsonResponse({ path: "/docs/a.md", content: "omega", mod_time: 1000 }));
  await app.flush();

  assert.equal(app.value(), "omega");
  assert.equal(app.status(), "● Ricaricato dal disco");
  assert.equal(app.beforeUnloadBlocked(), false);
});

test("a dirty buffer is not replaced by a same-metadata external change", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.type("local text");
  await app.advance(600);
  saves.at(0).resolve(textResponse("disk full", 500));
  await app.flush();
  assert.equal(app.beforeUnloadBlocked(), true, "the buffer is still dirty");

  const stats = deferRoute(app, "GET /api/stat");
  const files = deferRoute(app, "GET /api/file");
  await app.advance(5000);
  assert.equal(stats.count, 1);

  stats.at(0).resolve(jsonResponse({
    path: "/docs/a.md", exists: true, revision: revOf("omega"), mod_time: 1000, size: 5,
  }));
  await app.flush();

  assert.equal(files.count, 0, "a dirty buffer is never replaced");
  assert.equal(app.value(), "local text");
  assert.equal(app.status(), "⚠️ Cambiato su disco");
  assert.equal(app.beforeUnloadBlocked(), true);
});

test("a rename queued behind a successful save uses the revision that save confirmed", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  const renames = deferRoute(app, "POST /api/rename");

  app.append("!");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));

  await startSaveAs(app, "a2.md");
  assert.equal(app.renameCalls().length, 0, "queued behind the save");

  // The save confirms "alpha!"; the queued rename must adopt that baseline, not
  // the pre-save revision it could have captured at request time.
  saves.at(0).resolve(saveOk("/docs/a.md", 1111));
  await app.flush();
  assert.equal(app.renameCalls().length, 1);
  assert.equal(app.renameCalls()[0].body.expected_revision, revOf("alpha!"));

  renames.at(0).resolve(jsonResponse({ success: true, path: "/docs/a2.md" }));
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/a2.md");

  app.append("?");
  await app.advance(600);
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha!"));
});

test("a file removed on disk keeps the old baseline so the next save conflicts", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const stats = deferRoute(app, "GET /api/stat");
  const files = deferRoute(app, "GET /api/file");

  await app.advance(5000);
  stats.at(0).resolve(jsonResponse({
    path: "/docs/a.md", exists: false, revision: "", mod_time: 0, size: 0,
  }));
  await app.flush();

  assert.equal(files.count, 0, "a missing file is not read");
  assert.equal(app.value(), "alpha", "the buffer is kept");
  assert.equal(app.status(), "⚠️ File rimosso su disco");

  app.append("!");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"),
    "the old baseline is kept: the save must conflict instead of recreating the file");
});
