// Family Ledger module — the master financial account consolidating every child's
// charges and payments under one parent/guardian.
import { db } from "../core/db.js";
import { el, toast, naira, num, fmtDate, modal, debounce, confirmDialog } from "../core/utils.js";
import { card, pageHead, table, btn, input, field, select, statCard } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { invoiceForStudent } from "../core/billing.js";
import { familyInvoiceDoc, familyStatementDoc, familyReceiptDoc } from "../core/documents.js";
import { printHtml, downloadPdf, downloadImage, shareDocumentToWhatsApp } from "../core/print.js";
import { normaliseRole } from "../core/rbac.js";
import {
  families, getFamily, familyStudents, familyTotals, buildLedger, outstandingInvoices,
  allocateFamilyPayment, autoGroupExistingStudents, discountPercentFor, linkStudent, unlinkStudent,
  createFamilyInvoice
} from "../core/family.js";
import { showReceipt } from "./receipts.js";

export function render(root, ctx) {
  const isParent = normaliseRole(ctx.user.role) === "Parent";
  if (isParent) {
    const linkedStudent = ctx.user.studentId ? db.get("students", ctx.user.studentId) : null;
    const familyId = ctx.user.familyId || linkedStudent?.familyId || null;
    const family = familyId ? getFamily(familyId) : null;
    if (!family) {
      root.appendChild(pageHead("Family Ledger"));
      root.appendChild(card("Access", [el("p", { class: "muted", text: "No family ledger is linked to this parent account." })]));
      return;
    }
    if (ctx.param && ctx.param !== family.id && ctx.param !== family.familyId) {
      root.appendChild(pageHead("Access Denied"));
      root.appendChild(card("Access Denied", [el("p", { class: "muted", text: "You can only view your linked family ledger." })]));
      return;
    }
    return renderDetail(root, ctx, family, { readOnly: true });
  }
  if (ctx.param) { const fam = getFamily(ctx.param); if (fam) return renderDetail(root, ctx, fam); toast("Family not found", "error"); }
  return renderList(root, ctx);
}

// ---------------- List + Reports ----------------
function renderList(root, ctx) {
  root.appendChild(pageHead("Family Ledger", "Consolidated financial account for each parent/guardian. Every child's charges and payments roll up here.", [
    btn("Auto-group Existing", { icon: "\uD83D\uDD17", onclick: async () => {
      const { created, linked } = await autoGroupExistingStudents();
      toast(`Grouped ${linked} student(s) into ${created} new + existing families`, "success", 4000);
      draw();
    } }),
    btn("New Family", { variant: "primary", icon: "\u2795", onclick: () => familyForm(null, draw) })
  ]));

  const statHost = el("div", { class: "stat-grid", style: "margin-bottom:14px" });
  root.appendChild(statHost);
  const search = input({ placeholder: "Search by family ID, parent name or phone\u2026", style: "max-width:340px" });
  root.appendChild(el("div", { class: "row", style: "margin-bottom:14px" }, [search]));
  const host = el("div");
  root.appendChild(host);
  const reportsHost = el("div", { style: "margin-top:18px" });
  root.appendChild(reportsHost);

  function draw() {
    const all = families().map((f) => ({ f, t: familyTotals(f) }));
    const q = (search.value || "").toLowerCase();
    const rows = all.filter(({ f }) => !q || `${f.familyId} ${f.parentName} ${f.phone}`.toLowerCase().includes(q));
    const totalOutstanding = all.reduce((a, x) => a + x.t.outstanding, 0);
    const totalPaid = all.reduce((a, x) => a + x.t.payments, 0);

    statHost.innerHTML = "";
    statHost.append(
      statCard("\uD83D\uDC6A", all.length, "Families"),
      statCard("\uD83D\uDCB0", naira(totalPaid), "Total Collected"),
      statCard("\u26A0\uFE0F", naira(totalOutstanding), "Total Outstanding")
    );

    host.innerHTML = "";
    host.appendChild(card("", [table([
      { label: "Family ID", key: "id2", render: ({ f }) => f.familyId },
      { label: "Parent / Guardian", render: ({ f }) => f.parentName || "\u2014" },
      { label: "Phone", render: ({ f }) => f.phone || "\u2014" },
      { label: "Children", align: "center", render: ({ t }) => String(t.children) },
      { label: "Charges", align: "right", render: ({ t }) => naira(t.totalCharges) },
      { label: "Paid", align: "right", render: ({ t }) => naira(t.payments) },
      { label: "Outstanding", align: "right", render: ({ t }) => naira(t.outstanding) },
      { label: "", render: ({ f }) => btn("Open", { sm: true, variant: "primary", onclick: () => ctx.go("family", f.id) }) }
    ], rows, { empty: "No families yet. Use \u201CAuto-group Existing\u201D to build families from admitted students, or add one manually." })]));

    drawReports(reportsHost, all, ctx);
  }
  draw();
  search.oninput = debounce(draw, 200);
  const offF = db.on("families", draw);
  const offI = db.on("invoices", draw);
  const offR = db.on("receipts", draw);
  const offS = db.on("students", draw);
  return () => { offF(); offI(); offR(); offS(); };
}

