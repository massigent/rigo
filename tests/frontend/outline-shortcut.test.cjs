// Task 008 — documented shortcut regression: Ctrl/Cmd+Shift+O must open (or
// select, or close) the Outline and never open the file dialog, while plain
// Ctrl/Cmd+O still opens the file dialog and Save/Save As are unchanged.
//
// The shortcuts are driven through the real editor keydown path (harness
// press()), exactly as a user's keystrokes reach handleShortcuts().

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("./harness.cjs");

function outlineVisible(app) {
  const doc = app.document;
  return (
    !doc.getElementById("sideDrawer").classList.contains("collapsed") &&
    doc.getElementById("panelOutline").classList.contains("active")
  );
}

test("Ctrl+Shift+O opens the Outline, not the file dialog", async () => {
  const app = await createApp();
  try {
    assert.equal(app.drawerOpen(), false, "drawer starts collapsed");
    const ev = app.press({ key: "o", code: "KeyO", ctrlKey: true, shiftKey: true });
    assert.equal(ev.defaultPrevented, true, "the shortcut must be consumed");
    assert.equal(outlineVisible(app), true, "drawer open with the Outline tab active");
    assert.equal(app.fsModalOpen(), false, "the file dialog must never open");
    assert.equal(app.callsTo("GET", "/api/fs").length, 0, "no filesystem browsing started");
  } finally {
    await app.close();
  }
});

test("Ctrl+Shift+O closes the Outline when it is already open and selected", async () => {
  const app = await createApp();
  try {
    app.press({ key: "o", code: "KeyO", ctrlKey: true, shiftKey: true });
    assert.equal(outlineVisible(app), true);
    const ev = app.press({ key: "o", code: "KeyO", ctrlKey: true, shiftKey: true });
    assert.equal(ev.defaultPrevented, true);
    assert.equal(app.drawerOpen(), false, "second press closes the drawer");
    assert.equal(app.fsModalOpen(), false);
  } finally {
    await app.close();
  }
});

test("Ctrl+Shift+O selects the Outline when the drawer is open on another tab", async () => {
  const app = await createApp();
  try {
    app.press({ key: "o", code: "KeyO", ctrlKey: true, shiftKey: true });
    app.click("tabFiles");
    assert.equal(app.document.getElementById("panelFiles").classList.contains("active"), true);
    app.press({ key: "o", code: "KeyO", ctrlKey: true, shiftKey: true });
    assert.equal(outlineVisible(app), true, "Outline tab is selected");
    assert.equal(app.drawerOpen(), true, "drawer stays open");
    await app.flush();
  } finally {
    await app.close();
  }
});

test("plain Ctrl+O still opens the file dialog and leaves the drawer alone", async () => {
  const app = await createApp();
  try {
    const ev = app.press({ key: "o", code: "KeyO", ctrlKey: true });
    assert.equal(ev.defaultPrevented, true);
    assert.equal(app.fsModalOpen(), true, "file dialog opens");
    assert.equal(app.drawerOpen(), false, "the Outline was not touched");
    await app.flush();
    app.click("btnFsCancel");
    assert.equal(app.fsModalOpen(), false);
  } finally {
    await app.close();
  }
});

test("Cmd+Shift+O opens the Outline on macOS keyboard settings", async () => {
  const app = await createApp();
  try {
    Object.defineProperty(app.win.navigator, "platform", { value: "MacIntel" });
    const event = app.press({ key: "O", code: "KeyO", metaKey: true, shiftKey: true });
    assert.equal(event.defaultPrevented, true);
    assert.equal(app.fsModalOpen(), false);
    assert.equal(outlineVisible(app), true);
  } finally {
    await app.close();
  }
});

test("Save and Save As shortcuts are unchanged", async () => {
  const app = await createApp();
  try {
    app.append("edited");
    const save = app.press({ key: "s", code: "KeyS", ctrlKey: true });
    assert.equal(save.defaultPrevented, true);
    await app.advance(700);
    assert.equal(app.saveCalls().length, 1, "Ctrl+S saves");

    assert.equal(app.fsModalOpen(), false, "plain Ctrl+S does not open Save As");

    const saveAs = app.press({ key: "s", code: "KeyS", ctrlKey: true, shiftKey: true });
    assert.equal(saveAs.defaultPrevented, true);
    assert.equal(app.fsModalOpen(), true, "Ctrl+Shift+S opens Save As");
    await app.flush();
    app.click("btnFsCancel");
  } finally {
    await app.close();
  }
});
