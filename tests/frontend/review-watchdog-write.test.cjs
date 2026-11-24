// Independent review: a disk snapshot must not be adopted across a write,
// even when that write starts without changing the buffer revision.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, deferRoute, deferred, jsonResponse, textResponse, conflictBody, revOf } = require("./harness.cjs");

for (const phase of ["stat", "file"]) {
  test(`REVIEW: delayed watchdog ${phase} cannot make a forced save falsely clean`, async (t) => {
    const app = await createApp();
    t.after(() => app.close());
    const stats = deferRoute(app, "GET /api/stat");
    const files = deferRoute(app, "GET /api/file");
    const forceResponse = deferred();

    // The external file really changed. Its stat/read describe a disk snapshot
    // taken before the user's subsequent authorized overwrite.
    app.files["/docs/a.md"] = { content: "external snapshot", mod_time: 8888 };
    const oldStat = jsonResponse({ path: "/docs/a.md", exists: true, revision: revOf("external snapshot"), mod_time: 8888 });
    const oldFile = jsonResponse({ path: "/docs/a.md", content: "external snapshot", revision: revOf("external snapshot"), mod_time: 8888 });
    await app.advance(5000);
    assert.equal(stats.count, 1);
    if (phase === "file") {
      stats.at(0).resolve(oldStat);
      await app.flush();
      assert.equal(files.count, 1);
    }

    let writes = 0;
    app.routes["POST /api/save"] = (call) => {
      writes += 1;
      if (writes === 1) {
        assert.equal(call.body.expected_revision, revOf("alpha"));
        assert.equal(call.body.force, false);
        return jsonResponse(conflictBody("revision_mismatch"), 409);
      }
      assert.equal(writes, 2, "no extra writes in this scenario");
      assert.equal(call.body.force, true, "the overwrite consent is a one-shot force");
      assert.equal(call.body.expected_revision, revOf("alpha"));
      // The server has persisted the authorized text, but the response has not
      // reached the UI yet. This does not require a backend protocol change.
      app.files[call.body.path] = { content: call.body.content, mod_time: 9000 };
      return forceResponse.promise;
    };
    app.ctrlS(); // Saving a clean buffer does not increment its revision.
    await app.flush();
    assert.equal(writes, 2);
    assert.equal(app.files["/docs/a.md"].content, "alpha");

    if (phase === "stat") {
      stats.at(0).resolve(oldStat);
      await app.flush();
      // If the controller incorrectly starts a read, deliver the stale snapshot
      // as well, so the final consistency assertion exercises the entire race.
      if (files.count) {
        files.at(0).resolve(oldFile);
        await app.flush();
      }
    } else {
      files.at(0).resolve(oldFile);
      await app.flush();
    }

    forceResponse.resolve(jsonResponse({ success: true, path: "/docs/a.md", revision: revOf("alpha"), mod_time: 9000 }));
    await app.flush();
    assert.equal(app.value(), app.files["/docs/a.md"].content,
      "a clean/saved buffer must match the text the server actually persisted");
    assert.equal(app.value(), "alpha", "the pre-write disk snapshot must be discarded");
    assert.equal(app.status(), "● Salvato");
    assert.equal(app.beforeUnloadBlocked(), false);
    assert.equal(writes, 2);
    // A mismatched snapshot must not be stamped with the new mtime, which would
    // hide the divergence permanently from subsequent watchdog polls.
    if (phase === "stat") assert.equal(files.count, 0, "stale stat must not start a reload");
  });
}
