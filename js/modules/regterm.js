import { db } from "../core/db.js";
import { el, toast, naira, num } from "../core/utils.js";
import { card, pageHead, table, btn, input, select, field } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { buildServiceLines } from "../core/billing.js";
import { registerStudentForTerm, existingRegistration } from "../core/registration.js";
import { showInvoice } from "./invoices.js";
import { bookSelector, deductBookStock } from "./bookshop.js";
import { uniformSelector } from "./uniforms.js";

// Shared UI for Second/Third Term Registration. `term` is "Second Term" or "Third Term".
export function termRegistration(root, ctx, term) {
  root.appendChild(pageHead(`${term} Registration`,
    `Load registered students by section and class, select services, and generate ${term} invoices. No payment is collected here \u2014 bills appear automatically in the Fee Module and Family Ledger.`));

  const state = { sectionId: "", classId: "", serviceIds: [], uniformType: "", uniformSelection: {}, includeBooks: false, selectedBookLines: [] };

  const sel = card("Select Class");
  const secSel = select(() => [{ value: "", label: "Select Section" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))], { style: "min-width:170px" });
  const clsSel = select(() => [{ value: "", label: "Select Class" }], { style: "min-width:170px", disabled: "disabled" });
  secSel.onchange = () => {
    state.sectionId = secSel.value; state.classId = ""; state.serviceIds = []; state.uniformType = ""; state.uniformSelection = {}; state.includeBooks = false; state.selectedBookLines = [];
    clsSel.innerHTML = ""; clsSel.appendChild(el("option", { value: "", text: "Select Class" }));
    cfg.classes(secSel.value).forEach((c) => clsSel.appendChild(el("option", { value: c.id, text: c.name })));
    clsSel.disabled = !secSel.value;
    body.innerHTML = "";
  };
  clsSel.onchange = () => { state.classId = clsSel.value; state.uniformSelection = {}; state.includeBooks = false; state.selectedBookLines = []; drawBody(); };
  sel.appendChild(el("div", { class: "row" }, [secSel, clsSel]));
  root.appendChild(sel);

  const body = el("div");
  root.appendChild(body);

  function drawBody() {
    body.innerHTML = "";
    if (!state.classId) return;
    const students = db.query("students", (s) => s.classId === state.classId && s.status !== "graduated")
      .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
    if (!students.length) { body.appendChild(card("Students", [el("p", { class: "muted", text: "No registered students in this class." })])); return; }

    // ---- Services selection ----
    const svc = card(`Services for ${cfg.sectionName(state.sectionId)} \u2014 ${cfg.className(state.classId)}`);
    svc.appendChild(el("p", { class: "muted", text: "Select the services to charge for this term. Prices are loaded from Settings." }));
    const list = el("div");
    cfg.servicesForSection(state.sectionId).filter((s) => s.type === "fee").forEach((s) => {
      if (!s.optional && !state.serviceIds.includes(s.id)) state.serviceIds.push(s.id);
      const cb = input({ type: "checkbox" }); cb.checked = state.serviceIds.includes(s.id);
      cb.onchange = () => { if (cb.checked) state.serviceIds.push(s.id); else state.serviceIds = state.serviceIds.filter((x) => x !== s.id); recalc(); };
      list.appendChild(el("div", { class: "svc-row" }, [cb, el("span", { class: "nm", text: s.name + (s.optional ? " (optional)" : "") }), el("span", { class: "amt", text: naira(cfg.servicePrice(s.id, state.sectionId)) })]));
    });
    const uniformBox = uniformSelector(state.sectionId, state.classId, { selection: state.uniformSelection, onSelectionChange: (sel) => { state.uniformSelection = sel; try { recalc(); } catch (_) {} } });
    list.appendChild(uniformBox.wrap);
    
    const bookWrap = el("div", { style: "display:none; margin-top:16px;" });
    const bookSel = bookSelector(state.sectionId, state.classId, {
      onSelectionChange: (lines) => { state.selectedBookLines = lines; recalc(); }
    });
    if (bookSel) {
      bookWrap.appendChild(el("div", { style: "margin-bottom:8px;font-weight:600", text: "\uD83D\uDCDA Books Catalogue:" }));
      bookWrap.appendChild(bookSel.wrap);
    }
    
    const bcb = input({ type: "checkbox" });
    bcb.checked = state.includeBooks;
    if (state.includeBooks && bookSel) bookWrap.style.display = "block";
    bcb.onchange = () => { 
      state.includeBooks = bcb.checked; 
      if (bookSel) {
        bookWrap.style.display = bcb.checked ? "block" : "none";
        bookSel.selectAll(bcb.checked);
      }
      recalc(); 
    };
    const booksPrice = cfg.booksPrice(state.sectionId);
    list.appendChild(el("div", { class: "svc-row" }, [bcb, el("span", { class: "nm", text: "Include Books" }), el("span", { class: "amt", text: bookSel ? "Select items" : (booksPrice > 0 ? naira(booksPrice) : "") })]));
    
    svc.appendChild(list);
    if (bookSel) svc.appendChild(bookWrap);

    const totalEl = el("div", { style: "text-align:right;font-weight:800;font-size:16px;margin-top:10px" });
    svc.appendChild(totalEl);
    body.appendChild(svc);

    function currentLines() {
      return [
        ...buildServiceLines(state.sectionId, { serviceIds: state.serviceIds, uniformSelection: state.uniformSelection, classId: state.classId, includeBooks: state.includeBooks }),
        ...(state.selectedBookLines || [])
      ];
    }
    function recalc() { totalEl.textContent = "Charge per student: " + naira(currentLines().reduce((a, s) => a + s.amount, 0)); }
    recalc();

    // ---- Student selection ----
    const picked = new Set(students.filter((s) => !existingRegistration(s.id, term)).map((s) => s.id));
    const stuCard = card(`Registered Students (${students.length})`);
    const rows = students.map((s) => {
      const done = existingRegistration(s.id, term);
      const cb = input({ type: "checkbox" }); cb.checked = picked.has(s.id) && !done; cb.disabled = !!done;
      cb.onchange = () => { if (cb.checked) picked.add(s.id); else picked.delete(s.id); };
      return { s, cb, done };
    });
    stuCard.appendChild(table([
      { label: "", render: (r) => r.cb },
      { label: "Student", render: (r) => r.s.fullName },
      { label: "Admission No", render: (r) => r.s.admissionNo },
      { label: "Status", render: (r) => r.done
        ? el("span", { class: "badge orange", text: `Registered \u2014 ${r.done.invoiceNo}` })
        : el("span", { class: "badge", text: "Not registered" }) },
      { label: "", render: (r) => r.done ? btn("View Invoice", { sm: true, onclick: () => showInvoice(r.done.id) }) : "" }
    ], rows, { empty: "No students" }));

    const gen = btn(`Generate ${term} Invoices`, { variant: "success", icon: "\u2713", onclick: async () => {
      const lines = currentLines();
      if (!lines.length) return toast("Select at least one service", "error");
      const targets = students.filter((s) => picked.has(s.id) && !existingRegistration(s.id, term));
      if (!targets.length) return toast("No students selected (already-registered students are skipped).", "error");
      let created = 0, skipped = 0;
      for (const st of targets) {
        const { skipped: sk } = await registerStudentForTerm(st, lines, term, ctx.user);
        if (sk) skipped++; else { created++; deductBookStock(state.selectedBookLines || []); }
      }
      toast(`${created} invoice(s) generated${skipped ? `, ${skipped} skipped` : ""}. View in Fee Module.`, "success", 4500);
      drawBody();
    } });
    stuCard.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [gen, btn("Go to Fee Module", { onclick: () => ctx.go("fees") })]));
    body.appendChild(stuCard);
  }

  const off = db.on("students", () => { if (state.classId) drawBody(); });
  return () => off();
}




