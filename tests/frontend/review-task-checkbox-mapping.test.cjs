// Review 006 — independent checks for the Markdown task-checkbox mapping.
//
// These tests are written by the reviewer. They drive the real controller, the
// real Marked build, the real sanitizer and the real page in jsdom, and they
// assert the *whole* buffer, so a shifted association (even by one character)
// is detectable. No production debug hook is used and no production file is
// changed by this suite.
//
// Contract clauses covered:
//  1. Every interactive task checkbox changes exactly the marker character of
//     its own source task, in both directions, including `[X]`, `[x]` in the
//     same line text, duplicates and quoted/numbered/nested lists.
//  2. HTML checkboxes written in the document (even with the preview's public
//     classes/attributes) and task-like markers in prose, inline/fenced/
//     indented code cannot edit the buffer nor move the real association.
//  3. A click during the preview debounce, on a detached node, or after a
//     document switch with identical text changes nothing; the current render
//     re-arms the valid tasks.
//  4. A programmatic event cannot edit a read-only document; a valid click
//     emits exactly one `input` and follows the controller's dirty/beforeunload/
//     autosave flow; an ignored click emits nothing, leaves the document clean
//     and starts no write.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, revOf } = require("./harness.cjs");

function boxes(app) {
  return Array.from(app.document.querySelectorAll('#previewContent input[type="checkbox"]'));
}

function render(app, text) {
  app.setValue(text);
  app.win.livePreview.render(app.editor.value);
  return boxes(app);
}

function lines(text) {
  return text.split("\n");
}

