// Incarico 001 — document session safety.
//
// Every test drives the real controller (web/static/js/app.js) through the
// real page markup: DOM events in, recorded API calls out. Fetch answers are
// deferred explicitly and window timers are fake, so no test sleeps.

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

test("typing during a save keeps the buffer dirty and persists the newest text afterwards", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");

  app.append("!");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1, "the autosave debounce issues one request");
  assert.equal(app.lastSave().body.content, "alpha!");
  assert.equal(saves.count, 1);

  // Type while the request is in flight; the debounce fires before the answer.
  app.append("?");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1, "saves are coalesced, not sent concurrently");

  saves.at(0).resolve(saveOk("/docs/a.md", 1111));
  await app.flush();

  assert.notEqual(app.status(), "● Salvato", "the old answer cannot claim the new text is saved");
  assert.equal(app.beforeUnloadBlocked(), true, "beforeunload still protects the unsaved text");
  assert.equal(app.saveCalls().length, 2, "exactly one follow-up pass for the newest buffer");
  assert.equal(app.lastSave().body.content, "alpha!?");

  saves.at(1).resolve(saveOk("/docs/a.md", 1112));
  await app.flush();

  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);
  assert.equal(app.saveCalls().length, 2);
});

test("a late answer does not clean text typed after the request and no duplicate is sent", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");

  app.append("!");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);

  // The answer arrives before the debounce of the next edit fires.
  app.append("?");
  saves.at(0).resolve(saveOk("/docs/a.md", 1111));
  await app.flush();

  assert.equal(app.status(), "○ Modificato");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.saveCalls().length, 1);

  await app.advance(600);
  assert.equal(app.saveCalls().length, 2);
  assert.equal(app.lastSave().body.content, "alpha!?");

  saves.at(1).resolve(saveOk("/docs/a.md", 1112));
  await app.flush();
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);
});

test("the answer of A after New leaves the new buffer unnamed and never writes A", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");

  app.append("A-edit");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.path, "/docs/a.md");

  app.click("actionNew");
  await app.flush();
  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.title(), "Senza titolo.md — Rigo");

  saves.at(0).resolve(saveOk("/docs/a.md", 1234));
  await app.flush();

  assert.equal(app.pathLabel(), "Senza titolo", "the old answer must not restore the old path");
  assert.equal(app.title(), "Senza titolo.md — Rigo");

  // Typing in the new buffer is dirty, but nothing is written to A.
  app.append("new text");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1, "an untitled buffer never autosaves");
  assert.equal(app.status(), "○ Non salvato");
  assert.equal(app.beforeUnloadBlocked(), true);

  // An explicit save asks for a name instead of writing to the old path.
  app.click("actionSave");
  await app.flush();
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.fsModalOpen(), true, "Ctrl+S on an untitled buffer asks for a name");
  assert.equal(app.pathLabel(), "Senza titolo");
});

test("a late error of A after New cannot change the new document's status", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");

  app.append("A-edit");
  await app.advance(600);
  app.click("actionNew");
  await app.flush();

  app.append("new text");
  saves.at(0).resolve(textResponse("internal error", 500));
  await app.flush();

  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.status(), "○ Non salvato", "the stale error must not overwrite the new status");
  assert.equal(app.beforeUnloadBlocked(), true);
});

test("the answer of A after opening B does not alter B", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("A-edit");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);

  // Open B over the real SSE channel. The buffer is dirty, so confirm() asks.
  const files = deferRoute(app, "GET /api/file");
  app.emitSse("/docs/b.md");
  await app.flush();
  assert.equal(files.count, 1);
  files.at(0).resolve(jsonResponse({
    path: "/docs/b.md",
    content: "beta",
    mod_time: 2000,
    read_only: false,
  }));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/b.md");
  assert.equal(app.value(), "beta");

  // The old save of A answers after B was adopted.
  saves.at(0).resolve(saveOk("/docs/a.md", 9999));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/b.md");
  assert.equal(app.title(), "b.md — Rigo");
  assert.equal(app.value(), "beta");
  assert.equal(app.status(), "● Salvato");

  // The next save carries B's path and B's revision, not A's late answer.
  app.append("!");
  await app.advance(600);
  assert.equal(app.lastSave().body.path, "/docs/b.md");
  assert.equal(app.lastSave().body.expected_revision, revOf("beta"));
  assert.ok(!app.lastSave().body.force);
});

