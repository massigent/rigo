// TypeCraft — Markdown HTML Sanitizer
// marked() passes raw HTML through, so a document opened from disk could run
// script in the app origin — and the app origin holds the API token that can
// read/write files. Every rendered document therefore goes through this
// allow-list before it touches the DOM (the fix Typora needed for CVE-2022-*).

(function () {
  "use strict";

  // Tags removed together with their content.
  var DROP_WITH_CONTENT = [
    "script", "style", "iframe", "object", "embed", "link", "meta", "base",
    "form", "noscript", "template", "svg", "math", "textarea", "select",
    "video", "audio", "source", "track", "canvas", "applet", "frame", "frameset",
  ];

  // Tags kept as-is (after attribute filtering).
  var ALLOWED = {
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height"],
    input: ["type", "checked"],
    abbr: ["title"],
    ol: ["start"],
    td: ["align", "colspan", "rowspan"],
    th: ["align", "colspan", "rowspan"],
    div: [], p: [], span: [], br: [], hr: [],
    h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
    strong: [], b: [], em: [], i: [], u: [], s: [], del: [], ins: [],
    mark: [], sub: [], sup: [], small: [], kbd: [], code: [], pre: [],
    blockquote: [], ul: [], li: [], dl: [], dt: [], dd: [],
    table: [], thead: [], tbody: [], tfoot: [], tr: [],
    figure: [], figcaption: [], details: [], summary: [], section: [], article: [],
    ruby: [], rt: [], rp: [], bdi: [], bdo: [], wbr: [], q: [], cite: [], dfn: [], time: [], data: [], var: [], samp: [],
  };

  var GLOBAL_ATTRS = ["title", "class", "lang", "dir", "align", "colspan", "rowspan", "start", "id"];

  function isDroppedWithContent(tag) {
    return DROP_WITH_CONTENT.indexOf(tag) !== -1;
  }

  function isAllowed(tag) {
    return Object.prototype.hasOwnProperty.call(ALLOWED, tag);
  }

  function cleanUrl(raw, kind) {
    var value = String(raw == null ? "" : raw);
    // Strip control characters that browsers ignore when resolving a scheme
    // ("java\tscript:") before deciding whether the URL is safe.
    value = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (!value) return null;

    if (kind === "src") {
      if (/^data:image\/(png|jpeg|jpg|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(value)) {
        return value;
      }
      if (/^(https?:|blob:)/i.test(value)) return value;
      if (/^file:/i.test(value)) return value;
      if (/^(?!#)[^:]*$/.test(value)) return value; // relative path
      return null;
    }

    if (value.charAt(0) === "#") return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      return /^(https?|mailto|tel|file):/i.test(value) ? value : null;
    }
    return value; // relative link
  }

  function cleanElement(el) {
    var tag = el.tagName.toLowerCase();

    if (isDroppedWithContent(tag)) {
      el.remove();
      return;
    }

    // Recurse first: children may need dropping even if this tag is unwrapped.
    var children = Array.prototype.slice.call(el.children);
    for (var i = 0; i < children.length; i++) cleanElement(children[i]);

    if (!isAllowed(tag)) {
      // Unknown tag (custom element, <font>, <marquee>…): keep the text only.
      el.replaceWith.apply(el, Array.prototype.slice.call(el.childNodes));
      return;
    }

    var allowed = ALLOWED[tag];
    var attrs = Array.prototype.slice.call(el.attributes);
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name.toLowerCase();
      var value = attrs[a].value;

      // Never keep event handlers, inline styles or arbitrary data hooks.
      if (name.indexOf("on") === 0 || name === "style" || name === "srcset" || name === "formaction") {
        el.removeAttribute(attrs[a].name);
        continue;
      }
      if (GLOBAL_ATTRS.indexOf(name) === -1 && allowed.indexOf(name) === -1) {
        el.removeAttribute(attrs[a].name);
        continue;
      }

      if (name === "href") {
        var href = cleanUrl(value, "href");
        if (href === null) el.removeAttribute("href");
        else el.setAttribute("href", href);
      } else if (name === "src") {
        var src = cleanUrl(value, "src");
        if (src === null) el.removeAttribute("src");
        else el.setAttribute("src", src);
      } else if (name === "type") {
        if (tag !== "input" || String(value).toLowerCase() !== "checkbox") {
          el.removeAttribute("type");
        }
      } else if (name === "id") {
        // Keep anchors usable but never let a document collide with app ids.
        if (!/^[A-Za-z][\w:.-]*$/.test(value) || value.indexOf("typecraft") === 0) {
          el.removeAttribute("id");
        }
      }
    }

    // A document may only render checkboxes, never other form controls.
    if (tag === "input" && String(el.getAttribute("type") || "").toLowerCase() !== "checkbox") {
      el.remove();
    }
  }

  function clean(html) {
    var input = String(html == null ? "" : html);
    if (!input) return "";
    // DOMParser builds an inert document: no scripts run while parsing.
    var doc = new DOMParser().parseFromString(input, "text/html");
    if (!doc || !doc.body) return "";
    var roots = Array.prototype.slice.call(doc.body.children);
    for (var i = 0; i < roots.length; i++) cleanElement(roots[i]);
    return doc.body.innerHTML;
  }

  window.TypeCraftSanitizer = { clean: clean };
})();