// The absolute index of the first differing character, or -1.
function firstDiff(a, b) {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

// Assert that `after` differs from `before` in exactly one character, that the
// character is at `abs` and carries `next`, and that every other byte is equal.
function assertSingleMarkerChange(before, after, abs, next, message) {
  assert.equal(after.length, before.length, `${message}: buffer length must not change`);
  assert.equal(firstDiff(before, after), abs + 1, `${message}: only the marker state at ${abs + 1} may change`);
  assert.equal(before[abs], "[", `${message}: expected a marker opening bracket at ${abs}`);
  assert.equal(before[abs + 2], "]", `${message}: expected a marker closing bracket at ${abs + 2}`);
  assert.equal(after[abs + 1], next, `${message}: unexpected marker state`);
  assert.equal(after.slice(0, abs + 1), before.slice(0, abs + 1), `${message}: prefix changed`);
  assert.equal(after.slice(abs + 2), before.slice(abs + 2), `${message}: suffix changed`);
}

// Absolute offset of the first `[ ]`/`[x]`/`[X]` sequence of a line.
function markerOfLine(text, lineIndex, occurrence = 1) {
  let offset = 0;
  const ls = lines(text);
  for (let i = 0; i < lineIndex; i++) offset += ls[i].length + 1;
  const re = /\[[ xX]\]/g;
  const line = ls[lineIndex];
  let match;
  let seen = 0;
  while ((match = re.exec(line))) {
    seen++;
    if (seen === occurrence) return offset + match.index;
  }
  return -1;
}

// Click a checkbox of a *fresh* render of `text` and return the whole buffer.
async function clickFresh(app, text, index) {
  const list = render(app, text);
  assert.ok(list[index], `checkbox ${index} missing`);
  list[index].click();
  await app.flush();
  return app.value();
}

function countInputs(app) {
  const counter = { n: 0 };
  const handler = () => counter.n++;
  app.editor.addEventListener("input", handler);
  return {
    get value() { return counter.n; },
    reset() { counter.n = 0; },
    stop() { app.editor.removeEventListener("input", handler); },
  };
}

// ---------------------------------------------------------------------------
// 1. Exact marker mapping in both directions.
// ---------------------------------------------------------------------------

test("review: every checkbox toggles only its own marker, in both directions", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const base = [
    "- [ ] alpha [x] note",
    "- [X] beta [X] note",
    "1. [ ] gamma",
    "2. [x] delta",
    "- [ ] dup [ ] prose",
    "- [ ] dup [ ] prose",
  ].join("\n");

  // DOM order follows source order; each expectation is a full buffer literal.
  const expected = {
    0: ["- [x] alpha [x] note", "- [X] beta [X] note", "1. [ ] gamma", "2. [x] delta", "- [ ] dup [ ] prose", "- [ ] dup [ ] prose"].join("\n"),
    1: ["- [ ] alpha [x] note", "- [ ] beta [X] note", "1. [ ] gamma", "2. [x] delta", "- [ ] dup [ ] prose", "- [ ] dup [ ] prose"].join("\n"),
    2: ["- [ ] alpha [x] note", "- [X] beta [X] note", "1. [x] gamma", "2. [x] delta", "- [ ] dup [ ] prose", "- [ ] dup [ ] prose"].join("\n"),
    3: ["- [ ] alpha [x] note", "- [X] beta [X] note", "1. [ ] gamma", "2. [ ] delta", "- [ ] dup [ ] prose", "- [ ] dup [ ] prose"].join("\n"),
    4: ["- [ ] alpha [x] note", "- [X] beta [X] note", "1. [ ] gamma", "2. [x] delta", "- [x] dup [ ] prose", "- [ ] dup [ ] prose"].join("\n"),
    5: ["- [ ] alpha [x] note", "- [X] beta [X] note", "1. [ ] gamma", "2. [x] delta", "- [ ] dup [ ] prose", "- [x] dup [ ] prose"].join("\n"),
  };

  assert.equal(render(app, base).length, 6, "six real tasks expected");

  for (const index of [0, 1, 2, 3, 4, 5]) {
    const inputs = countInputs(app);
    const after = await clickFresh(app, base, index);
    inputs.stop();
    assert.equal(after, expected[index], `click ${index} must change exactly its marker`);
    assert.equal(inputs.value, 1, `click ${index} must emit exactly one input`);
  }

  // Reverse direction: the changed state is toggled back. The only acceptable
  // difference from the original is that an uppercase [X] comes back as [x]:
  // the contract only fixes the state character, not its case.
  const lowerX = base.replace("- [X] beta", "- [x] beta");
  for (const index of [0, 1, 2, 3, 4, 5]) {
    const forward = expected[index];
    const after = await clickFresh(app, forward, index);
    const reverseTarget = index === 1 ? lowerX : base;
    assert.equal(after, reverseTarget, `reverse click ${index} must toggle the marker back`);
  }
});

test("review: quoted, indented, numbered and continuation lines keep their marker", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  // Combination not covered by the delivered suite: blockquote + continuation
  // line with a prose [x] + nested task inside the quote + numbered task with a
  // nested bullet task.
  const base = [
    "> - [ ] quoted outer",
    ">   continuation [x] here",
    ">   - [X] quoted nested",
    ">     nested note [ ]",
    "",
    "1. [ ] numbered one",
    "   - [ ] nested number",
    "2. [x] numbered two",
  ].join("\n");

  const list = render(app, base);
  assert.equal(list.length, 5, "five real tasks expected");

  const expected = [
    ["> - [x] quoted outer", ">   continuation [x] here", ">   - [X] quoted nested", ">     nested note [ ]", "", "1. [ ] numbered one", "   - [ ] nested number", "2. [x] numbered two"].join("\n"),
    ["> - [ ] quoted outer", ">   continuation [x] here", ">   - [ ] quoted nested", ">     nested note [ ]", "", "1. [ ] numbered one", "   - [ ] nested number", "2. [x] numbered two"].join("\n"),
    ["> - [ ] quoted outer", ">   continuation [x] here", ">   - [X] quoted nested", ">     nested note [ ]", "", "1. [x] numbered one", "   - [ ] nested number", "2. [x] numbered two"].join("\n"),
    ["> - [ ] quoted outer", ">   continuation [x] here", ">   - [X] quoted nested", ">     nested note [ ]", "", "1. [ ] numbered one", "   - [x] nested number", "2. [x] numbered two"].join("\n"),
    ["> - [ ] quoted outer", ">   continuation [x] here", ">   - [X] quoted nested", ">     nested note [ ]", "", "1. [ ] numbered one", "   - [ ] nested number", "2. [ ] numbered two"].join("\n"),
  ];

  const lowerX = base.replace("[X] quoted nested", "[x] quoted nested");
  for (let index = 0; index < 5; index++) {
    const after = await clickFresh(app, base, index);
    assert.equal(after, expected[index], `click ${index} must change only its own marker`);
    // Reverse direction (uppercase [X] returns as lowercase [x]).
    const reverseTarget = index === 1 ? lowerX : base;
    assert.equal(await clickFresh(app, expected[index], index), reverseTarget, `reverse click ${index} must toggle the marker back`);
  }
});