test("two opens resolved in reverse order: the newest accepted open wins", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const files = deferRoute(app, "GET /api/file");
  app.emitSse("/docs/b.md");
  await app.flush();
  app.emitSse("/docs/c.md");
  await app.flush();
  assert.equal(files.count, 2);

  // C (requested last) answers first.
  files.at(1).resolve(jsonResponse({ path: "/docs/c.md", content: "gamma", mod_time: 3000 }));
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/c.md");
  assert.equal(app.value(), "gamma");

  // The older B answer arrives late and is dropped.
  files.at(0).resolve(jsonResponse({ path: "/docs/b.md", content: "beta", mod_time: 2000 }));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/c.md");
  assert.equal(app.title(), "c.md — Rigo");
  assert.equal(app.value(), "gamma");
});

test("typing while a file is loading is not lost silently", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const files = deferRoute(app, "GET /api/file");
  app.emitSse("/docs/b.md");
  await app.flush();

  app.append(" local");
  assert.equal(app.beforeUnloadBlocked(), true);

  const confirmsBefore = app.confirmMessages.length;
  app.confirmAnswers.push(false);
  files.at(0).resolve(jsonResponse({ path: "/docs/b.md", content: "beta", mod_time: 2000 }));
  await app.flush();

  assert.equal(app.confirmMessages.length, confirmsBefore + 1, "the race is confirmed again");
  assert.equal(app.pathLabel(), "/docs/a.md", "the open is cancelled");
  assert.equal(app.value(), "alpha local");
  assert.equal(app.beforeUnloadBlocked(), true);

  // With explicit consent the file is opened and the typed text is dropped.
  app.confirmAnswers.push(true, true);
  app.emitSse("/docs/b.md");
  await app.flush();
  files.at(1).resolve(jsonResponse({ path: "/docs/b.md", content: "beta", mod_time: 2000 }));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/b.md");
  assert.equal(app.value(), "beta");
  assert.equal(app.beforeUnloadBlocked(), false);
});

test("pending autosave is invalidated by a document change and reopening the same path starts a new session", async (t) => {
  const app = await createApp({ recents: ["/docs/a.md"] });
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("!"); // debounce pending, nothing sent yet

  const files = deferRoute(app, "GET /api/file");
  app.document.querySelector("#recentsList li").click(); // reopen the same file
  await app.flush();
  assert.equal(files.count, 1);
  files.at(0).resolve(jsonResponse({ path: "/docs/a.md", content: "alpha", mod_time: 4000 }));
  await app.flush();

  await app.advance(600);
  assert.equal(app.saveCalls().length, 0, "the old debounced save must not run");
  assert.equal(app.status(), "● Salvato");

  // The new session uses the revision of the reopened document.
  app.append("!");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));
});

test("a save of the previous session cannot stamp its mtime on a reopened document", async (t) => {
  const app = await createApp({ recents: ["/docs/a.md"] });
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("old");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);

  const files = deferRoute(app, "GET /api/file");
  app.document.querySelector("#recentsList li").click(); // same path, new session
  await app.flush();
  files.at(0).resolve(jsonResponse({ path: "/docs/a.md", content: "disk", mod_time: 4000 }));
  await app.flush();

  saves.at(0).resolve(saveOk("/docs/a.md", 1111));
  await app.flush();

  assert.equal(app.value(), "disk");
  assert.equal(app.status(), "● Salvato");

  app.append("new");
  await app.advance(600);
  assert.equal(app.lastSave().body.expected_revision, revOf("disk"), "the stale save baseline was not applied");
});

