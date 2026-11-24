// Incarico 006 — task checkboxes must be mapped to the exact Markdown marker.
//
// These tests drive the real controller, real Marked and the real sanitizer in
// jsdom. No production debug hook is used.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, revOf } = require("./harness.cjs");

function taskBoxes(app) {
  return Array.from(app.document.querySelectorAll('#previewContent input[type="checkbox"]'));
}

function render(app, text) {
  if (text !== undefined) app.setValue(text);
  app.win.livePreview.render(app.editor.value);
  return taskBoxes(app);
}

function replaceLine(text, lineIndex, from, to) {
  const lines = text.split("\n");
  assert.ok(lines[lineIndex].includes(from), `line ${lineIndex} does not match the fixture`);
  lines[lineIndex] = lines[lineIndex].replace(from, to);
  return lines.join("\n");
}

test("a prose [x] and [X] markers only toggle the task marker", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const original = "- [ ] refer to [x] in prose\n- [X] done [x]\n- [ ] plain";

  let boxes = render(app, original);
  assert.equal(boxes.length, 3);
  boxes[0].click();
  await app.flush();
  assert.equal(app.value(), replaceLine(original, 0, "[ ]", "[x]"));
  assert.equal(app.value().split("\n")[1], "- [X] done [x]");
  assert.equal(app.value().split("\n")[2], "- [ ] plain");

  boxes = render(app);
  boxes[0].click();
  await app.flush();
  assert.equal(app.value(), original);

  boxes = render(app);
  boxes[1].click();
  await app.flush();
  assert.equal(app.value(), replaceLine(original, 1, "[X]", "[ ]"));
  assert.equal(app.value().split("\n")[0], "- [ ] refer to [x] in prose");

  boxes = render(app);
  boxes[1].click();
  await app.flush();
  assert.equal(app.value(), replaceLine(original, 1, "[X] done", "[x] done"));
});

test("quoted, numbered, nested and duplicate tasks keep their own marker", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const original = [
    "- [ ] normal",
    "",
    "> - [ ] quote",
    "",
    "1. [ ] numbered",
    "",
    "- [ ] outer",
    "  - [x] nested",
    "",
    "- [ ] duplicate",
    "- [ ] duplicate",
  ].join("\n");
  const expected = [
    "- [x] normal",
    "",
    "> - [x] quote",
    "",
    "1. [x] numbered",
    "",
    "- [x] outer",
    "  - [x] nested",
    "",
    "- [ ] duplicate",
    "- [ ] duplicate",
  ].join("\n");

  const boxes = render(app, original);
  assert.equal(boxes.length, 7);
  boxes[0].click();
  await app.flush();
  assert.equal(app.value(), replaceLine(original, 0, "[ ]", "[x]"));

  render(app);
  let before = app.value();
  taskBoxes(app)[1].click();
  await app.flush();
  assert.equal(app.value(), replaceLine(before, 2, "[ ]", "[x]"));

  render(app);
  before = app.value();
  taskBoxes(app)[2].click();
  await app.flush();
  assert.equal(app.value(), replaceLine(before, 4, "[ ]", "[x]"));

  render(app);
  before = app.value();
  taskBoxes(app)[3].click();
  await app.flush();
  assert.equal(app.value(), replaceLine(before, 6, "[ ]", "[x]"));
  assert.equal(app.value().split("\n")[7], "  - [x] nested");

  render(app);
  before = app.value();
  taskBoxes(app)[4].click();
  await app.flush();
  assert.equal(app.value(), replaceLine(before, 7, "[x]", "[ ]"));

  // The first duplicate is the one that changes; the second stays untouched.
  render(app);
  before = app.value();
  taskBoxes(app)[5].click();
  await app.flush();
  assert.equal(app.value(), replaceLine(before, 9, "[ ]", "[x]"));

  render(app);
  before = app.value();
  taskBoxes(app)[6].click();
  await app.flush();
  assert.equal(app.value(), replaceLine(before, 10, "[ ]", "[x]"));

  // The whole set of independent clicks above leads to the expected text.
  render(app, expected);
  assert.equal(taskBoxes(app).length, 7);
});