function drawReports(hostEl, all, ctx) {
  const debtors = all.filter((x) => x.t.outstanding > 0).sort((a, b) => b.t.outstanding - a.t.outstanding).slice(0, 10);
  const paid = all.filter((x) => x.t.children > 0 && x.t.outstanding <= 0);
  const open = (x) => ctx.go("family", x.f.id);
  hostEl.innerHTML = "";
  hostEl.appendChild(card("Top Outstanding Families", [table([
    { label: "Family", render: (x) => `${x.f.familyId} \u2014 ${x.f.parentName || ""}` },
    { label: "Children", align: "center", render: (x) => String(x.t.children) },
    { label: "Outstanding", align: "right", render: (x) => naira(x.t.outstanding) },
    { label: "", render: (x) => btn("Open", { sm: true, onclick: () => open(x) }) }
  ], debtors, { empty: "No outstanding families. \uD83C\uDF89" })]));
  hostEl.appendChild(card("Fully Paid Families (Zero Balance)", [table([
    { label: "Family", render: (x) => `${x.f.familyId} \u2014 ${x.f.parentName || ""}` },
    { label: "Children", align: "center", render: (x) => String(x.t.children) },
    { label: "Paid", align: "right", render: (x) => naira(x.t.payments) },
    { label: "", render: (x) => btn("Open", { sm: true, onclick: () => open(x) }) }
  ], paid, { empty: "No fully-paid families yet." })]));
}