test("repeated save requests are coalesced into one follow-up and never overlap", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("1");
  app.ctrlS();
  app.ctrlS();
  app.ctrlS();
  await app.flush();

  assert.equal(app.saveCalls().length, 1, "only one write on the wire");
  assert.equal(app.lastSave().body.content, "alpha1");

  saves.at(0).resolve(saveOk("/docs/a.md", 1111));
  await app.flush();
  assert.equal(app.saveCalls().length, 2, "exactly one coalesced follow-up");

  saves.at(1).resolve(saveOk("/docs/a.md", 1112));
  await app.flush();
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.saveCalls().length, 2);

  await app.advance(5000);
  assert.equal(app.saveCalls().length, 2, "no further write without new input");
});

test("a network error leaves the buffer dirty and does not retry on its own", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("x");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);

  saves.at(0).reject(new Error("offline"));
  await app.flush();

  assert.equal(app.status(), "⚠️ Connessione persa");
  assert.equal(app.beforeUnloadBlocked(), true);

  await app.advance(5000);
  assert.equal(app.saveCalls().length, 1, "autosave does not loop on errors");
});

test("an autosave conflict is reported without a dialog and without retries", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("x");
  await app.advance(600);

  saves.at(0).resolve(jsonResponse(conflictBody("revision_mismatch", revOf("disk")), 409));
  await app.flush();

  assert.equal(app.status(), "⚠️ Modificato su disco");
  assert.equal(app.confirmMessages.length, 0, "autosave never blocks on a modal");
  assert.equal(app.beforeUnloadBlocked(), true);

  await app.advance(5000);
  assert.equal(app.saveCalls().length, 1, "an untouched conflict is not retried in a loop");
});

test("an explicit save conflict asks once and retries only with user consent", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("x");
  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));
  assert.ok(!app.lastSave().body.force);

  saves.at(0).resolve(jsonResponse(conflictBody("revision_mismatch", revOf("disk")), 409));
  await app.flush();

  assert.equal(app.confirmMessages.length, 1);
  assert.equal(app.saveCalls().length, 2);
  assert.equal(app.lastSave().body.force, true, "the authorised retry is an explicit one-shot force");

  saves.at(1).resolve(saveOk("/docs/a.md", 6000));
  await app.flush();
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);
  assert.equal(app.saveCalls().length, 2);
});

test("declining the conflict confirmation keeps the buffer dirty and sends nothing else", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("x");
  app.ctrlS();
  await app.flush();

  app.confirmAnswers.push(false);
  saves.at(0).resolve(jsonResponse(conflictBody("revision_mismatch"), 409));
  await app.flush();

  assert.equal(app.status(), "⚠️ Modificato su disco — ricarica");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.saveCalls().length, 1);

  await app.advance(5000);
  assert.equal(app.saveCalls().length, 1);
});

test("an untitled buffer never autosaves, opens no dialog, and SSE still opens files", async (t) => {
  const app = await createApp({ activeFile: "" });
  t.after(() => app.close());

  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.title(), "Senza titolo.md — Rigo");

  app.append("x");
  assert.equal(app.status(), "○ Non salvato");
  assert.equal(app.fsModalOpen(), false);
  assert.equal(app.confirmMessages.length, 0);

  await app.advance(2000);
  assert.equal(app.saveCalls().length, 0);
  assert.equal(app.fsModalOpen(), false, "no 'Save as' dialog is popped by the timer");
  assert.equal(app.beforeUnloadBlocked(), true);

  // Local edits + a forwarded file: the user is asked first.
  const files = deferRoute(app, "GET /api/file");
  app.confirmAnswers.push(false);
  app.emitSse("/docs/b.md");
  await app.flush();
  assert.equal(files.count, 0, "no request without consent");
  assert.equal(app.value().endsWith("x"), true);

  app.confirmAnswers.push(true);
  app.emitSse("/docs/b.md");
  await app.flush();
  assert.equal(files.count, 1);
  files.at(0).resolve(jsonResponse({ path: "/docs/b.md", content: "beta", mod_time: 2000 }));
  await app.flush();

  assert.equal(app.pathLabel(), "/docs/b.md");
  assert.equal(app.value(), "beta");
  assert.equal(app.beforeUnloadBlocked(), false);
});