// ---------------------------------------------------------------------------
// 2. Authored HTML, prose and code cannot edit nor shift the association.
// ---------------------------------------------------------------------------

test("review: authored checkboxes and code examples cannot edit or shift real tasks", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const base = [
    '<div class="task-checkbox"><input type="checkbox" class="task-checkbox" title="authored" checked disabled tabindex="-1"></div>',
    "",
    "<label>prose</label> [x] here and `- [ ] inline code`",
    "",
    "```md",
    "- [ ] fenced code",
    "- [x] fenced code too",
    "```",
    "",
    "    - [ ] indented code",
    "",
    "> - [ ] quoted real [x]",
    ">   continuation [ ] line",
    "> <input type=\"checkbox\" class=\"task-checkbox\" title=\"authored\" tabindex=\"-1\">",
    "",
    "- [ ] real before",
    "",
    "<input type=\"checkbox\" class=\"task-checkbox\" title=\"authored\" checked>",
    "",
    "- [ ] real after",
  ].join("\n");

  const list = render(app, base);
  // Three authored checkboxes (div, quote paragraph, bare HTML block) and three
  // real tasks. Prose/code markers never create a checkbox in the preview.
  assert.equal(list.length, 6, "three authored checkboxes and three real tasks");

  const authored = [];
  const real = [];
  list.forEach((box, index) => {
    // `title` is kept by the sanitizer and is only a test marker here: the
    // authored inputs already carry the preview's public class/state/attrs.
    if (box.getAttribute("title") === "authored") authored.push(index);
    else real.push(index);
  });
  assert.deepEqual(authored, [0, 2, 4], "three authored checkboxes");
  assert.deepEqual(real, [1, 3, 5], "three real tasks");

  const inputs = countInputs(app);
  for (const index of authored) {
    const before = app.value();
    const fresh = render(app, base);
    fresh[index].click();
    await app.flush();
    assert.equal(app.value(), before, `authored checkbox ${index} must not edit the buffer`);
    assert.equal(inputs.value, 0, `authored checkbox ${index} must not emit input`);
    assert.equal(app.saveCalls().length, 0, `authored checkbox ${index} must not write`);
    assert.equal(app.beforeUnloadBlocked(), false, `authored checkbox ${index} must not dirty the document`);
    assert.equal(lines(app.value())[5], "- [ ] fenced code");
    assert.equal(lines(app.value())[9], "    - [ ] indented code");
    assert.equal(lines(app.value())[15], "- [ ] real before");
  }
  inputs.stop();

  // Each real task keeps its own marker: the three real tasks are lines 11, 15
  // and 19 of the source.
  const realLines = [11, 15, 19];
  for (let k = 0; k < real.length; k++) {
    const index = real[k];
    const after = await clickFresh(app, base, index);
    const abs = markerOfLine(base, realLines[k]);
    assert.ok(abs >= 0, `line ${realLines[k]} must hold the real marker`);
    assertSingleMarkerChange(base, after, abs, "x", `real task ${name(index)}`);
    assert.equal(lines(after)[5], "- [ ] fenced code", "fenced code must stay untouched");
    assert.equal(lines(after)[9], "    - [ ] indented code", "indented code must stay untouched");
    assert.equal(lines(after)[12], ">   continuation [ ] line", "quote continuation must stay untouched");
  }
});