// ---------------- Detail ----------------
function renderDetail(root, ctx, family, opts = {}) {
  const readOnly = !!opts.readOnly;
  const draw = () => {
    root.innerHTML = "";
    const totals = familyTotals(family);
    const students = familyStudents(family);

    const actions = [
      ...(readOnly ? [] : [btn("\u2190 All Families", { onclick: () => ctx.go("family") }), btn("Edit", { icon: "\u270F\uFE0F", onclick: () => familyForm(family, draw) })]),
      ...(readOnly ? [] : [btn("Generate Family Invoice", { variant: "success", onclick: () => generateFamilyInvoice(family, ctx, draw) })]),
      btn("Family Invoice", { onclick: () => printFamilyInvoice(family) }),
      btn("Statement", { variant: "primary", onclick: () => statementDialog(family) })
    ];
    root.appendChild(pageHead(`${family.familyId} \u2014 ${family.parentName || "Family"}`,
      `${family.phone || ""}${family.address ? "  \u2022  " + family.address : ""}`, actions));

    // Dashboard
    const stat = el("div", { class: "stat-grid", style: "margin-bottom:14px" });
    stat.append(
      statCard("\uD83D\uDCDA", naira(totals.totalCharges), "Total Charges"),
      statCard("\uD83D\uDCB0", naira(totals.payments), "Total Payments"),
      statCard("\u26A0\uFE0F", naira(totals.outstanding), "Outstanding"),
      statCard("\uD83C\uDFF7\uFE0F", naira(totals.discount + totals.scholarship), "Discount + Scholarship"),
      statCard("\uD83D\uDD52", totals.lastPayment ? fmtDate(totals.lastPayment) : "\u2014", "Last Payment")
    );
    root.appendChild(stat);

    const disc = discountPercentFor(totals.children);
    if (disc > 0) root.appendChild(el("div", { class: "note", style: "margin-bottom:14px", html: `<b>Family discount:</b> ${totals.children} children qualify for <b>${disc}%</b>. Apply it as a discount on each child's invoice at the Accounts office.` }));

    // Actions
    if (!readOnly) {
      root.appendChild(el("div", { class: "row", style: "margin-bottom:14px;gap:8px" }, [
        btn("Record Family Payment", { variant: "success", icon: "\uD83D\uDCB5", onclick: () => paymentDialog(family, ctx, draw) }),
        btn("Add Child", { icon: "\u2795", onclick: () => addChildDialog(family, draw) })
      ]));
    }

    // Children
    root.appendChild(card("Children", [table([
      { label: "Adm No", render: (s) => s.admissionNo || "\u2014" },
      { label: "Name", key: "fullName" },
      { label: "Class", render: (s) => cfg.className(s.classId) || "\u2014" },
      { label: "Charges", align: "right", render: (s) => naira(childTotals(s).charges) },
      { label: "Paid", align: "right", render: (s) => naira(childTotals(s).paid) },
      { label: "Balance", align: "right", render: (s) => naira(childTotals(s).balance) },
      ...(readOnly ? [] : [{ label: "", render: (s) => btn("Unlink", { sm: true, onclick: async () => {
        if (await confirmDialog(`Remove ${s.fullName} from this family?`)) { unlinkStudent(family, s.id); draw(); }
      } }) }])
    ], students, { empty: "No children linked. Use \u201CAdd Child\u201D." })]));

    // Ledger
    const txns = buildLedger(family);
    root.appendChild(card("Family Ledger (chronological)", [table([
      { label: "Date", render: (t) => fmtDate(t.date) },
      { label: "Student", key: "student" },
      { label: "Description", render: (t) => t.description + (t.ref ? ` (${t.ref})` : "") },
      { label: "Debit", align: "right", render: (t) => t.debit ? naira(t.debit) : "" },
      { label: "Credit", align: "right", render: (t) => t.credit ? naira(t.credit) : "" },
      { label: "Balance", align: "right", render: (t) => naira(t.balance) }
    ], txns, { empty: "No transactions yet." })]));

    // Payment history (Grouped by time for Family Receipts)
    const pays = txns.filter((t) => t.type === "payment");
    const payGroups = [];
    pays.forEach(p => {
       const existing = payGroups.find(g => Math.abs(g.date - p.date) < 60000); // group within 1 min
       if (existing) { existing.pays.push(p); existing.total += p.credit; }
       else payGroups.push({ date: p.date, total: p.credit, pays: [p] });
    });
    
    root.appendChild(card("Payment History", [table([
      { label: "Date", render: (g) => fmtDate(g.date) },
      { label: "Children Allocated", align: "center", render: (g) => String(g.pays.length) },
      { label: "Total Amount", align: "right", render: (g) => naira(g.total) },
      { label: "", render: (g) => btn("Family Receipt", { sm: true, onclick: () => {
         const receipts = g.pays.map(p => db.find("receipts", x => x.receiptNo === p.ref)).filter(Boolean);
         if (!receipts.length) return toast("Receipts not found", "error");
         showFamilyReceipt(family, receipts, g.date, receipts[0].cashier);
      } }) }
    ], payGroups.sort((a,b) => b.date - a.date), { empty: "No payments recorded." })]));

    const famInvs = db.query("familyInvoices", (i) => i.familyId === family.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    root.appendChild(card("Generated Family Invoices", [table([
      { label: "Invoice No", key: "invoiceNo" },
      { label: "Date", render: (i) => fmtDate(i.createdAt) },
      { label: "Children", align: "center", render: (i) => String((i.children || []).length) },
      { label: "Total", align: "right", render: (i) => naira(i.totalAmount) },
      { label: "Paid", align: "right", render: (i) => naira(i.amountPaid) },
      { label: "Outstanding", align: "right", render: (i) => naira(i.balance) },
      { label: "Status", key: "status" },
      { label: "", render: (i) => btn("Open", { sm: true, onclick: () => previewFamilyInvoice(family, i) }) }
    ], famInvs, { empty: "No family invoice has been generated yet." })]));
  };
  draw();
  const offI = db.on("invoices", draw);
  const offR = db.on("receipts", draw);
  const offFI = db.on("familyInvoices", draw);
  return () => { offI(); offR(); offFI(); };
}

function childTotals(s) {
  let charges = 0, paid = 0, balance = 0;
  invoiceForStudent(s.id).forEach((inv) => {
    charges += (inv.services || []).reduce((a, x) => a + num(x.amount), 0) - num(inv.discount) - num(inv.scholarship);
    paid += num(inv.amountPaid); balance += num(inv.balance);
  });
  return { charges, paid, balance };
}

function openReceiptByNo(receiptNo) {
  const r = db.find("receipts", (x) => x.receiptNo === receiptNo);
  if (r) showReceipt(r.id); else toast("Receipt not found", "error");
}

// ---------------- Family invoice / statement ----------------
function familyInvoiceData(family) {
  const totals = familyTotals(family);
  const students = familyStudents(family).map((s) => {
    const ct = childTotals(s);
    const gross = invoiceForStudent(s.id).reduce((a, inv) => a + (inv.services || []).reduce((b, x) => b + num(x.amount), 0), 0);
    return { fullName: s.fullName, classId: s.classId, charges: gross, paid: ct.paid, balance: ct.balance };
  });
  return { totals, students };
}

function familyInvoiceRowsFromRecord(invoice) {
  return (invoice.children || []).map((c) => ({
    fullName: c.studentName,
    classId: c.classId,
    charges: c.totalAmount,
    paid: c.amountPaid,
    balance: c.balance,
    invoiceNo: c.invoiceNo,
    term: c.term
  }));
}

function previewFamilyInvoice(family, invoice) {
  const totals = {
    children: (invoice.children || []).length,
    gross: num(invoice.grossAmount),
    discount: num(invoice.discount),
    scholarship: num(invoice.scholarship),
    totalCharges: num(invoice.totalAmount),
    payments: num(invoice.amountPaid),
    outstanding: num(invoice.balance)
  };
  const html = familyInvoiceDoc(family, familyInvoiceRowsFromRecord(invoice), totals, invoice);
  const body = el("div", { class: "doc-preview" });
  body.innerHTML = `<div style="font-family:Arial">${html}</div>`;
  const m = modal({ title: `Family Invoice ${invoice.invoiceNo}`, size: "lg", body, footer: [
    btn("Print", { onclick: () => printHtml(html, { title: "Family Invoice " + invoice.invoiceNo }) }),
    btn("Download PDF", { onclick: () => downloadPdf(html, { title: "Family Invoice " + invoice.invoiceNo, filename: `${invoice.invoiceNo}.pdf` }) }),
    btn("Send via WhatsApp", { variant: "success", icon: "💬", onclick: () => shareDocumentToWhatsApp(html, { title: "Family Invoice " + invoice.invoiceNo, filename: `${invoice.invoiceNo}.png` }) }),
    btn("Close", { variant: "primary", onclick: () => m.close() })
  ] });
}

function generateFamilyInvoice(family, ctx, after) {
  try {
    const { invoice } = createFamilyInvoice(family, ctx.user?.email || ctx.user?.name || "");
    db.save("auditLogs", { id: "family-inv-" + invoice.id, type: "familyInvoice", uid: ctx.user.uid, at: Date.now(), message: `Generated family invoice ${invoice.invoiceNo} for ${family.familyId}` });
    toast(`Family invoice ${invoice.invoiceNo} generated`, "success");
    after && after();
    previewFamilyInvoice(family, invoice);
  } catch (e) {
    toast(e.message || "Family invoice could not be generated", "error", 5000);
  }
}

function printFamilyInvoice(family) {
  const { totals, students } = familyInvoiceData(family);
  const html = familyInvoiceDoc(family, students, totals, null);
  const body = el("div", { class: "doc-preview" });
  body.innerHTML = `<div style="font-family:Arial">${html}</div>`;
  const m = modal({ title: `Family Invoice \u2014 ${family.familyId}`, size: "lg", body, footer: [
    btn("Print", { onclick: () => printHtml(html, { title: "Family Invoice " + family.familyId }) }),
    btn("Download PDF", { onclick: () => downloadPdf(html, { title: "Family Invoice " + family.familyId, filename: `FamilyInvoice_${family.familyId}.pdf` }) }),
    btn("Send via WhatsApp", { variant: "success", icon: "💬", onclick: () => shareDocumentToWhatsApp(html, { title: "Family Invoice " + family.familyId, filename: `FamilyInvoice_${family.familyId}.png` }) }),
    btn("Close", { variant: "primary", onclick: () => m.close() })
  ] });
}

function statementDialog(family) {
  const body = el("div");
  const range = select(() => [
    { value: "all", label: "All Time" }, { value: "today", label: "Today" },
    { value: "month", label: "This Month" }, { value: "session", label: "This Session (Sept\u2013Aug)" },
    { value: "custom", label: "Custom Range" }
  ]);
  const from = input({ type: "date" });
  const to = input({ type: "date" });
  const customRow = el("div", { class: "form-grid", style: "display:none" }, [field("From", from), field("To", to)]);
  range.onchange = () => { customRow.style.display = range.value === "custom" ? "" : "none"; };
  body.append(field("Period", range), customRow);
  const m = modal({ title: `Statement \u2014 ${family.familyId}`, body, footer: [
    btn("Generate", { variant: "primary", onclick: () => {
      const { lo, hi, label } = resolveRange(range.value, from.value, to.value);
      const totals = familyTotals(family);
      const txns = buildLedger(family).filter((t) => (!lo || t.date >= lo) && (!hi || t.date <= hi));
      const html = familyStatementDoc(family, totals, txns, label);
      m.close();
      const pv = el("div", { class: "doc-preview" }); pv.innerHTML = `<div style="font-family:Arial">${html}</div>`;
      const m2 = modal({ title: `Statement \u2014 ${family.familyId}`, size: "lg", body: pv, footer: [
        btn("Print", { onclick: () => printHtml(html, { title: "Family Statement " + family.familyId }) }),
        btn("Download PDF", { onclick: () => downloadPdf(html, { title: "Family Statement " + family.familyId, filename: `Statement_${family.familyId}.pdf` }) }),
        btn("Send via WhatsApp", { variant: "success", icon: "💬", onclick: () => shareDocumentToWhatsApp(html, { title: "Family Statement " + family.familyId, filename: `Statement_${family.familyId}.png` }) }),
        btn("Close", { variant: "primary", onclick: () => m2.close() })
      ] });
    } }),
    btn("Cancel", { onclick: () => m.close() })
  ] });
}

function resolveRange(kind, fromVal, toVal) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (kind === "today") return { lo: startOfDay(now), hi: now.getTime(), label: "Today" };
  if (kind === "month") return { lo: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), hi: now.getTime(), label: "This Month" };
  if (kind === "session") { const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1; return { lo: new Date(y, 8, 1).getTime(), hi: now.getTime(), label: `Session ${y}/${y + 1}` }; }
  if (kind === "custom") return { lo: fromVal ? new Date(fromVal).getTime() : 0, hi: toVal ? new Date(toVal).getTime() + 86399000 : now.getTime(), label: `${fromVal || "\u2026"} to ${toVal || "\u2026"}` };
  return { lo: 0, hi: now.getTime(), label: "All Time" };
}

