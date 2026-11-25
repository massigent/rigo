// Regression: a double click must select the word under the cursor.
//
// The typewriter recentering used to run on every single click, so the smooth
// scroll moved the text between the two clicks of a word selection and the
// second click landed a line above the word. The recenter is now deferred
// after a plain click and cancelled by any new mousedown (double/triple
// click, or a click somewhere else).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("./harness.cjs");

function mouseEvent(app, type, init) {
  const event = new app.win.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true }, init));
  app.editor.dispatchEvent(event);
}

async function withRecenterSpy(t) {
  const app = await createApp({ activeFile: "/docs/a.md" });
  t.after(() => app.close());
  const calls = [];
  const engine = app.win.typewriter;
  const original = engine.centerCaret.bind(engine);
  engine.centerCaret = (smooth) => {
    calls.push(smooth);
    return original(smooth);
  };
  return { app, calls };
}

test("a plain click recenters the caret only after the double-click window", async (t) => {
  const { app, calls } = await withRecenterSpy(t);

  mouseEvent(app, "click", { detail: 1 });
  assert.equal(calls.length, 0, "the recenter must not be immediate: the second click of a double click is still coming");

  await app.advance(299);
  assert.equal(calls.length, 0, "still pending while the window is open");

  await app.advance(2);
  assert.equal(calls.length, 1, "the deferred recenter fires once the window has closed");
  assert.equal(calls[0], true, "it is the smooth (click-style) recenter");
});

test("a double click never moves the text under the cursor", async (t) => {
  const { app, calls } = await withRecenterSpy(t);

  // First click of the sequence: only schedules the deferred recenter.
  mouseEvent(app, "click", { detail: 1 });
  assert.equal(calls.length, 0);

  // Second click within the window: the mousedown cancels the pending
  // recenter, the click itself is a selection (detail > 1) and schedules
  // nothing, and the dblclick clears the timer again.
  mouseEvent(app, "mousedown", { detail: 2 });
  mouseEvent(app, "click", { detail: 2 });
  mouseEvent(app, "dblclick", { detail: 2 });

  await app.advance(1000);
  assert.equal(calls.length, 0, "no recenter during or after a word selection");
});

test("a slow double click is safe too: the mousedown alone cancels the pending recenter", async (t) => {
  const { app, calls } = await withRecenterSpy(t);

  // First click of a slow double click (gap beyond the deferral window).
  mouseEvent(app, "click", { detail: 1 });
  mouseEvent(app, "mousedown", { detail: 2 }); // second press arrives late
  await app.advance(1000);
  assert.equal(calls.length, 0, "the mousedown cancelled the pending recenter");
});

test("after a selection, a new plain click still recenters", async (t) => {
  const { app, calls } = await withRecenterSpy(t);

  // Complete a double-click sequence first.
  mouseEvent(app, "mousedown", { detail: 1 });
  mouseEvent(app, "click", { detail: 1 });
  mouseEvent(app, "mousedown", { detail: 2 });
  mouseEvent(app, "click", { detail: 2 });
  mouseEvent(app, "dblclick", { detail: 2 });
  await app.advance(1000);
  assert.equal(calls.length, 0);

  // The next plain click is an ordinary caret move and recenters as before.
  mouseEvent(app, "click", { detail: 1 });
  await app.advance(300);
  assert.equal(calls.length, 1, "single clicks keep the typewriter behaviour");
});
