// Shared jsdom harness for the TypeCraft frontend tests.
//
// It loads the *real* page (web/index.html) and every real script of the page,
// then drives the controller through DOM events only: there are no debug hooks
// in the production code. Network calls are replaced by a controllable fetch
// double whose responses can be deferred, and window timers are fake so the
// debounced autosave and the watchdog run deterministically.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const FakeTimers = require("@sinonjs/fake-timers");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const INDEX_HTML = path.join(REPO_ROOT, "web", "index.html");
const JS_DIR = path.join(REPO_ROOT, "web", "static", "js");

// Same order as the <script> tags in web/index.html, app.js last.
const SCRIPTS = [
  "marked.min",
  "sanitize",
  "audio",
  "typewriter",
  "focusdim",
  "livepreview",
  "outline",
  "app",
];

const ORIGIN = "http://127.0.0.1:8765";

// Opaque disk revision used by the backend: sha256 over the file bytes. The
// fixture derives it from the content, so tests never compare numbers.
function revOf(content) {
  return "sha256:" + crypto.createHash("sha256").update(String(content == null ? "" : content), "utf8").digest("hex");
}

function validRev(rev) {
  return /^sha256:[0-9a-f]{64}$/.test(String(rev || ""));
}

function conflictBody(conflict, revision) {
  const body = { success: false, error: "conflict", conflict };
  if (revision) body.revision = revision;
  return body;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function textResponse(text, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = Object.create(null);
    this.onerror = null;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, handler) {
    (this.listeners[type] || (this.listeners[type] = [])).push(handler);
  }

  emit(type, payload) {
    const event = { type, data: JSON.stringify(payload) };
    (this.listeners[type] || []).forEach((handler) => handler(event));
  }

  close() {}
}
FakeEventSource.instances = [];

/**
 * Create a fresh application instance.
 *
 * @param {object} [options]
 * @param {string} [options.activeFile] active file returned by /api/init
 * @param {Record<string, {content: string, mod_time: number}>} [options.files]
 * @param {string[]} [options.recents]
 */