function name(index) {
  return "index " + index;
}

test("review: a lazy continuation under a nested list never edits the wrong marker", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  // CommonMark: " c" is a lazy continuation of the nested item. Marked renders
  // both tasks; the engine may fail closed on this shape (documented policy:
  // when the token cannot be located it edits nothing). The safety property is
  // that a click either does nothing or toggles exactly its own marker.
  const base = ["1. [ ] a", "   - [ ] b", " c"].join("\n");
  const first = ["1. [x] a", "   - [ ] b", " c"].join("\n");
  const second = ["1. [ ] a", "   - [x] b", " c"].join("\n");

  const list = render(app, base);
  assert.equal(list.length, 2, "Marked renders both nested tasks");

  const allowed = [first, second];
  for (let index = 0; index < 2; index++) {
    const after = await clickFresh(app, base, index);
    assert.ok(after === base || after === allowed[index],
      `checkbox ${index} must either stay inert or toggle exactly its own marker (got ${JSON.stringify(after)})`);
    if (after !== base) {
      assertSingleMarkerChange(base, after, markerOfLine(base, index === 0 ? 0 : 1), "x", `nested task ${index}`);
    }
    assert.equal(lines(after)[2], " c", "the lazy continuation line must never change");
  }
});

test("review: a shifted-but-valid-looking HTML checkbox cannot hijack a real task", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  // Authored inputs carry an `id` (kept by the sanitizer) and the preview's
  // public class; the real mapping lives outside classes/ids, so the real tasks
  // stay on their own markers and the authored inputs stay inert.
  const base = [
    '- [ ] first <input type="checkbox" id="tc-task-0" class="task-checkbox" tabindex="-1">',
    "",
    '<input type="checkbox" id="tc-task-1" class="task-checkbox" checked tabindex="-1">',
    "",
    "- [ ] second",
  ].join("\n");

  const list = render(app, base);
  assert.equal(list.length, 4, "two real tasks plus one authored input inside a task item and one bare authored input");

  const inputs = countInputs(app);
  const authored = [1, 2]; // the input inside the first item and the bare one
  for (const index of authored) {
    render(app, base)[index].click();
    await app.flush();
    assert.equal(app.value(), base, `authored input ${index} must be inert`);
  }
  assert.equal(inputs.value, 0);
  inputs.stop();

  assert.equal(await clickFresh(app, base, 0), [
    '- [x] first <input type="checkbox" id="tc-task-0" class="task-checkbox" tabindex="-1">',
    "",
    '<input type="checkbox" id="tc-task-1" class="task-checkbox" checked tabindex="-1">',
    "",
    "- [ ] second",
  ].join("\n"), "the real first task keeps its marker");

  const afterSecond = await clickFresh(app, base, 3);
  assert.equal(afterSecond, [
    '- [ ] first <input type="checkbox" id="tc-task-0" class="task-checkbox" tabindex="-1">',
    "",
    '<input type="checkbox" id="tc-task-1" class="task-checkbox" checked tabindex="-1">',
    "",
    "- [x] second",
  ].join("\n"), "the authored inputs do not shift the second real task");
});

// ---------------------------------------------------------------------------
// 3. Stale preview, detached node, document switch with identical text.
// ---------------------------------------------------------------------------