// ---------------- Payment allocation ----------------
function paymentDialog(family, ctx, after) {
  const outs = outstandingInvoices(family);
  if (!outs.length) return toast("No outstanding balances for this family.", "info");
  const body = el("div");
  const mode = select(() => [{ value: "auto", label: "Auto \u2014 oldest debt first" }, { value: "manual", label: "Manual \u2014 split per child" }]);
  const amount = input({ type: "number", min: "0", placeholder: "Total amount received" });
  const cashier = input({ value: ctx.user?.name || ctx.user?.email || "" });
  const autoBox = el("div", {}, [field("Amount Received", amount)]);
  const manualBox = el("div", { style: "display:none" });
  const manualInputs = {};
  outs.forEach(({ inv, student }) => {
    const inp = input({ type: "number", min: "0", max: String(inv.balance), placeholder: "0" });
    manualInputs[inv.id] = inp;
    manualBox.appendChild(field(`${student.fullName} \u2014 ${inv.invoiceNo} (bal ${naira(inv.balance)})`, inp));
  });
  mode.onchange = () => { const man = mode.value === "manual"; autoBox.style.display = man ? "none" : ""; manualBox.style.display = man ? "" : "none"; };
  body.append(field("Allocation", mode), autoBox, manualBox, field("Received By", cashier));


  const m = modal({ title: `Family Payment \u2014 ${family.familyId}`, body, footer: [
    btn("Record Payment", { variant: "success", onclick: async () => {
      try {
        const manual = {}; Object.entries(manualInputs).forEach(([id, inp]) => manual[id] = num(inp.value));
        const receipts = await allocateFamilyPayment(family, { amount: num(amount.value), mode: mode.value, manual, cashier: cashier.value });
        if (!receipts.length) return toast("Nothing allocated. Enter an amount.", "error");
        db.save("auditLogs", { type: "familyPayment", uid: ctx.user.uid, at: Date.now(), message: `Family payment ${family.familyId}: ${receipts.length} receipt(s)` });
        m.close();
        toast(`Recorded ${receipts.length} payment(s) across the family`, "success", 4000);
        after && after();
        showFamilyReceipt(family, receipts, receipts[0].date, cashier.value);
      } catch (e) { toast(e.message || "Payment failed", "error", 5000); }
    } }),
    btn("Cancel", { onclick: () => m.close() })
  ] });
}

