// Shared utility helpers used across all modules.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return node;
}

export function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function naira(amount) {
  const n = Number(amount || 0);
  return "\u20A6" + n.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function fmtDate(d) {
  if (!d) return "";
  const date = typeof d === "number" || /^\d+$/.test(d) ? new Date(Number(d)) : new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtTime(d) {
  if (!d) return "";
  const date = typeof d === "number" || /^\d+$/.test(d) ? new Date(Number(d)) : new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDateTime(d) {
  if (!d) return "";
  const date = new Date(typeof d === "number" || /^\d+$/.test(String(d)) ? Number(d) : d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function toast(msg, type = "info", ms = 3200) {
  let host = $("#toast-host");
  if (!host) {
    host = el("div", { id: "toast-host", class: "toast-host" });
    document.body.appendChild(host);
  }
  const t = el("div", { class: `toast toast-${type}`, text: msg });
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms);
}

// Generic modal dialog. Returns the modal element; resolve via close().
export function modal({ title = "", body, footer = null, size = "md", onClose } = {}) {
  const overlay = el("div", { class: "modal-overlay" });
  const dialog = el("div", { class: `modal modal-${size}` });
  const head = el("div", { class: "modal-head" }, [
    el("h3", { text: title }),
    el("button", { class: "modal-x", html: "&times;", title: "Close", onclick: () => close() })
  ]);
  const content = el("div", { class: "modal-body" });
  if (typeof body === "string") content.innerHTML = body;
  else if (body) content.appendChild(body);
  dialog.appendChild(head);
  dialog.appendChild(content);
  if (footer) {
    const f = el("div", { class: "modal-foot" });
    (Array.isArray(footer) ? footer : [footer]).forEach((x) => f.appendChild(x));
    dialog.appendChild(f);
  }
  overlay.appendChild(dialog);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));
  function close() {
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 200);
    if (onClose) onClose();
  }
  return { overlay, dialog, body: content, close };
}

export function confirmDialog(message, { title = "Please confirm", okText = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    const ok = el("button", { class: `btn ${danger ? "btn-danger" : "btn-primary"}`, text: okText });
    const cancel = el("button", { class: "btn btn-ghost", text: "Cancel" });
    const m = modal({ title, body: el("p", { class: "muted", text: message }), footer: [cancel, ok] });
    ok.onclick = () => { m.close(); resolve(true); };
    cancel.onclick = () => { m.close(); resolve(false); };
  });
}

export function sumBy(arr, fn) {
  return (arr || []).reduce((a, x) => a + num(fn(x)), 0);
}

export function groupBy(arr, keyFn) {
  const out = {};
  (arr || []).forEach((x) => {
    const k = keyFn(x);
    (out[k] = out[k] || []).push(x);
  });
  return out;
}

export function slug(s) {
  return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function ordinal(n) {
  n = num(n);
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function download(filename, content, mime = "application/octet-stream") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
}