test("review: a same-length edit during the preview debounce invalidates the old node", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  app.setValue("- [ ] alpha beta");
  app.click("btnModeSplit");
  await app.flush();
  const oldBox = boxes(app)[0];
  assert.ok(oldBox);

  // Edit elsewhere on the line: same length, same marker, different text. The
  // stale association must fail on the text snapshot, not on an offset guess.
  app.type("- [ ] alpha zeta");
  const changed = app.value();
  const dirtyFromTyping = app.beforeUnloadBlocked();
  const inputs = countInputs(app);
  oldBox.click();
  await app.flush();
  assert.equal(app.value(), changed, "the old node must not toggle the edited buffer");
  assert.equal(inputs.value, 0, "an ignored stale click emits no input");
  assert.equal(app.saveCalls().length, 0, "an ignored stale click must not write");
  // The document was already dirty because of the typing; the click adds no
  // further dirtiness (the beforeunload answer is unchanged).
  assert.equal(app.beforeUnloadBlocked(), dirtyFromTyping);
  inputs.stop();

  // After the current render the valid task works again and autosaves normally.
  await app.advance(250);
  const fresh = boxes(app);
  assert.equal(fresh.length, 1);
  assert.notEqual(fresh[0], oldBox);
  const okInputs = countInputs(app);
  fresh[0].click();
  await app.flush();
  assert.equal(okInputs.value, 1);
  assert.equal(app.value(), "- [x] alpha zeta");
  okInputs.stop();
  assert.equal(app.beforeUnloadBlocked(), true);
  await app.advance(800);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.content, "- [x] alpha zeta");
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));
  assert.equal(app.beforeUnloadBlocked(), false);

  // A buffer replaced without the controller's input handler (clean document,
  // stale preview): the click is ignored and nothing becomes dirty.
  app.setValue("- [ ] other text");
  const cleanInputs = countInputs(app);
  const current = boxes(app)[0];
  current.click();
  await app.flush();
  assert.equal(app.value(), "- [ ] other text", "a clean but stale preview must not toggle");
  assert.equal(cleanInputs.value, 0);
  assert.equal(app.beforeUnloadBlocked(), false, "the ignored click must not dirty a clean document");
  assert.equal(app.saveCalls().length, 1, "no extra write");
  cleanInputs.stop();
});

test("review: clicks on detached task nodes change nothing", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const base = "- [ ] attached\n- [ ] other";
  let list = render(app, base);
  const detached = list[0];
  detached.remove();
  const inputs = countInputs(app);
  detached.click();
  await app.flush();
  assert.equal(app.value(), base, "a node removed from the preview must not edit the buffer");
  assert.equal(inputs.value, 0);
  assert.equal(app.saveCalls().length, 0);
  assert.equal(app.beforeUnloadBlocked(), false);
  inputs.stop();

  // The render that owns the node is still current: the remaining task works.
  list = boxes(app);
  assert.equal(list.length, 1);
  list[0].click();
  await app.flush();
  assert.equal(app.value(), "- [ ] attached\n- [x] other");
});

test("review: a document switch with identical text invalidates old nodes before and after the switch", async (t) => {
  const same = "- [ ] same";
  const app = await createApp({
    files: {
      "/docs/a.md": { content: same, mod_time: 1000 },
      "/docs/b.md": { content: same, mod_time: 2000 },
    },
  });
  t.after(() => app.close());

  app.click("btnModeSplit");
  await app.flush();
  const oldA = boxes(app)[0];

  app.emitSse("/docs/b.md");
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/b.md");
  // The controller re-renders synchronously when it adopts the document, so the
  // stale node is already detached at this point (before any debounce).
  assert.equal(oldA.isConnected, false, "the adopted document must replace the preview nodes");

  const inputs = countInputs(app);
  oldA.click();
  await app.flush();
  assert.equal(app.value(), same, "the old node from A must not edit the identical text of B");
  assert.equal(inputs.value, 0);
  assert.equal(app.beforeUnloadBlocked(), false);
  inputs.stop();

  const newB = boxes(app)[0];
  assert.notEqual(newB, oldA);
  newB.click();
  await app.flush();
  assert.equal(app.value(), "- [x] same");

  // Back to A: the node that produced the edited B preview must be dead too.
  app.emitSse("/docs/a.md");
  await app.flush();
  assert.equal(app.pathLabel(), "/docs/a.md");
  assert.equal(app.value(), same, "A is reloaded from disk");
  const newA = boxes(app)[0];
  assert.notEqual(newA, newB);
  const backInputs = countInputs(app);
  newB.click();
  await app.flush();
  assert.equal(app.value(), same, "the B node must not edit A");
  assert.equal(backInputs.value, 0);
  assert.equal(app.beforeUnloadBlocked(), false, "the stale click must not dirty A");
  backInputs.stop();
  newA.click();
  await app.flush();
  assert.equal(app.value(), "- [x] same", "the current A node works after the render");
});