function showFamilyReceipt(family, receipts, date, cashier) {
  const html = familyReceiptDoc(family, receipts, date, cashier);
  const body = el("div", { class: "doc-preview" });
  body.innerHTML = `<div style="font-family:Arial">${html}</div>`;
  const tsStr = new Date(date).getTime();
  const m = modal({ title: `Family Payment Receipt \u2014 ${family.familyId}`, size: "lg", body, footer: [
    btn("Print", { onclick: () => printHtml(html, { title: "Family Receipt " + family.familyId }) }),
    btn("Download Image", { onclick: () => downloadImage(html, { title: "Family Receipt " + family.familyId, filename: `FamilyReceipt_${family.familyId}_${tsStr}.png` }) }),
    btn("Send via WhatsApp", { variant: "success", icon: "💬", onclick: () => shareDocumentToWhatsApp(html, { title: "Family Receipt " + family.familyId, filename: `FamilyReceipt_${family.familyId}_${tsStr}.png` }) }),
    btn("Close", { variant: "primary", onclick: () => m.close() })
  ] });
}

// ---------------- Family create/edit + add child ----------------
function familyForm(existing, after) {
  const f = existing || {};
  const body = el("div", { class: "form-grid" });
  const parentName = input({ value: f.parentName || "", placeholder: "Parent / Guardian Name" });
  const phone = input({ value: f.phone || "", placeholder: "Primary Phone" });
  const altPhone = input({ value: f.altPhone || "", placeholder: "Alternative Phone" });
  const email = input({ value: f.email || "", placeholder: "Email" });
  const address = input({ value: f.address || "", placeholder: "Address" });
  const occupation = input({ value: f.occupation || "", placeholder: "Occupation" });
  const nationality = input({ value: f.nationality || "", placeholder: "Nationality" });
  const status = select(() => ["Active", "Inactive"].map((s) => ({ value: s, label: s, selected: (f.status || "Active") === s })));
  body.append(
    field("Parent / Guardian", parentName), field("Status", status),
    field("Primary Phone", phone), field("Alternative Phone", altPhone),
    field("Email", email), field("Occupation", occupation),
    field("Nationality", nationality), field("Address", address, { full: true })
  );

  let beneficiarySel = null;
  if (existing && existing.id) {
     const famStudents = db.query("students", s => s.familyId === existing.id && s.status === "active");
     if (famStudents.length >= 5) {
        const opts = [{ value: "", label: "Auto (Lowest Tuition)" }, ...famStudents.map(s => ({ value: s.id, label: s.fullName, selected: s.id === f.freeTuitionBeneficiaryId }))];
        beneficiarySel = select(() => opts);
        body.appendChild(field("100% Free Tuition Beneficiary", beneficiarySel, { full: true }));
     }
  }

  const m = modal({ title: existing ? "Edit Family" : "New Family", body, footer: [
    btn("Save", { variant: "primary", onclick: async () => {
      if (!parentName.value.trim()) return toast("Enter parent name", "error");
      let rec = existing;
      if (!rec) { const { nextFamilyId } = await import("../core/idgen.js"); rec = { familyId: await nextFamilyId(new Date().getFullYear()), studentIds: [] }; }
      Object.assign(rec, { parentName: parentName.value.trim(), phone: phone.value.trim(), altPhone: altPhone.value.trim(),
        email: email.value.trim(), address: address.value.trim(), occupation: occupation.value.trim(),
        nationality: nationality.value.trim(), status: status.value });
      if (beneficiarySel) rec.freeTuitionBeneficiaryId = beneficiarySel.value;
      db.save("families", rec);
      m.close(); toast("Family saved", "success"); after && after();
    } }),
    btn("Cancel", { onclick: () => m.close() })
  ] });
}

