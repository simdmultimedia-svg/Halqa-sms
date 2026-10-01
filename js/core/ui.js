// Reusable UI building blocks shared by feature modules.
import { el, escapeHtml } from "./utils.js";
import * as cfg from "./config.js";

export function card(title, bodyNodes = [], actions = null) {
  const head = title || actions ? el("div", { class: "section-title" }, [
    title ? el("h3", { text: title, style: "flex:1;margin:0" }) : el("div", { class: "spacer" }),
    ...(actions ? (Array.isArray(actions) ? actions : [actions]) : [])
  ]) : null;
  const c = el("div", { class: "card" });
  if (head) c.appendChild(head);
  (Array.isArray(bodyNodes) ? bodyNodes : [bodyNodes]).forEach((n) => n && c.appendChild(typeof n === "string" ? el("div", { html: n }) : n));
  return c;
}

export function pageHead(title, subtitle, actions = []) {
  return el("div", { class: "section-title" }, [
    el("div", { style: "flex:1" }, [
      el("h2", { text: title }),
      subtitle ? el("div", { class: "muted", text: subtitle }) : null
    ]),
    ...(Array.isArray(actions) ? actions : [actions])
  ]);
}

export function field(label, inputNode, opts = {}) {
  const f = el("div", { class: "field" + (opts.full ? " full" : "") });
  if (label) f.appendChild(el("label", { text: label }));
  f.appendChild(inputNode);
  return f;
}

export function input(attrs = {}) { return el("input", { class: "inp", ...attrs }); }
export function textarea(attrs = {}) { return el("textarea", { rows: 3, ...attrs }); }

const liveSelects = new Set();
window.addEventListener("master-data-updated", () => {
  for (let s of liveSelects) {
    if (!document.body.contains(s)) { liveSelects.delete(s); continue; }
    if (s._repopulate) s._repopulate();
  }
});

export function select(optionsFn, attrs = {}) {
  const isFn = typeof optionsFn === "function";
  const s = el("select", attrs);
  
  s._repopulate = () => {
    const opts = isFn ? optionsFn() : optionsFn;
    const currentVal = s.value || attrs.value;
    s.innerHTML = "";
    opts.forEach((o) => {
      const opt = typeof o === "object" ? o : { value: o, label: o };
      const oEl = el("option", { value: opt.value, text: opt.label });
      if (opt.selected) oEl.selected = true;
      s.appendChild(oEl);
    });
    if (currentVal !== undefined && currentVal !== "") {
      s.value = currentVal;
    }
  };
  
  s._repopulate();
  if (isFn) liveSelects.add(s);
  
  return s;
}

export function btn(label, { variant = "ghost", sm = false, onclick, icon, type = "button", attrs = {} } = {}) {
  return el("button", {
    class: `btn btn-${variant}${sm ? " btn-sm" : ""}`, type, onclick, ...attrs
  }, [icon ? el("span", { text: icon }) : null, document.createTextNode(label ? " " + label : "")]);
}