test("a failed follow-up keeps the newest text dirty and does not retry", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("!");
  await app.advance(600);
  app.append("?");
  await app.advance(600);

  saves.at(0).resolve(saveOk("/docs/a.md", 1111));
  await app.flush();
  assert.equal(app.saveCalls().length, 2);
  assert.equal(app.lastSave().body.content, "alpha!?");

  saves.at(1).resolve(textResponse("disk full", 500));
  await app.flush();

  assert.equal(app.status(), "⚠️ Errore salvataggio");
  assert.equal(app.beforeUnloadBlocked(), true, "the newest text is not persisted");
  assert.equal(app.saveCalls().length, 2);

  await app.advance(5000);
  assert.equal(app.saveCalls().length, 2, "no uncontrolled retry");
});

test("the authorized overwrite is kept and used by exactly one request", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("edit");
  app.ctrlS();
  await app.flush();
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));

  saves.at(0).resolve(jsonResponse(conflictBody("revision_mismatch"), 409));
  await app.flush();
  assert.equal(app.confirmMessages.length, 1);
  assert.equal(app.saveCalls().length, 2);
  assert.equal(app.lastSave().body.force, true, "the single overwrite is an explicit force");

  // A second conflict must stop: no second confirmation, no third request.
  saves.at(1).resolve(jsonResponse(conflictBody("revision_mismatch"), 409));
  await app.flush();
  assert.equal(app.confirmMessages.length, 1);
  assert.equal(app.saveCalls().length, 2);
  assert.equal(app.status(), "⚠️ Modificato su disco — ricarica");
  assert.equal(app.beforeUnloadBlocked(), true);
});

test("a failed authorized overwrite keeps the mtime baseline for the next save", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("edit");
  app.ctrlS();
  await app.flush();
  saves.at(0).resolve(jsonResponse(conflictBody("revision_mismatch"), 409));
  await app.flush();
  assert.equal(app.lastSave().body.force, true);

  saves.at(1).resolve(textResponse("disk full", 500));
  await app.flush();
  assert.equal(app.status(), "⚠️ Errore salvataggio");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.saveCalls().length, 2);

  // The baseline survived: the next autosave uses it again and is not forced.
  app.append(" again");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 3);
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));
  assert.ok(!app.lastSave().body.force);
});

test("a network error on the authorized overwrite also preserves the baseline", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("edit");
  app.ctrlS();
  await app.flush();
  saves.at(0).resolve(jsonResponse(conflictBody("revision_mismatch"), 409));
  await app.flush();
  saves.at(1).reject(new Error("offline"));
  await app.flush();

  assert.equal(app.status(), "⚠️ Connessione persa");
  assert.equal(app.beforeUnloadBlocked(), true);

  app.append(" online again");
  await app.advance(600);
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));
  assert.ok(!app.lastSave().body.force);

  saves.at(2).resolve(saveOk("/docs/a.md", 6000));
  await app.flush();
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);
});

test("typing during the authorized overwrite is persisted afterwards with the new mtime", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.append("edit");
  app.ctrlS();
  await app.flush();
  saves.at(0).resolve(jsonResponse(conflictBody("revision_mismatch"), 409));
  await app.flush();
  assert.equal(app.lastSave().body.force, true);

  // Type while the authorized request is on the wire.
  app.append(" more");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 2, "coalesced behind the authorized request");

  saves.at(1).resolve(saveOk("/docs/a.md", 6100));
  await app.flush();
  assert.equal(app.saveCalls().length, 3);
  assert.equal(app.lastSave().body.content, "alphaedit more");
  assert.equal(app.lastSave().body.expected_revision, revOf("alphaedit"), "the baseline confirmed by the forced write");
  assert.ok(!app.lastSave().body.force);

  saves.at(2).resolve(saveOk("/docs/a.md", 6200));
  await app.flush();
  assert.equal(app.status(), "● Salvato");
  assert.equal(app.beforeUnloadBlocked(), false);
});