function addChildDialog(family, after) {
  const candidates = db.list("students").filter((s) => s.familyId !== family.id && !(family.studentIds || []).includes(s.id));
  const body = el("div");
  
  const searchInput = input({ placeholder: "Type to search name, admission no, or phone...", style: "margin-bottom:12px;width:100%;font-size:16px;padding:10px" });
  
  const listContainer = el("div", { style: "max-height: 250px; overflow-y: auto; border: 1px solid var(--border); border-radius: 4px; padding: 4px" });
  body.append(searchInput, listContainer);

  const drawList = (query) => {
      listContainer.innerHTML = "";
      const q = (query || "").toLowerCase();
      let matches = candidates;
      if (q) {
          matches = candidates.filter(s => (s.fullName || "").toLowerCase().includes(q) || (s.admissionNo || "").toLowerCase().includes(q) || (s.studentPhone || "").toLowerCase().includes(q));
      }
      matches = matches.slice(0, 50); // limit to 50 for performance
      
      if (matches.length === 0) {
          listContainer.appendChild(el("div", { class: "muted", style: "padding: 10px; text-align: center" }, [
              el("div", { text: "No matching students found." }),
              btn("Register New Student", { variant: "primary", sm: true, style: "margin-top:8px", onclick: () => { m.close(); window.location.hash = "/admission"; } })
          ]));
          return;
      }
      
      matches.forEach(s => {
          const row = el("div", { style: "display:flex; justify-content:space-between; align-items:center; padding: 8px; border-bottom: 1px solid var(--border); cursor: pointer" });
          row.onmouseover = () => row.style.background = "var(--bg-card)";
          row.onmouseout = () => row.style.background = "";
          
          row.appendChild(el("div", {}, [
              el("div", { text: s.fullName, style: "font-weight: 600" }),
              el("div", { class: "muted", style: "font-size: 11px", text: `${s.admissionNo || 'No Adm No'} — ${s.classId || 'No Class'}` })
          ]));
          row.appendChild(btn("Link", { variant: "primary", sm: true, onclick: () => {
              linkStudent(family, s); 
              m.close(); 
              toast(`${s.fullName} linked to family`, "success"); 
              after && after();
          }}));
          listContainer.appendChild(row);
      });
  };

  searchInput.oninput = () => drawList(searchInput.value);
  drawList("");

  const m = modal({ title: `Add Child to Family \u2014 ${family.familyId}`, body, footer: [
    btn("Register New Student", { onclick: () => { m.close(); window.location.hash = "/admission"; } }),
    btn("Cancel", { onclick: () => m.close() })
  ] });
}