export function table(columns, rows, { rowKey = "id", empty = "No records found.", selection = null } = {}) {
  const wrap = el("div", { class: "table-wrap" });
  if (!rows.length) { wrap.appendChild(el("div", { class: "empty", html: `<div class="big">\uD83D\uDC2D</div>${empty}` })); return wrap; }
  
  let activeColumns = [...columns];
  if (selection) {
    const allIds = rows.map(r => r[rowKey] || r.id).filter(Boolean);
    const allSelected = allIds.length > 0 && allIds.every(id => selection.has(id));
    const someSelected = allIds.some(id => selection.has(id));
    
    const thCb = input({ type: "checkbox", checked: allSelected, style: "margin:0;cursor:pointer" });
    if (someSelected && !allSelected) thCb.indeterminate = true;
    thCb.onclick = (e) => {
      if (e.target.checked) selection.selectAll(allIds);
      else selection.clear();
      // Re-render table handled externally or needs manual refresh? 
      // A full re-render is usually triggered by onUpdate hook in modules, 
      // but let's assume the module calls render() again when selection changes.
    };
    
    activeColumns.unshift({
      labelNode: thCb,
      align: "center",
      render: (r) => {
        const id = r[rowKey] || r.id;
        const cb = input({ type: "checkbox", checked: selection.has(id), style: "margin:0;cursor:pointer" });
        cb.onclick = (e) => { e.stopPropagation(); selection.toggle(id); };
        return cb;
      }
    });
  }

  const t = el("table", { class: "tbl" });
  const thead = el("thead");
  const tr = el("tr");
  activeColumns.forEach((c) => {
    const th = el("th", c.align ? { style: "text-align:" + c.align } : {});
    if (typeof c === "string") {
      th.textContent = c;
    } else {
      if (c.labelNode) th.appendChild(c.labelNode);
      else th.textContent = c.label;
    }
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  t.appendChild(thead);
  const tb = el("tbody");
  rows.forEach((r) => {
    const isSelected = selection?.has(r[rowKey] || r.id);
    const row = el("tr", isSelected ? { style: "background-color: var(--primary-light, #eff6ff)" } : {});
    activeColumns.forEach((c, idx) => {
      const td = el("td", c.align ? { style: "text-align:" + c.align } : {});
      let val;
      if (typeof c === "string") {
        val = Array.isArray(r) ? r[idx] : r[c];
      } else {
        val = c.render ? c.render(r) : r[c.key];
      }
      if (val instanceof Node) td.appendChild(val);
      else td.innerHTML = c.html ? val : escapeHtml(val == null ? "" : val);
      if (c.cls) td.className = c.cls;
      row.appendChild(td);
    });
    tb.appendChild(row);
  });
  t.appendChild(tb);
  wrap.appendChild(t);
  return wrap;
}

export class BulkSelection {
  constructor() { this.selected = new Set(); this.listeners = []; }
  subscribe(fn) { this.listeners.push(fn); return () => this.listeners = this.listeners.filter(f => f !== fn); }
  notify() { this.listeners.forEach(fn => fn()); }
  toggle(id) { this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id); this.notify(); }
  selectAll(ids) { ids.forEach(id => this.selected.add(id)); this.notify(); }
  clear() { this.selected.clear(); this.notify(); }
  has(id) { return this.selected.has(id); }
  get size() { return this.selected.size; }
  get array() { return Array.from(this.selected); }
}

export function bulkActionBar(selection, actions = []) {
  const wrap = el("div", { class: "row bulk-action-bar", style: "display:none; gap:8px; margin-bottom:12px; align-items:center; background:#f8fafc; padding:8px 12px; border-radius:4px; border:1px solid #e2e8f0; position:sticky; top:0; z-index:10;" });
  
  const render = () => {
    if (selection.size === 0) { wrap.style.display = "none"; return; }
    wrap.style.display = "flex";
    wrap.innerHTML = "";
    wrap.appendChild(el("strong", { text: `${selection.size} item${selection.size > 1 ? "s" : ""} selected` }));
    wrap.appendChild(btn("Clear Selection", { sm: true, onclick: () => selection.clear() }));
    wrap.appendChild(el("span", { style: "flex:1" }));
    actions.forEach(a => {
      wrap.appendChild(btn(a.label, { sm: true, variant: a.variant || "primary", onclick: () => a.action(selection.array) }));
    });
  };
  
  selection.subscribe(render);
  render();
  return wrap;
}

export function statCard(icon, value, label) {
  return el("div", { class: "card stat" }, [
    el("div", { class: "ic", text: icon }),
    el("div", {}, [el("div", { class: "v", text: String(value) }), el("div", { class: "l", text: label })])
  ]);
}

// Cascading Section -> Class -> Student picker. Calls onChange({sectionId, classId, studentId}).
export function studentPicker(onChange, { withStudent = true } = {}) {
  const wrap = el("div", { class: "row" });
  const secSel = select([{ value: "", label: "Select Section" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))], { style: "min-width:160px" });
  const clsSel = select([{ value: "", label: "Select Class" }], { style: "min-width:150px", disabled: "disabled" });
  const stuSel = select([{ value: "", label: "Select Student" }], { style: "min-width:200px", disabled: "disabled" });
  function fire() { onChange({ sectionId: secSel.value, classId: clsSel.value, studentId: withStudent ? stuSel.value : null }); }
  secSel.onchange = () => {
    clsSel.innerHTML = ""; clsSel.appendChild(el("option", { value: "", text: "Select Class" }));
    cfg.classes(secSel.value).forEach((c) => clsSel.appendChild(el("option", { value: c.id, text: c.name })));
    clsSel.disabled = !secSel.value;
    stuSel.innerHTML = ""; stuSel.appendChild(el("option", { value: "", text: "Select Student" })); stuSel.disabled = true;
    fire();
  };
  clsSel.onchange = () => {
    if (withStudent) {
      import("./db.js").then(({ db }) => {
        stuSel.innerHTML = ""; stuSel.appendChild(el("option", { value: "", text: "Select Student" }));
        db.query("students", (s) => s.classId === clsSel.value && s.status !== "graduated")
          .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""))
          .forEach((s) => stuSel.appendChild(el("option", { value: s.id, text: `${s.fullName} (${s.admissionNo})` })));
        stuSel.disabled = !clsSel.value;
        fire();
      });
    } else fire();
  };
  stuSel.onchange = fire;
  wrap.appendChild(secSel); wrap.appendChild(clsSel);
  if (withStudent) wrap.appendChild(stuSel);
  return { wrap, secSel, clsSel, stuSel };
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function resizeImageAsDataURL(file, maxW = 400, maxH = 400, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxW) { height = Math.round((height * maxW) / width); width = maxW; }
        if (height > maxH) { width = Math.round((width * maxH) / height); height = maxH; }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function multiSelectBar(selectedSet, allItems, onUpdate) {
  const wrap = el("div", { class: "row", style: "gap:8px; margin-bottom:12px; align-items:center; background:#f8fafc; padding:8px 12px; border-radius:4px; border:1px solid #e2e8f0" });
  const countSpan = el("strong", { text: `${selectedSet.size} selected` });
  
  const selectAllBtn = btn("Select All", { sm: true, variant: "primary", icon: "✓", onclick: () => {
    allItems.forEach(i => selectedSet.add(i.id || i));
    onUpdate();
  }});
  
  const deselectAllBtn = btn("Deselect All", { sm: true, onclick: () => {
    selectedSet.clear();
    onUpdate();
  }});
  
  wrap.appendChild(selectAllBtn);
  wrap.appendChild(deselectAllBtn);
  wrap.appendChild(el("span", { style: "margin-left:auto" }));
  wrap.appendChild(countSpan);
  return wrap;
}