// ---------------------------------------------------------------------------
// 4. Read-only programmatic events, one input, dirty flow, ignored clicks.
// ---------------------------------------------------------------------------

test("review: a programmatic event cannot edit a read-only document", async (t) => {
  const ro = await createApp({
    files: { "/docs/a.md": { content: "- [ ] protected\n- [x] done", mod_time: 1000, read_only: true } },
  });
  t.after(() => ro.close());

  ro.click("btnModeSplit");
  await ro.flush();
  const list = boxes(ro);
  assert.equal(list.length, 2, "the protected tasks are really rendered");
  assert.equal(ro.win.livePreview.readOnly, true);
  list.forEach((box) => assert.equal(box.disabled, true, "protected checkboxes are not editable"));

  const inputs = countInputs(ro);
  for (const box of list) {
    const event = new ro.win.MouseEvent("click", { bubbles: true, cancelable: true });
    box.dispatchEvent(event);
    await ro.flush();
  }
  assert.equal(ro.value(), "- [ ] protected\n- [x] done", "no programmatic event may edit a protected buffer");
  assert.equal(inputs.value, 0);
  assert.equal(ro.beforeUnloadBlocked(), false);
  await ro.advance(1200);
  assert.equal(ro.saveCalls().length, 0, "no write may be attempted for a protected document");
  assert.equal(ro.callsTo("POST", "/api/save").length, 0);
  inputs.stop();
});

test("review: a valid click is one input and the normal dirty/autosave flow", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  app.setValue("- [ ] alpha");
  app.click("btnModeSplit");
  await app.flush();
  const box = boxes(app)[0];
  assert.equal(box.disabled, false);

  const inputs = countInputs(app);
  const savesBefore = app.saveCalls().length;
  box.click();
  await app.flush();
  assert.equal(app.value(), "- [x] alpha");
  assert.equal(inputs.value, 1, "exactly one normal input event");
  assert.equal(app.saveCalls().length, savesBefore, "the preview never saves directly");
  assert.equal(app.beforeUnloadBlocked(), true, "the normal dirty flag is set");
  assert.match(app.statusKind(), /saving/, "the autosave timer is armed by the controller");

  await app.advance(700);
  assert.equal(app.saveCalls().length, savesBefore + 1, "exactly one autosave");
  const save = app.lastSave();
  assert.equal(save.body.path, "/docs/a.md");
  assert.equal(save.body.content, "- [x] alpha");
  assert.equal(save.body.expected_revision, revOf("alpha"));
  assert.equal(app.beforeUnloadBlocked(), false);
  inputs.stop();
});

test("review: an ignored click leaves the document clean and writes nothing", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const base = [
    '<input type="checkbox" class="task-checkbox" checked>',
    "",
    "- [ ] real",
  ].join("\n");

  app.setValue(base);
  app.click("btnModeSplit");
  await app.flush();
  const statusBefore = app.status();
  const kindBefore = app.statusKind();
  const list = boxes(app);
  assert.equal(list.length, 2);

  const inputs = countInputs(app);
  list[0].click();
  await app.flush();
  assert.equal(app.value(), base);
  assert.equal(inputs.value, 0);
  assert.equal(app.status(), statusBefore, "status must not change");
  assert.equal(app.statusKind(), kindBefore);
  assert.equal(app.beforeUnloadBlocked(), false, "the document must not become dirty");
  await app.advance(1200);
  assert.equal(app.saveCalls().length, 0, "no write is scheduled");
  inputs.stop();
});