async function createApp(options = {}) {
  const files = Object.assign(
    {
      "/docs/a.md": { content: "alpha", mod_time: 1000 },
      "/docs/b.md": { content: "beta", mod_time: 2000 },
      "/docs/c.md": { content: "gamma", mod_time: 3000 },
    },
    options.files || {}
  );
  const activeFile = "activeFile" in options ? options.activeFile : "/docs/a.md";
  // With `deferInit` the test keeps /api/init pending to simulate a slow boot.
  const initGate = options.deferInit ? deferred() : null;

  FakeEventSource.instances = [];

  const dom = new JSDOM(fs.readFileSync(INDEX_HTML, "utf8"), {
    url: ORIGIN + "/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const win = dom.window;

  // Deterministic animation frames: the typewriter engine is not under test
  // here and jsdom has no layout, so callbacks are never run.
  win.requestAnimationFrame = () => 0;
  win.cancelAnimationFrame = () => {};
  win.HTMLElement.prototype.scrollTo = function scrollTo() {};

  const clock = FakeTimers.withGlobal(win).install({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    now: 1700000000000,
  });

  const app = {
    dom,
    win,
    clock,
    document: win.document,
    editor: win.document.getElementById("editor"),
    calls: [],
    confirmMessages: [],
    alertMessages: [],
    confirmAnswers: [],
    routes: Object.create(null),
    nextModTime: 5000,
    files,
    initGate,

    // --- fetch double -----------------------------------------------------
    fetch(url, opts = {}) {
      const parsed = new URL(String(url), ORIGIN);
      const call = {
        method: opts.method || "GET",
        path: parsed.pathname,
        query: Object.fromEntries(parsed.searchParams),
        body: opts.body ? JSON.parse(opts.body) : null,
        url: String(url),
      };
      app.calls.push(call);
      const key = call.method + " " + call.path;
      const handler = app.routes[key] || app.routes[call.path];
      if (!handler) return Promise.reject(new Error("unrouted fetch " + key));
      return Promise.resolve().then(() => handler(call, app));
    },

    // --- assertions helpers ----------------------------------------------
    callsTo(method, path) {
      return app.calls.filter((c) => c.method === method && c.path === path);
    },
    saveCalls() {
      return app.callsTo("POST", "/api/save");
    },
    renameCalls() {
      return app.callsTo("POST", "/api/rename");
    },
    lastSave() {
      const list = app.saveCalls();
      return list[list.length - 1];
    },
    status() {
      return win.document.getElementById("saveStatus").textContent;
    },
    statusKind() {
      return win.document.getElementById("saveStatus").className;
    },
    title() {
      return win.document.title;
    },
    pathLabel() {
      return win.document.getElementById("statusFilePath").textContent;
    },
    value() {
      return app.editor.value;
    },
    beforeUnloadBlocked() {
      const event = new win.Event("beforeunload", { cancelable: true });
      win.dispatchEvent(event);
      return event.defaultPrevented;
    },
    drawerOpen() {
      return !win.document.getElementById("sideDrawer").classList.contains("collapsed");
    },
    fsModalOpen() {
      return !win.document.getElementById("fsModal").classList.contains("hidden");
    },

    // --- driving the UI ---------------------------------------------------
    setValue(text) {
      app.editor.value = text;
    },
    type(text) {
      app.editor.value = text;
      app.editor.dispatchEvent(new win.Event("input", { bubbles: true }));
    },
    append(text) {
      app.type(app.editor.value + text);
    },
    click(id) {
      const el = win.document.getElementById(id);
      if (!el) throw new Error("missing element #" + id);
      el.click();
    },
    press(init) {
      const event = new win.KeyboardEvent("keydown", Object.assign({
        bubbles: true,
        cancelable: true,
      }, init));
      app.editor.dispatchEvent(event);
      return event;
    },
    ctrlS() {
      return app.press({ key: "s", code: "KeyS", ctrlKey: true });
    },
    emitSse(payload) {
      const source = FakeEventSource.instances[0];
      if (!source) throw new Error("the app did not open an EventSource");
      source.emit("open", payload);
    },

    // --- async helpers ----------------------------------------------------
    async flush() {
      // Real Node setImmediate: the fake timers only affect the jsdom window.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
    async advance(ms) {
      await clock.tickAsync(ms);
      await app.flush();
    },
    async close() {
      clock.uninstall();
      win.close();
    },
  };

  win.fetch = app.fetch;
  win.EventSource = FakeEventSource;
  win.confirm = (message) => {
    app.confirmMessages.push(message);
    if (!app.confirmAnswers.length) return true;
    const next = app.confirmAnswers.shift();
    return typeof next === "function" ? next(message) : next;
  };
  win.alert = (message) => {
    app.alertMessages.push(String(message));
  };
  win.prompt = () => null;

  // --- default API routes -------------------------------------------------
  app.routes["/api/init"] = () => {
    // Snapshot presence, not truthiness of the content: an existing empty file
    // has the valid revision of the empty bytes.
    const file = activeFile && files[activeFile] ? files[activeFile] : null;
    return jsonResponse({
      version: "test",
      token: "test-token",
      active_file: activeFile,
      active_dir: "/docs",
      default_dir: "/docs",
      recents: options.recents || [],
      file_content: file ? file.content : "",
      file_revision: file ? revOf(file.content) : "",
      file_exists: !!file,
      read_only: !!(file && file.read_only),
      ...(file && file.read_only ? { read_only_reason: "no_write_bits" } : {}),
    });
  };
  app.routes["GET /api/stat"] = (call) => {
    const file = files[call.query.path];
    if (!file) {
      return jsonResponse({ path: call.query.path, exists: false, revision: "", mod_time: 0, size: 0 });
    }
    return jsonResponse({
      path: call.query.path,
      exists: true,
      revision: revOf(file.content),
      mod_time: file.mod_time,
      size: file.content.length,
      read_only: !!file.read_only,
      ...(file.read_only ? { read_only_reason: "no_write_bits" } : {}),
    });
  };
  app.routes["GET /api/file"] = (call) => {
    const file = files[call.query.path];
    if (!file) return textResponse("file not found", 404);
    return jsonResponse({
      path: call.query.path,
      content: file.content,
      revision: revOf(file.content),
      mod_time: file.mod_time,
      read_only: !!file.read_only,
      ...(file.read_only ? { read_only_reason: "no_write_bits" } : {}),
    });
  };
  app.routes["POST /api/save"] = (call) => {
    const body = call.body || {};
    const existing = files[body.path];
    const expected = body.expected_revision || "";
    if (existing && existing.read_only) {
      return jsonResponse({ success: false, error: "read_only", path: body.path }, 403);
    }
    if (expected && !validRev(expected)) {
      return jsonResponse({ success: false, error: "invalid_revision" }, 400);
    }
    if (!body.force) {
      if (!expected) {
        if (existing) {
          return jsonResponse({ success: false, error: "revision_required", revision: revOf(existing.content) }, 428);
        }
      } else if (!existing) {
        return jsonResponse(conflictBody("file_missing"), 409);
      } else if (revOf(existing.content) !== expected) {
        return jsonResponse(conflictBody("revision_mismatch", revOf(existing.content)), 409);
      }
    } else if (expected && !existing) {
      return jsonResponse(conflictBody("file_missing"), 409);
    }
    files[body.path] = { content: body.content, mod_time: ++app.nextModTime };
    return jsonResponse({
      success: true,
      path: body.path,
      revision: revOf(body.content),
      mod_time: app.nextModTime,
      read_only: false,
    });
  };
  app.routes["POST /api/rename"] = (call) => {
    const data = call.body || {};
    const expected = data.expected_revision || "";
    if (expected && !validRev(expected)) {
      return jsonResponse({ success: false, error: "invalid_revision" }, 400);
    }
    if (!data.old_path && data.source_path) {
      // Copy flow: the destination must not alias the source (string-level in the
      // fake filesystem; the real backend also checks symlinks and inodes).
      if (data.source_path === data.new_path) {
        return jsonResponse({ success: false, error: "conflict", conflict: "copy_same_source", path: data.new_path }, 409);
      }
    }
    if (data.old_path) {
      const src = files[data.old_path];
      if (src && src.read_only) {
        return jsonResponse({ success: false, error: "read_only", path: data.old_path }, 403);
      }
      if (!expected) {
        return jsonResponse({ success: false, error: "revision_required" }, 428);
      }
      if (!src) return jsonResponse(conflictBody("source_missing"), 409);
      if (revOf(src.content) !== expected) {
        return jsonResponse(conflictBody("source_changed", revOf(src.content)), 409);
      }
    }
    if (data.old_path !== data.new_path && files[data.new_path] && files[data.new_path].read_only) {
      return jsonResponse({ success: false, error: "read_only", path: data.new_path }, 403);
    }
    if (data.old_path !== data.new_path && files[data.new_path] && !data.overwrite) {
      return jsonResponse(conflictBody("target_exists"), 409);
    }
    files[data.new_path] = { content: data.content, mod_time: ++app.nextModTime };
    if (data.old_path && data.old_path !== data.new_path) delete files[data.old_path];
    return jsonResponse({
      success: true,
      path: data.new_path,
      revision: revOf(data.content),
      mod_time: app.nextModTime,
      read_only: false,
    });
  };
  app.routes["GET /api/fs"] = (call) => jsonResponse({
    current: call.query.path || "/docs",
    parent: "",
    home: "/home/tester",
    documents: "/docs",
    desktop: "/docs",
    downloads: "/docs",
    workspace: "/docs",
    items: [],
  });
  app.routes["GET /api/workspace"] = () => jsonResponse({ root: "/docs", tree: { children: [] } });
  if (initGate) app.routes["/api/init"] = () => initGate.promise;

  // --- boot the real application ------------------------------------------
  for (const name of SCRIPTS) {
    const source = fs.readFileSync(path.join(JS_DIR, name + ".js"), "utf8");
    win.eval(source);
  }
  // jsdom fires DOMContentLoaded itself once parsing is done (the page is
  // already parsed when the scripts are evaluated). Wait for that event
  // instead of dispatching a second one, which would boot the app twice.
  if (win.document.readyState === "loading") {
    await new Promise((resolve) => {
      if (win.document.readyState !== "loading") return resolve();
      win.document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
  } else {
    win.document.dispatchEvent(new win.Event("DOMContentLoaded", { bubbles: true }));
  }
  await app.flush();

  return app;
}

/**
 * Replace a route with a queue of deferred responses. Returns accessors for
 * the queued deferred objects so a test can resolve them out of order.
 */
// Deferred tests resolve hand-written responses. Two things are kept consistent
// with the real protocol so a test only declares what it cares about:
//  - a write success carries the revision of the content the client sent and
//    updates the fake filesystem (later requests see that version);
//  - a file read carries the revision of its content, and a stat defaults to the
//    current fixture revision (tests simulating an external change pass one
//    explicitly).
function decorateDeferredResponse(app, key, resp, call) {
  if (!resp || !resp.ok) return resp;
  const originalJson = resp.json.bind(resp);

  if (key === "POST /api/save" || key === "POST /api/rename") {
    resp.json = async () => {
      const data = await originalJson();
      if (data && typeof data === "object" && data.success !== false) {
        const content = call.body && call.body.content != null ? call.body.content : "";
        if (typeof data.revision !== "string" || !data.revision) {
          data.revision = revOf(content);
        }
        if (!data.path) data.path = key === "POST /api/save" ? call.body.path : call.body.new_path;
        if (key === "POST /api/save") {
          app.files[call.body.path] = { content, mod_time: ++app.nextModTime };
        } else {
          app.files[call.body.new_path] = { content, mod_time: ++app.nextModTime };
          if (call.body.old_path && call.body.old_path !== call.body.new_path) {
            delete app.files[call.body.old_path];
          }
        }
      }
      return data;
    };
    return resp;
  }

  if (key === "GET /api/file") {
    resp.json = async () => {
      const data = await originalJson();
      if (data && typeof data === "object" && typeof data.revision !== "string") {
        data.revision = revOf(data.content == null ? "" : data.content);
      }
      if (data && typeof data === "object" && !data.path && call.query) data.path = call.query.path;
      return data;
    };
    return resp;
  }

  if (key === "GET /api/stat") {
    resp.json = async () => {
      const data = await originalJson();
      if (data && typeof data === "object") {
        if (typeof data.exists !== "boolean") data.exists = true;
        if (typeof data.revision !== "string") {
          const file = call.query ? app.files[call.query.path] : null;
          data.revision = file ? revOf(file.content) : "";
        }
        if (!data.path && call.query) data.path = call.query.path;
      }
      return data;
    };
    return resp;
  }

  return resp;
}

function deferRoute(app, key) {
  const pending = [];
  app.routes[key] = (call) => {
    const d = deferred();
    pending.push(d);
    return d.promise.then((resp) => decorateDeferredResponse(app, key, resp, call));
  };
  return {
    get pending() {
      return pending;
    },
    get count() {
      return pending.length;
    },
    at(index) {
      return pending[index];
    },
    last() {
      return pending[pending.length - 1];
    },
  };
}

module.exports = {
  createApp,
  deferRoute,
  deferred,
  jsonResponse,
  textResponse,
  conflictBody,
  revOf,
  validRev,
  FakeEventSource,
  ORIGIN,
  REPO_ROOT,
};
