// TypeCraft — Live Preview & Interactive Markdown Engine (Typora style, code & math aware)

class LivePreviewEngine {
  constructor(editor, container) {
    this.editor = editor;
    this.container = container;
    this.baseDir = "";
    this.readOnly = false; // set by app.js: task checkboxes must not edit a protected document
    this.onLocalLink = null; // set by app.js: opens a linked .md inside the app
    this.initMarked();
    this.bindEvents();
  }

  setBaseDir(dir) {
    this.baseDir = dir || "";
  }

  initMarked() {
    if (typeof marked === "undefined") return;

    marked.setOptions({
      gfm: true,
      breaks: true,
      silent: true, // a malformed document must never break the editor
    });

    // marked v12 dropped headerIds/mangle; generate stable, collision-safe ids
    // per render so the outline, exported anchors and duplicate headings remain
    // coherent. IDs are reset before every parse (see resetHeadingIds).
    const engine = this;
    const renderer = new marked.Renderer();
    renderer.heading = function (text, level, raw) {
      const input = raw == null ? text : raw;
      const plain = engine._renderMath ? engine._renderMath.expand(input, false) : input;
      return `<h${level} id="${engine.nextHeadingId(plain)}">${text}</h${level}>\n`;
    };
    // Let Marked decide what is a fence (backtick/tilde, longer closers,
    // indentation, nesting and unclosed fences). The renderer only adds the
    // app's code-block class and language class, exactly like the old HTML
    // path did, so CSS, highlighting and the Copy button keep working.
    renderer.code = function (code, infostring) {
      const info = String(infostring || "").trim().split(/\s+/)[0];
      const lang = info.replace(/[^\w+#.-]/g, "");
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      const literal = engine._renderMath ? engine._renderMath.literal(code) : code;
      return `<pre class="code-block"><code${cls}>${escapeHtml(literal)}</code></pre>\n`;
    };
    renderer.codespan = function (escapedText) {
      const literal = engine._renderMath ? engine._renderMath.literal(escapedText, true) : escapedText;
      return `<code>${literal}</code>`;
    };
    // Only checkboxes emitted by marked for a real task get an unguessable
    // per-render id. The sanitizer keeps the id (and strips arbitrary data
    // attributes), so user HTML cannot forge one and be treated as a task.
    renderer.checkbox = function (checked) {
      return `<input id="${engine.nextTaskMarkerId()}" type="checkbox"${checked ? ' checked=""' : ""}>`;
    };
    marked.use({ renderer });
  }

  resetHeadingIds() {
    this._headingIds = new Set();
    this._headingCounts = new Map();
  }

  nextHeadingId(plain) {
    if (!this._headingIds) this.resetHeadingIds();
    const slug = slugify(String(plain).replace(/<[^>]*>/g, "").replace(/[*_`~]/g, ""));
    // The sanitizer keeps IDs that start with an ASCII letter and contain
    // only ASCII word characters, colon, dot or dash. Preserve existing
    // valid anchors, and encode other letters rather than dropping the ID.
    const ascii = slug.replace(/[^\w-]/gu, (char) => "-u" + char.codePointAt(0).toString(16) + "-");
    const base = /^[a-z]/i.test(ascii) && !ascii.startsWith("typecraft") ? ascii : "section-" + ascii;
    const count = this._headingCounts.get(base) || 0;
    this._headingCounts.set(base, count + 1);
    let id = count === 0 ? base : base + "-" + count;
    let suffix = count;
    while (this._headingIds.has(id)) {
      suffix += 1;
      id = base + "-" + suffix;
    }
    this._headingIds.add(id);
    return id;
  }

  // Visible text of a heading token (or of a raw heading string). Kept in one
  // place so the renderer id, the outline label and the preview agree.
  headingPlainText(token) {
    const walk = (node) => {
      if (!node) return "";
      if (typeof node === "string") return node;
      if (node.type === "html") return "";
      if (Array.isArray(node.tokens)) return node.tokens.map(walk).join("");
      return node.text || node.raw || "";
    };
    const text = walk(token).replace(/\s+/g, " ").trim();
    // Decode Marked's text entities without interpreting any markup.
    const decoder = document.createElement("textarea");
    return text.split("\u0000").map((part) => {
      decoder.innerHTML = part.replace(/</g, "&lt;");
      return decoder.value;
    }).join("\u0000");
  }

  bindEvents() {
    if (!this.container) return;

    // 1. Interactive task list checkboxes (marked renders them disabled).
    this.container.addEventListener("click", (e) => {
      const target = e.target;
      if (!target || target.tagName !== "INPUT" || target.type !== "checkbox") return;
      e.preventDefault();
      this.handleTaskCheckboxClick(target);
    });

    // 2. Links: never navigate the app window away (that would drop unsaved
    //    work and leak the ?token= in the Referer header). Every anchor click
    //    goes through the single conservative policy in handleAnchorClick(),
    //    whether it comes from the mouse or from keyboard activation (Enter on
    //    a focused anchor dispatches the same DOM "click" event).
    const handleLink = (e) => {
      if (e.type === "auxclick" && e.button !== 1) return;
      const anchor = e.target?.closest?.("a");
      if (anchor && this.container.contains(anchor)) this.handleAnchorClick(anchor, e);
    };
    this.container.addEventListener("click", handleLink);
    this.container.addEventListener("auxclick", handleLink);
  }

  // ---------------------------------------------------------- Link policy
  //
  // Explicit conservative policy for preview anchors (documented here because
  // there is no other authoritative description):
  //
  //  - fragment-only ("#anchor", raw or percent-encoded): real in-preview
  //    fragment. The default browser behaviour is prevented and the target
  //    element inside this preview is scrolled into view, so the app
  //    location/history is never touched.
  //  - http/https/mailto/tel: external destination, always opened in an
  //    isolated context ("_blank", noopener,noreferrer). The raw href is used
  //    verbatim: percent-encoding inside external URLs is never decoded.
  //  - local documents: scheme-less or authority-free file:/// paths ending
  //    in a supported document extension. Use file:///C:/… for Windows
  //    absolute paths in Markdown. Percent-encoded paths are decoded once.
  //  - fragments on local documents are stripped: the app cannot verify that a
  //    fragment exists in another file, so only the path is forwarded.
  //  - a query string on a local path is refused: the backend cannot resolve
  //    queries for documents, so such a link is ambiguous by definition.
  //  - everything else is blocked and does nothing: never navigates the app
  //    window, never opens anything. This includes network-style destinations
  //    ("//host/path", "\\\\host\\share", "file://host/path"), every other
  //    scheme (javascript:, data:, blob:, vbscript:, ws:, …), local paths with
  //    unsupported extensions, and malformed percent-encoding. Encoded input
  //    is decoded once and re-classified, so "%2F%2Fhost/doc.md" or
  //    "%6Aavascript:..." cannot sneak past these checks as a local document.
  //
  classifyHref(href) {
    const raw = String(href || "").trim();
    const blocked = { type: "blocked" };
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw) || /%(?![\da-f]{2})/i.test(raw)) return blocked;

    // Fragment-only links are detected on the raw value: they cannot hide a
    // scheme, and the fragment itself is decoded for the id lookup.
    if (raw.charAt(0) === "#") {
      return { type: "fragment", target: safeDecode(raw.slice(1)) };
    }

    // Scheme detection on the raw value. External URLs keep their original
    // encoding.
    const drivePath = /^[a-z]:[\\/]/i;
    const scheme = /^[a-z][a-z0-9+.-]*:/i;
    const fileUrl = /^file:\/\/\/(?![\\/])/i.test(raw);
    if (!drivePath.test(raw) && !fileUrl && scheme.test(raw)) {
      if (/^https?:\/\/[^/\\]/i.test(raw) && !/[\\\s]/.test(raw)) {
        try {
          if (new URL(raw).hostname) return { type: "external", href: raw };
        } catch (_) {}
      } else if (/^(mailto|tel):[^/\\\s]+/i.test(raw)) {
        return { type: "external", href: raw };
      }
      return blocked;
    }

    // Discard only a literal fragment. Escaped # and ? can be filename bytes.
    const encoded = raw.split("#", 1)[0];
    if (!encoded || encoded.includes("?")) return blocked;
    let path = safeDecode(fileUrl ? encoded.slice("file://".length) : encoded);
    if (!path || path !== path.trim() || /[\u0000-\u001f\u007f]/.test(path) || /^[\\/]{2}/.test(path)) return blocked;
    if (fileUrl && /^\/[a-z]:\//i.test(path)) path = path.slice(1);
    if (scheme.test(path) && !drivePath.test(path)) return blocked;
    if (!/\.(md|markdown|mdown|mkd|mdwn|txt|mdx)$/i.test(path)) return blocked;
    return { type: "local", path };
  }

  // Single entry point for every anchor activation inside the preview.
  // "default" browser navigation is prevented for every category: the app
  // window must never navigate away, and only the branches below decide what
  // happens instead.
  handleAnchorClick(anchor, e) {
    const raw = (anchor.getAttribute("href") || "").trim();
    const link = this.classifyHref(raw);

    if (link.type === "fragment") {
      e.preventDefault();
      if (!link.target) return;
      const el = Array.from(this.container.querySelectorAll("[id]")).find((node) => node.id === link.target);
      // No history entry: default hash navigation is prevented above.
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView();
      return;
    }

    if (link.type === "external") {
      e.preventDefault();
      // Isolated context: a new browsing context that cannot touch this window
      // (noopener) and does not leak the app URL/its ?token= via Referer.
      window.open(link.href, "_blank", "noopener,noreferrer");
      return;
    }

    if (link.type === "local") {
      e.preventDefault();
      if (typeof this.onLocalLink === "function") {
        // resolvePath() joins the (already decoded) path with the document
        // directory. The handler decides what to open; this engine itself
        // never navigates.
        this.onLocalLink(this.resolvePath(link.path, false));
      }
      return;
    }

    // blocked (empty, malformed, unsupported, network-style): swallow the
    // activation, change nothing.
    e.preventDefault();
  }

  resolvePath(p, decode = true) {
    let out = String(p || "").trim();
    if (decode) {
      try { out = decodeURIComponent(out); } catch (_) {}
    }
    out = out.replace(/^file:\/\//i, "");
    if (/^([a-zA-Z]:[\\/]|[\\/])/.test(out)) return out; // already absolute
    const dir = (this.baseDir || "").replace(/[\\/]+$/, "");
    if (!dir) return out;
    return dir + "/" + out.replace(/^\.\//, "");
  }

  slugify(text) {
    return slugify(text);
  }

  // Marked owns fence recognition. These ranges are only used for masking
  // (task matching) and to keep math extraction out of code; rendering itself
  // always goes through marked.parse() and renderer.code.
  collectCodeRanges(text) {
    const src = String(text == null ? "" : text);
    if (!src || typeof marked === "undefined") return [];
    let tokens;
    try { tokens = marked.lexer(src); } catch (_) { return []; }

    const ranges = [];
    const add = (start, end) => {
      if (Number.isInteger(start) && Number.isInteger(end) && end > start) ranges.push([start, end]);
    };
    const source = this.normalizeTokenSource(src);
    this.walkSourceTokens(tokens, source.content, (i) => source.map?.[i] ?? i, (token, at) => {
      if (token.type === "code" || token.type === "codespan") add(at(0), at(token.raw.length - 1) + 1);
    }, true);
    return mergeRanges(ranges);
  }

  // Follow Marked's tokens in source order. Containers strip prefixes, so
  // their child offsets must be translated through the original quote/item.
  walkSourceTokens(children, raw, map, visit, includeInline = false) {
    const walk = (tokens, text, offsets) => this.walkSourceTokens(tokens, text, offsets, visit, includeInline);
    let cursor = 0;
    for (const token of children || []) {
      if (!token.raw) continue;
      const rel = raw.indexOf(token.raw, cursor);
      if (rel < 0) continue;
      cursor = rel + token.raw.length;
      const at = (i) => map(rel + i);
      visit(token, at);
      if (token.type === "blockquote" || token.type === "list_item") {
        const content = token.type === "blockquote" ? this.blockquoteContentMap(token.raw) : this.parserListContentMap(token);
        const normalized = this.normalizeTokenSource(content.content);
        walk(token.tokens, normalized.content, (i) => {
          const offset = content.map[normalized.map?.[i] ?? i];
          return offset === undefined ? undefined : at(offset);
        });
      } else if (token.type === "list") {
        walk(token.items, token.raw, at);
      } else if (includeInline && token.type === "table") {
        this.walkTableCells(token, at, walk);
      } else if (includeInline && token.tokens) {
        walk(token.tokens, token.raw, at);
      }
    }
  }

  // Marked expands leading tab runs before making block tokens. Retain the
  // original position of each expanded character for math and outline offsets.
  normalizeTokenSource(raw) {
    if (!/^( *)(\t+)/m.test(raw)) return { content: raw, map: null };
    let content = "";
    const map = [];
    let pos = 0;
    for (const match of raw.matchAll(/^( *)(\t+)/gm)) {
      const start = match.index + match[1].length;
      content += raw.slice(pos, start);
      for (let i = pos; i < start; i++) map.push(i);
      for (let i = start; i < start + match[2].length; i++) map.push(i, i, i, i);
      content += "    ".repeat(match[2].length);
      pos = start + match[2].length;
    }
    content += raw.slice(pos);
    for (let i = pos; i < raw.length; i++) map.push(i);
    return { content, map };
  }

  parserListContentMap(item) {
    const raw = item.raw;
    const marker = /^ {0,3}(?:[-*+]|\d{1,9}[.)])/.exec(raw);
    if (!marker) return { content: "", map: [] };
    const first = raw.split("\n", 1)[0].slice(marker[0].length);
    const indent = first.search(/[^ ]/);
    const trim = indent > 4 ? 1 : Math.max(0, indent);
    const width = marker[0].length + trim;
    const tabs = /^\t+/.exec(first)?.[0].length || 0;
    const map = [];
    let content = "";
    let pos = 0;
    for (const line of raw.split("\n")) {
      let start = 0;
      if (pos === 0) {
        for (let i = trim; i < tabs * 3; i++) {
          content += " ";
          map.push(marker[0].length + Math.floor(i / 3));
        }
        start = marker[0].length + tabs + Math.max(0, trim - tabs * 3);
        if (item.task) start += /^\[[ xX]\] +/.exec(line.slice(start))?.[0].length || 0;
      } else if (line.search(/[^ ]/) >= width || !line.trim()) {
        start = width;
      }
      for (let i = start; i < line.length; i++) {
        content += line[i];
        map.push(pos + i);
      }
      if (pos + line.length < raw.length) {
        content += "\n";
        map.push(pos + line.length);
      }
      pos += line.length + 1;
    }
    return { content, map };
  }

  walkTableCells(table, at, walk) {
    const rows = [table.header, null, ...table.rows];
    let lineStart = 0;
    let rowIndex = 0;
    for (const line of table.raw.split("\n")) {
      if (rowIndex >= rows.length) break;
      const cells = rows[rowIndex++];
      if (cells) {
        // Marked strips the escape from a literal pipe in a table cell.
        let content = "";
        const offsets = [];
        for (let i = 0; i < line.length; i++) {
          if (line[i] === "\\" && line[i + 1] === "|") i += 1;
          offsets.push(lineStart + i);
          content += line[i];
        }
        let cursor = 0;
        for (const cell of cells) {
          if (!cell.text) continue;
          const start = content.indexOf(cell.text, cursor);
          if (start < 0) break;
          walk(cell.tokens, cell.text, (i) => at(offsets[start + i]));
          cursor = start + cell.text.length;
        }
      }
      lineStart += line.length + 1;
    }
  }

  // Protect math outside parser-recognized code. Keep a sparse source map:
  // each copied string has a constant offset from its original location.
  extractMathOutsideCode(src, mask = false) {
    const formulas = [];
    const spans = [];
    let text = "";
    let prefix = "\u0000MATH";
    while (src.includes(prefix)) prefix += "M";
    const pattern = new RegExp(prefix + "(\\d+)\u0000", "g");
    const copy = (start, end) => {
      if (end <= start) return;
      spans.push({ at: text.length, source: start, length: end - start });
      text += src.slice(start, end);
    };
    const stash = (start, end, formula, block) => {
      if (mask) {
        text += maskSpan(src.slice(start, end));
      } else {
        const marker = `${prefix}${formulas.length}\u0000`;
        spans.push({ at: text.length, source: start, length: marker.length, marker: true });
        text += marker;
        formulas.push({ formula: formula.trim(), block, source: src.slice(start, end) });
      }
    };
    const inline = (start, end) => {
      let cursor = start;
      for (const match of src.slice(start, end).matchAll(/(^|[^\\$])\$(?![\s$])([^$\n]+?)\$(?![\d$])/g)) {
        const at = start + match.index;
        copy(cursor, at + match[1].length);
        cursor = at + match[0].length;
        stash(at + match[1].length, cursor, match[2], false);
      }
      copy(cursor, end);
    };
    const outside = (start, end) => {
      let cursor = start;
      for (const match of src.slice(start, end).matchAll(/\$\$([\s\S]+?)\$\$/g)) {
        const at = start + match.index;
        inline(cursor, at);
        cursor = at + match[0].length;
        stash(at, cursor, match[1], true);
      }
      inline(cursor, end);
    };
    let cursor = 0;
    for (const [start, end] of src.includes("$") ? this.collectCodeRanges(src) : []) {
      outside(cursor, start);
      copy(start, end);
      cursor = end;
    }
    outside(cursor, src.length);
    return {
      text,
      offsetAt(at) {
        // Binary search because a document can contain many short formulas.
        let lo = 0;
        let hi = spans.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (spans[mid].at <= at) lo = mid + 1;
          else hi = mid;
        }
        const span = spans[lo - 1];
        if (span && at < span.at + span.length) return span.marker ? span.source : span.source + at - span.at;
        return undefined;
      },
      literal(value, escaped = false) {
        return String(value).replace(pattern, (match, i) => {
          const entry = formulas[Number(i)];
          return entry ? (escaped ? escapeHtml(entry.source) : entry.source) : match;
        });
      },
      expand(value, html) {
        return String(value).replace(pattern, (match, i) => {
          const entry = formulas[Number(i)];
          if (!entry) return match;
          const { formula, block } = entry;
          if (!html) return formula;
          const escaped = escapeHtml(formula);
          return block
            ? `<div class="math-block"><span class="math-tex">${escaped}</span></div>`
            : `<span class="math-inline math-tex">${escaped}</span>`;
        });
      },
    };
  }

  makeTaskNonce() {
    try {
      if (window.crypto && typeof window.crypto.getRandomValues === "function") {
        const words = new Uint32Array(2);
        window.crypto.getRandomValues(words);
        return Array.from(words).map((n) => n.toString(36)).join("");
      }
    } catch (_) {}
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  nextTaskMarkerId() {
    if (!this._taskRenderPrefix) {
      this._taskRenderPrefix = "tc-task-" + this.makeTaskNonce() + "-";
      this._taskRenderCounter = 0;
    }
    const id = this._taskRenderPrefix + this._taskRenderCounter;
    this._taskRenderCounter += 1;
    return id;
  }

  // Same masking as the renderer, but with spaces of the same length. Marked
  // can then be used only to locate task markers in the original buffer without
  // changing offsets, and code/math cannot contribute fake tasks.
  maskProtectedSource(text) {
    return this.extractMathOutsideCode(text, true).text;
  }

  mapThroughContent(contentMap, parentMap) {
    return (local) => {
      const rawIndex = contentMap.map[local];
      if (rawIndex === undefined) return undefined;
      return parentMap(rawIndex);
    };
  }

  blockquoteContentMap(raw) {
    let content = "";
    const map = [];
    let pos = 0;
    while (pos < raw.length) {
      let end = raw.indexOf("\n", pos);
      if (end < 0) end = raw.length;
      else end += 1;
      const line = raw.slice(pos, end);
      const prefix = /^[ \t]*>[ \t]?/.exec(line);
      const strip = prefix ? prefix[0].length : 0;
      for (let i = strip; i < line.length; i++) {
        content += line[i];
        map.push(pos + i);
      }
      pos = end;
    }
    return { content, map };
  }

  listItemContentMap(raw) {
    let content = "";
    const map = [];
    const marker = /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)/.exec(raw);
    const width = marker ? marker[0].length : 0;
    let pos = 0;
    let first = true;
    while (pos < raw.length) {
      let end = raw.indexOf("\n", pos);
      if (end < 0) end = raw.length;
      else end += 1;
      const line = raw.slice(pos, end);
      let strip = 0;
      if (first) {
        strip = Math.min(width, line.length);
        first = false;
      } else {
        while (strip < width && strip < line.length && (line[strip] === " " || line[strip] === "\t")) strip++;
      }
      for (let i = strip; i < line.length; i++) {
        content += line[i];
        map.push(pos + i);
      }
      pos = end;
    }
    return { content, map };
  }

  // Token positions are derived from marked's own raw strings. A blockquote
  // strips its `> ` prefixes and a list item strips its continuation indent;
  // the content maps translate offsets back to the real source positions, so
  // nested/numbered/quoted tasks keep an exact marker, not an index guess.
  collectTaskToken(token, tokenMap, out, state) {
    if (!token || !state.ok) return;
    if (token.type === "blockquote" && Array.isArray(token.tokens)) {
      const content = this.blockquoteContentMap(token.raw);
      this.collectTaskChildren(token.tokens, content.content, this.mapThroughContent(content, tokenMap), out, state);
      return;
    }
    if (token.type === "list" && Array.isArray(token.items)) {
      let itemCursor = 0;
      for (const item of token.items) {
        const itemMap = (local) => tokenMap(itemCursor + local);
        if (item.task) {
          const firstLine = String(item.raw).split("\n")[0];
          const mark = /\[[ xX]\]/.exec(firstLine);
          if (!mark) {
            state.ok = false;
            return;
          }
          const offset = itemMap(mark.index);
          if (offset === undefined) {
            state.ok = false;
            return;
          }
          out.push({ offset, checked: !!item.checked });
        }
        if (Array.isArray(item.tokens)) {
          const itemContent = this.listItemContentMap(item.raw);
          this.collectTaskChildren(item.tokens, itemContent.content, this.mapThroughContent(itemContent, itemMap), out, state);
        }
        itemCursor += String(item.raw).length;
      }
      return;
    }
    if (token.type === "list_item" && Array.isArray(token.tokens)) {
      const itemContent = this.listItemContentMap(token.raw);
      this.collectTaskChildren(token.tokens, itemContent.content, this.mapThroughContent(itemContent, tokenMap), out, state);
    }
  }

  collectTaskChildren(children, parentRaw, parentMap, out, state) {
    let cursor = 0;
    for (const child of children) {
      if (!child) continue;
      if (child.type === "list" || child.type === "blockquote" || child.type === "list_item") {
        const rel = parentRaw.indexOf(child.raw, cursor);
        if (rel < 0) {
          state.ok = false;
          return;
        }
        this.collectTaskToken(child, (local) => parentMap(rel + local), out, state);
        cursor = rel + String(child.raw).length;
      } else {
        const rel = parentRaw.indexOf(child.raw, cursor);
        if (rel >= 0) cursor = rel + String(child.raw).length;
      }
      if (!state.ok) return;
    }
  }

  taskStates(tokens) {
    const states = [];
    const walk = (list) => {
      for (const token of list) {
        if (token.type === "list" && Array.isArray(token.items)) {
          for (const item of token.items) {
            if (item.task) states.push(!!item.checked);
            if (Array.isArray(item.tokens)) walk(item.tokens);
          }
        } else if (Array.isArray(token.tokens)) {
          walk(token.tokens);
        }
      }
    };
    walk(tokens);
    return states;
  }

  // Outline headings come from the same parser/preview masking as the rendered
  // document: Marked decides what is a heading (setext, HTML blocks, fences,
  // tilde fences, nested containers) and the math transformation maps tokens
  // back to the editor so source offsets remain exact for the caret jump.
  parseHeadings(markdownText) {
    const src = markdownText == null ? "" : String(markdownText);
    if (!src || typeof marked === "undefined") return [];
    const math = this.extractMathOutsideCode(src);
    let tokens;
    try { tokens = marked.lexer(math.text); } catch (_) { return []; }

    const headings = [];
    let lineIndex = 0;
    let nextBreak = src.indexOf("\n");
    const source = this.normalizeTokenSource(math.text);
    this.walkSourceTokens(tokens, source.content, (i) => source.map?.[i] ?? i, (token, at) => {
      if (token.type !== "heading") return;
      const marker = /^[ \t]*(#{1,6})(?=\s|$)/.exec(token.raw);
      const offset = math.offsetAt(at(marker ? marker[0].indexOf("#") : 0));
      const title = math.expand(this.headingPlainText(token), false);
      if (offset === undefined || !title) return;
      while (nextBreak !== -1 && nextBreak < offset) {
        lineIndex += 1;
        nextBreak = src.indexOf("\n", nextBreak + 1);
      }
      headings.push({ level: token.depth, title, charOffset: offset, lineIndex });
    });
    return headings;
  }

  computeTaskMarkers(src, renderText) {
    try {
      const masked = this.maskProtectedSource(src);
      const tokens = marked.lexer(masked);
      if (tokens.map((t) => t.raw).join("") !== masked) return [];
      const markers = [];
      const state = { ok: true };
      let cursor = 0;
      for (const token of tokens) {
        if (token.type === "list" || token.type === "blockquote" || token.type === "list_item") {
          this.collectTaskToken(token, (local) => cursor + local, markers, state);
          if (!state.ok) return [];
        }
        cursor += String(token.raw).length;
      }
      // The renderer parses the code/math-stashed text. Its task sequence must
      // match the markers located in the real buffer, otherwise no checkbox is
      // made interactive (no index or text-similarity fallback).
      const rendered = this.taskStates(marked.lexer(renderText));
      if (rendered.length !== markers.length) return [];
      for (let i = 0; i < markers.length; i++) {
        if (rendered[i] !== !!markers[i].checked) return [];
      }
      return markers;
    } catch (_) {
      return [];
    }
  }

  applyReadOnlyToTaskCheckboxes() {
    if (!this.container) return;
    this.container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      // An unmapped task (or a checkbox authored as HTML) is display-only.
      cb.disabled = this.readOnly || !this.taskBindings?.has(cb);
    });
  }

  setReadOnly(on) {
    this.readOnly = !!on;
    this.applyReadOnlyToTaskCheckboxes();
  }

  render(markdownText) {
    if (!this.container || typeof marked === "undefined") return;

    const src = markdownText == null ? "" : String(markdownText);
    // Marked parses fences itself; math is protected only outside code.
    const math = this.extractMathOutsideCode(src);

    this.resetHeadingIds();
    this.taskGeneration = (this.taskGeneration || 0) + 1;
    this._taskRenderPrefix = "tc-task-" + this.makeTaskNonce() + "-";
    this._taskRenderCounter = 0;
    this.taskBindings = new WeakMap();
    this.boundTaskCheckboxes = new Set();
    const markers = this.computeTaskMarkers(src, math.text);

    let html;
    this._renderMath = math;
    try {
      html = marked.parse(math.text);
    } catch (err) {
      console.error("Markdown parse error:", err);
      html = `<p>${escapeHtml(src)}</p>`;
    } finally {
      this._renderMath = null;
    }

    html = math.expand(html, true);
    html = this.sanitize(html);

    this.container.innerHTML = html;

    // Unwrapping block math leaves empty <p> shells around it; drop them so the
    // document has no stray blank lines.
    this.container.querySelectorAll("p").forEach((p) => {
      if (!p.textContent.trim() && !p.querySelector("img, input, br, pre, code")) p.remove();
    });

    this.prepareLocalImages();
    this.renderedText = src;
    this.enableTaskCheckboxes(markers);
    this.attachCopyCodeButtons();
  }

  sanitize(html) {
    if (window.TypeCraftSanitizer) return window.TypeCraftSanitizer.clean(html);
    // Fail closed: without the sanitizer, show the source as plain text.
    return `<pre>${escapeHtml(html)}</pre>`;
  }

  prepareLocalImages() {
    const apiUrl = window.tcApiUrl;
    this.container.querySelectorAll("img").forEach((img) => {
      const raw = img.getAttribute("src") || "";
      if (!raw) return;
      if (/^(https?:|data:|blob:)/i.test(raw)) {
        img.setAttribute("loading", "lazy");
        return;
      }
      let abs = this.resolvePath(raw);
      if (typeof apiUrl !== "function") return;
      // Force the image through the backend so relative paths resolve against
      // the document folder (Typora behaviour) and never against the app root.
      if (!/^([a-zA-Z]:[\\/]|\/)/.test(abs)) return;
      img.setAttribute("src", apiUrl("/api/asset?path=" + encodeURIComponent(abs)));
      img.setAttribute("loading", "lazy");
      img.addEventListener("error", () => img.classList.add("img-missing"), { once: true });
    });
  }

  enableTaskCheckboxes(markers) {
    const prefix = this._taskRenderPrefix || "";
    const list = Array.isArray(markers) ? markers : [];
    let valid = !!prefix && list.length === this._taskRenderCounter;
    const found = new Map();

    if (valid) {
      const boxes = Array.from(this.container.querySelectorAll('input[type="checkbox"]'));
      for (const cb of boxes) {
        const id = cb.getAttribute("id") || "";
        if (!id.startsWith(prefix)) continue;
        const suffix = id.slice(prefix.length);
        if (!/^\d+$/.test(suffix)) continue;
        const index = Number(suffix);
        if (index < 0 || index >= list.length || found.has(index)) {
          valid = false;
          break;
        }
        found.set(index, cb);
      }
      if (valid && found.size !== list.length) valid = false;
    }

    if (!valid) {
      // Never leave an id that could be mistaken for an authorisation marker.
      this.container.querySelectorAll('input[type="checkbox"][id]').forEach((cb) => {
        const id = cb.getAttribute("id") || "";
        if (prefix && id.startsWith(prefix)) cb.removeAttribute("id");
      });
      this.taskBindings = new WeakMap();
      this.boundTaskCheckboxes = new Set();
      this.applyReadOnlyToTaskCheckboxes();
      return;
    }

    this.taskBindings = new WeakMap();
    this.boundTaskCheckboxes = new Set();
    for (let i = 0; i < list.length; i++) {
      const cb = found.get(i);
      cb.removeAttribute("id");
      cb.classList.add("task-checkbox");
      cb.setAttribute("tabindex", "-1");
      this.taskBindings.set(cb, {
        offset: list[i].offset,
        checked: !!list[i].checked,
        generation: this.taskGeneration,
      });
      this.boundTaskCheckboxes.add(cb);
    }
    this.applyReadOnlyToTaskCheckboxes();
  }

  attachCopyCodeButtons() {
    this.container.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".btn-copy-code")) return;

      const btn = document.createElement("button");
      btn.className = "btn-copy-code";
      btn.type = "button";
      btn.textContent = "Copy";

      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const code = pre.querySelector("code")?.textContent || "";
        const done = () => {
          btn.textContent = "Copied!";
          setTimeout(() => (btn.textContent = "Copy"), 1800);
        };
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(code).then(done).catch(() => fallback());
        } else {
          fallback();
        }
        function fallback() {
          const ta = document.createElement("textarea");
          ta.value = code;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); done(); } catch (_) {}
          document.body.removeChild(ta);
        }
      });

      pre.style.position = "relative";
      pre.appendChild(btn);
    });
  }

  handleTaskCheckboxClick(checkbox) {
    // Read-only is also enforced here: the DOM input is disabled, but the click
    // handler must never rewrite source text for a protected document.
    if (this.readOnly) return;
    if (!this.taskBindings || !this.container || !this.container.contains(checkbox)) return;
    const binding = this.taskBindings.get(checkbox);
    if (!binding || binding.generation !== this.taskGeneration) return;

    const value = this.editor.value;
    // The preview that produced this node must still describe the whole
    // buffer. Typing during the debounce, a replaced document (even with equal
    // text) and an old render all fail this check; a new render re-arms it.
    if (value !== this.renderedText) return;

    const pos = binding.offset;
    if (!Number.isInteger(pos) || pos < 0 || pos + 2 >= value.length) return;
    if (value[pos] !== "[" || value[pos + 2] !== "]") return;
    const state = value[pos + 1];
    if (state !== " " && state !== "x" && state !== "X") return;

    const next = state === " " ? "x" : " ";
    const start = this.editor.selectionStart;
    const end = this.editor.selectionEnd;
    this.editor.value = value.slice(0, pos + 1) + next + value.slice(pos + 2);
    try {
      const max = this.editor.value.length;
      this.editor.setSelectionRange(Math.min(start, max), Math.min(end, max));
    } catch (_) {}
    // Exactly one normal input event: the controller owns dirty/autosave.
    this.editor.dispatchEvent(new Event("input"));
  }
}

function maskSpan(s) {
  return String(s == null ? "" : s).replace(/[^\r\n]/g, " ");
}

function safeDecode(text) {
  try {
    return decodeURIComponent(String(text == null ? "" : text));
  } catch (_) {
    return null;
  }
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\u00C0-\uFFFF\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-") || "section";
}

function mergeRanges(ranges) {
  const sorted = (ranges || []).slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else out.push([range[0], range[1]]);
  }
  return out;
}

window.LivePreviewEngine = LivePreviewEngine;