test("HTML checkboxes and code examples neither edit nor shift the real tasks", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const original = [
    '<div><input type="checkbox" class="task-checkbox" checked disabled tabindex="-1"></div>',
    "",
    "`- [ ] inline`",
    "",
    "```",
    "- [ ] fenced",
    "```",
    "",
    "    - [ ] indented",
    "",
    "- [ ] real one",
    "",
    '<ul><li><input type="checkbox" class="task-checkbox" disabled></li></ul>',
    "",
    "- [ ] real two",
  ].join("\n");

  let boxes = render(app, original);
  assert.equal(boxes.length, 4, "two authored checkboxes and two real tasks");
  let inputs = 0;
  app.editor.addEventListener("input", () => inputs++);

  const before = app.value();
  boxes[0].click();
  boxes[2].click();
  await app.flush();
  assert.equal(app.value(), before, "authored HTML checkboxes must not edit the buffer");
  assert.equal(inputs, 0);
  assert.equal(app.saveCalls().length, 0);
  assert.equal(app.beforeUnloadBlocked(), false);
  assert.equal(app.value().split("\n")[5], "- [ ] fenced");
  assert.equal(app.value().split("\n")[8], "    - [ ] indented");

  boxes = render(app);
  boxes[1].click();
  await app.flush();
  assert.equal(inputs, 1);
  assert.equal(app.value(), replaceLine(original, 10, "[ ]", "[x]"));
  assert.equal(app.value().split("\n")[14], "- [ ] real two");
  assert.equal(app.value().split("\n")[0], original.split("\n")[0]);

  boxes = render(app);
  const beforeSecondReal = app.value();
  boxes[3].click();
  await app.flush();
  assert.equal(app.value(), replaceLine(beforeSecondReal, 14, "[ ]", "[x]"));
  assert.equal(app.value().split("\n")[10], "- [x] real one");
});

test("typing during the preview debounce invalidates the old node; the new render re-arms it", async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  app.setValue("- [ ] task");
  app.click("btnModeSplit");
  await app.flush();
  let boxes = taskBoxes(app);
  assert.equal(boxes.length, 1);
  const oldNode = boxes[0];
  let inputs = 0;
  app.editor.addEventListener("input", () => inputs++);

  app.append(" more");
  const changed = app.value();
  inputs = 0; // the append itself is an input; the click must add none
  oldNode.click();
  await app.flush();
  assert.equal(app.value(), changed, "a preview from before the edit must not toggle the marker");
  assert.equal(inputs, 0);
  assert.equal(app.saveCalls().length, 0);

  await app.advance(250);
  boxes = taskBoxes(app);
  assert.equal(boxes.length, 1);
  assert.notEqual(boxes[0], oldNode);
  boxes[0].click();
  await app.flush();
  assert.equal(inputs, 1);
  assert.equal(app.value(), "- [x] task more");

  await app.advance(800);
  assert.equal(app.saveCalls().length, 1);
  assert.equal(app.lastSave().body.content, "- [x] task more");
  assert.equal(app.lastSave().body.expected_revision, revOf("alpha"));
});

test("a document switch with identical text invalidates old nodes in both directions", async (t) => {
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
  const oldA = taskBoxes(app)[0];

  app.emitSse("/docs/b.md");
  await app.flush();
  await app.advance(250);
  assert.equal(app.pathLabel(), "/docs/b.md");
  const newB = taskBoxes(app)[0];
  assert.notEqual(oldA, newB);
  assert.equal(oldA.isConnected, false);

  oldA.click();
  await app.flush();
  assert.equal(app.value(), same, "an old node from A must not edit B, even with identical text");

  newB.click();
  await app.flush();
  assert.equal(app.value(), "- [x] same");

  app.emitSse("/docs/a.md");
  await app.flush();
  await app.advance(250);
  assert.equal(app.pathLabel(), "/docs/a.md");
  const newA = taskBoxes(app)[0];
  assert.notEqual(newB, newA);
  newB.click();
  await app.flush();
  assert.equal(app.value(), same, "a node from B must not edit A after switching back");
  newA.click();
  await app.flush();
  assert.equal(app.value(), "- [x] same");
});

test("read-only tasks are disabled and inert; writable tasks use one input and normal autosave", async (t) => {
  const ro = await createApp({
    files: { "/docs/a.md": { content: "- [ ] protected", mod_time: 1000, read_only: true } },
  });
  t.after(() => ro.close());
  ro.win.livePreview.render(ro.value());
  const roBox = taskBoxes(ro)[0];
  assert.ok(roBox, "the protected task is really present in the DOM");
  assert.equal(roBox.disabled, true);
  assert.equal(ro.win.livePreview.readOnly, true);
  let roInputs = 0;
  ro.editor.addEventListener("input", () => roInputs++);
  roBox.click();
  await ro.flush();
  assert.equal(ro.value(), "- [ ] protected");
  assert.equal(roInputs, 0);
  await ro.advance(900);
  assert.equal(ro.saveCalls().length, 0);

  const rw = await createApp();
  t.after(() => rw.close());
  rw.setValue("- [ ] alpha");
  rw.win.livePreview.render(rw.value());
  const box = taskBoxes(rw)[0];
  assert.equal(box.disabled, false);
  let inputs = 0;
  rw.editor.addEventListener("input", () => inputs++);
  box.click();
  await rw.flush();
  assert.equal(inputs, 1, "one normal controller input, not a direct save");
  assert.equal(rw.value(), "- [x] alpha");
  assert.equal(rw.saveCalls().length, 0, "the preview never saves directly");
  assert.equal(rw.beforeUnloadBlocked(), true);
  await rw.advance(800);
  assert.equal(rw.saveCalls().length, 1);
  assert.equal(rw.lastSave().body.path, "/docs/a.md");
  assert.equal(rw.lastSave().body.content, "- [x] alpha");
  assert.equal(rw.beforeUnloadBlocked(), false);
});