test("a save waiting in the queue is never sent for an abandoned document", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");

  // A save of A is on the wire (blocked).
  app.append("A edit");
  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 1);

  // Open B, edit and save it: this write is queued behind A.
  app.emitSse("/docs/b.md");
  await app.flush();
  app.append("B edit");
  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 1);

  // Leave B (New) before its queued write starts.
  app.click("actionNew");
  await app.flush();
  saves.at(0).resolve(saveOk("/docs/a.md", 1111));
  await app.flush();

  assert.equal(app.saveCalls().length, 1, "the queued B write was cancelled, not just ignored");
  assert.equal(app.pathLabel(), "Senza titolo");
  assert.equal(app.status(), "● Salvato");
});

test("a slow /api/init does not discard text typed while it loads", async (t) => {
  const app = await createApp({ deferInit: true });
  t.after(() => app.close());

  assert.equal(app.pathLabel(), "Senza titolo");

  app.type("typed before init");
  assert.equal(app.status(), "○ Non salvato");

  app.initGate.resolve(jsonResponse({
    token: "test-token",
    active_file: "/docs/a.md",
    active_dir: "/docs",
    default_dir: "/docs",
    recents: [],
    file_content: "alpha",
  }));
  await app.flush();

  assert.equal(app.value(), "typed before init", "the late init answer must not replace the buffer");
  assert.equal(app.pathLabel(), "Senza titolo", "and it must not adopt the file path");
  assert.equal(app.title(), "Senza titolo.md — Rigo");
  assert.equal(app.beforeUnloadBlocked(), true);

  await app.advance(600);
  assert.equal(app.saveCalls().length, 0, "an untitled buffer never autosaves");
});

test("the initial baseline comes from the /api/init snapshot, not from a later stat", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  // A follow-up stat on the old buffer could pair old text with a newer
  // revision; the controller no longer asks for one at boot.
  assert.equal(app.callsTo("GET", "/api/stat").length, 0, "no boot stat re-baselines the buffer");
  assert.equal(app.status(), "● Salvato");

  app.append("!");
  await app.advance(600);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));
  assert.ok(!app.lastSave().body.force, "a normal save is never forced");
});

test("a protocol error (428/400) leaves the buffer dirty with an explicit status and no retry", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");

  // 428 revision_required: never turned into a forced save.
  app.append("!");
  app.ctrlS();
  await app.flush();
  saves.at(0).resolve(jsonResponse({ success: false, error: "revision_required" }, 428));
  await app.flush();
  assert.equal(app.status(), "⚠️ Revisione mancante — riapri il file");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.saveCalls().length, 1);
  assert.ok(!app.lastSave().body.force);

  // 400 invalid_revision: same, no fallback and no retry.
  app.append("?");
  app.ctrlS();
  await app.flush();
  saves.at(1).resolve(jsonResponse({ success: false, error: "invalid_revision" }, 400));
  await app.flush();
  assert.equal(app.status(), "⚠️ Revisione non valida");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.saveCalls().length, 2);

  await app.advance(5000);
  assert.equal(app.saveCalls().length, 2, "protocol errors are not retried automatically");
});

test("a save conflict for a deleted file does not offer the overwrite question", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const saves = deferRoute(app, "POST /api/save");
  app.type("changed");
  app.ctrlS();
  await app.flush();
  assert.equal(app.saveCalls().length, 1);

  saves.at(0).resolve(jsonResponse(conflictBody("file_missing"), 409));
  await app.flush();

  assert.equal(app.confirmMessages.length, 0, "a deleted file cannot be overwritten");
  assert.equal(app.status(), "⚠️ File rimosso su disco");
  assert.equal(app.beforeUnloadBlocked(), true);
  assert.equal(app.saveCalls().length, 1, "no forced retry");
});
