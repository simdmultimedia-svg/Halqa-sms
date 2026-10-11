// Manual financial documents for walk-in customers and prospective students.
// These records deliberately reuse the invoice/receipt collections so they are
// retained, synced, and audited in the same way as normal school billing.
import { db } from "../core/db.js";
import { el, toast, naira, fmtDate, escapeHtml, num, uuid, modal } from "../core/utils.js";
import { card, pageHead, table, btn, input, textarea, select, field } from "../core/ui.js";
import { invoiceDoc, receiptDoc } from "../core/documents.js";
import { previewHtml, downloadPdf } from "../core/print.js";
import { calculateInvoiceTotal, calculateLineTotal, calculateTotalPaid, calculateOutstandingBalance, roundCurrency } from "../core/calculations.js";
import { nextInvoiceNo, nextReceiptNo } from "../core/idgen.js";
import * as cfg from "../core/config.js";
import { getBranding } from "../core/branding.js";

const manualInvoices = () => db.list("invoices").filter(i => i.manual === true);
const manualReceipts = () => db.list("receipts").filter(r => r.manual === true);
const personName = record => record.studentName || record.customerName || "Walk-in Customer";
const money = value => roundCurrency(num(value));

function compactDocument(record, type) {
  const b = getBranding();
  const isInvoice = type === "invoice";
  const items = isInvoice ? (record.services || []) : [{ name: record.description || `Amount Paid (${record.paymentType || "Payment"})`, amount: record.amount }];
  const rows = items.slice(0, 5).map(item => `<tr><td>${escapeHtml(item.name || "Item")}</td><td class="right">${naira(calculateLineTotal(item))}</td></tr>`).join("") || "<tr><td colspan=\"2\">No items</td></tr>";
  const total = isInvoice ? record.totalAmount : record.amount;
  const number = isInvoice ? record.invoiceNo : record.receiptNo;
  const balance = isInvoice ? record.balance : record.balance;
  return `<article class="manual-compact-doc">
    <header><div class="manual-logo">${b.logoBase64 ? `<img src="${b.logoBase64}" alt="">` : ""}</div><div><strong>${escapeHtml(b.schoolName || "School")}</strong><small>${escapeHtml(b.address || "")}</small><small>${escapeHtml(b.phone || "")}</small></div></header>
    <div class="manual-compact-title">${isInvoice ? "SCHOOL INVOICE" : "PAYMENT RECEIPT"}</div>
    <div class="manual-compact-meta"><span><b>No:</b> ${escapeHtml(number || "")}</span><span><b>Date:</b> ${fmtDate(record.createdAt || record.date)}</span></div>
    <div class="manual-compact-name"><b>${isInvoice ? "Bill to" : "Received from"}:</b> ${escapeHtml(personName(record))}</div>
    <table><tr><th>Description</th><th class="right">Amount</th></tr>${rows}<tr class="total"><td>${isInvoice ? "Total payable" : "Amount received"}</td><td class="right">${naira(total)}</td></tr>${isInvoice ? `<tr><td>Balance</td><td class="right">${naira(balance)}</td></tr>` : ""}</table>
    <footer>${isInvoice ? "Please use the document number as payment reference." : "Thank you for your payment."}</footer>
  </article>`;
}

function sixUpHtml(documents) {
  const pages = [];
  for (let i = 0; i < documents.length; i += 6) {
    const cells = documents.slice(i, i + 6).map(d => `<div class="manual-six-slot">${compactDocument(d.record, d.type)}</div>`).join("");
    pages.push(`<section class="manual-six-sheet">${cells}</section>`);
  }
  return `<style>
    @page { size:A4 portrait; margin:10mm; }
    .manual-six-sheet{width:190mm;min-height:277mm;display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(3,1fr);gap:4mm;page-break-after:always;break-after:page}
    .manual-six-sheet:last-child{page-break-after:auto;break-after:auto}.manual-six-slot{border:1px dashed #94a3b8;padding:2.5mm;overflow:hidden}
    .manual-compact-doc{height:100%;font:8px/1.25 Arial,sans-serif;color:#172033}.manual-compact-doc header{display:flex;gap:3mm;align-items:center;border-bottom:1px solid #123f7a;padding-bottom:2mm}.manual-logo{width:11mm;height:11mm}.manual-logo img{max-width:100%;max-height:100%;object-fit:contain}.manual-compact-doc header strong{display:block;color:#123f7a;font-size:10px}.manual-compact-doc header small{display:block;font-size:6.5px;line-height:1.15}.manual-compact-title{text-align:center;font-size:10px;font-weight:800;color:#123f7a;margin:2mm 0 1mm}.manual-compact-meta{display:flex;justify-content:space-between;font-size:7px}.manual-compact-name{margin:1.5mm 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.manual-compact-doc table{width:100%;border-collapse:collapse;margin:0;font-size:7.5px}.manual-compact-doc th,.manual-compact-doc td{border:1px solid #9aa8bd;padding:1mm}.manual-compact-doc th{background:#e9eefb}.manual-compact-doc .right{text-align:right}.manual-compact-doc .total{font-weight:800}.manual-compact-doc footer{font-size:6.5px;text-align:center;margin-top:2mm;color:#526070}
  </style>${pages.join("")}`;
}

function eightyMillimetreReceipt(record) {
  return `<style>@page{size:80mm auto;margin:3mm}.doc{width:80mm!important;max-width:80mm!important;padding:0!important}.manual-compact-doc{width:74mm;min-height:auto;font-size:10px}.manual-compact-doc header strong{font-size:12px}.manual-compact-title{font-size:12px}.manual-compact-doc table{font-size:9px}.manual-compact-doc th,.manual-compact-doc td{padding:1.4mm}</style>${compactDocument(record, "receipt")}`;
}

function lineEditor(lines, onChange) {
  const host = el("div", { style: "display:grid;gap:8px" });
  const draw = () => {
    host.innerHTML = "";
    lines.forEach((line, index) => {
      const name = input({ value: line.name, placeholder: "Description", style: "min-width:180px;flex:1" });
      const qty = input({ type: "number", min: "1", step: "1", value: line.quantity, style: "width:80px" });
      const price = input({ type: "number", min: "0", step: "0.01", value: line.unitPrice, placeholder: "Unit price", style: "width:125px" });
      const total = el("strong", { text: naira(calculateLineTotal(line)), style: "min-width:105px;text-align:right" });
      const update = () => { line.name = name.value; line.quantity = Math.max(1, num(qty.value)); line.unitPrice = Math.max(0, num(price.value)); total.textContent = naira(calculateLineTotal(line)); onChange(); };
      name.oninput = qty.oninput = price.oninput = update;
      host.appendChild(el("div", { class: "row", style: "gap:8px;align-items:center;flex-wrap:wrap" }, [name, qty, price, total, btn("Remove", { sm: true, variant: "danger", onclick: () => { if (lines.length === 1) return toast("An invoice needs at least one item.", "error"); lines.splice(index, 1); draw(); onChange(); } })]));
    });
  };
  draw();
  return { host, refresh: draw };
}

function invoiceForm(ctx, afterSave) {
  const customer = input({ placeholder: "Full name or organisation" });
  const phone = input({ placeholder: "Phone number" });
  const address = textarea({ placeholder: "Address (optional)", rows: 2 });
  const reference = input({ placeholder: "Customer reference (optional)" });
  const notes = textarea({ placeholder: "Notes / payment instruction (optional)", rows: 2 });
  const lines = [{ id: uuid(), name: "Service charge", quantity: 1, unitPrice: 0 }];
  const total = el("strong", { text: naira(0), style: "font-size:18px;color:var(--primary,#123f7a)" });
  const recalc = () => { total.textContent = naira(calculateInvoiceTotal(lines)); };
  const editor = lineEditor(lines, recalc);
  const body = el("div", { style: "display:grid;gap:12px" }, [
    el("div", { class: "form-grid" }, [field("Customer / Recipient *", customer), field("Phone", phone), field("Address", address, { full: true }), field("Reference", reference, { full: true })]),
    field("Invoice items *", editor.host, { full: true }),
    btn("+ Add item", { sm: true, onclick: () => { lines.push({ id: uuid(), name: "", quantity: 1, unitPrice: 0 }); editor.refresh(); recalc(); } }),
    field("Notes", notes, { full: true }), el("div", { style: "text-align:right" }, [document.createTextNode("Invoice total: "), total])
  ]);
  const m = modal({ title: "Create Manual Invoice", size: "lg", body, footer: [btn("Create Invoice", { variant: "primary", onclick: async () => {
    const services = lines.map(line => ({ ...line, name: line.name.trim(), quantity: Math.max(1, num(line.quantity)), unitPrice: Math.max(0, num(line.unitPrice)) })).filter(line => line.name && line.unitPrice >= 0);
    if (!customer.value.trim()) return toast("Enter the customer or recipient name.", "error");
    if (!services.length || calculateInvoiceTotal(services) <= 0) return toast("Add at least one invoice item with an amount.", "error");
    const now = Date.now(); const invoiceNo = await nextInvoiceNo(); const gross = calculateInvoiceTotal(services);
    const inv = { id: uuid(), manual: true, invoiceNo, studentId: "", studentName: customer.value.trim(), customerName: customer.value.trim(), customerPhone: phone.value.trim(), customerAddress: address.value.trim(), customerReference: reference.value.trim(), notes: notes.value.trim(), manualLabel: "Manual billing", services, grossAmount: gross, totalAmount: gross, amountPaid: 0, balance: gross, status: "UNPAID", payments: [], type: "Manual Invoice", session: cfg.currentSession(), term: cfg.currentTerm(), createdAt: now };
    db.save("invoices", inv); toast(`Manual invoice ${invoiceNo} created.`, "success"); m.close(); afterSave?.(inv);
  } })] });
}

function receiptForm(ctx, afterSave) {
  const customer = input({ placeholder: "Full name or organisation" }); const phone = input({ placeholder: "Phone number" });
  const reference = input({ placeholder: "Reference (optional)" }); const amount = input({ type: "number", min: "0", step: "0.01", placeholder: "0.00" });
  const paymentType = select(["Cash", "Bank Transfer", "POS", "Online Payment", "Other"].map(v => ({ value: v, label: v })));
  const description = input({ placeholder: "Payment description" });
  const invoiceSelect = select(() => [{ value: "", label: "No linked invoice (standalone receipt)" }, ...manualInvoices().filter(i => num(i.balance) > 0).sort((a,b) => b.createdAt-a.createdAt).map(i => ({ value: i.id, label: `${i.invoiceNo} — ${personName(i)} (${naira(i.balance)} due)` }))]);
  invoiceSelect.onchange = () => { const inv = db.get("invoices", invoiceSelect.value); if (inv) { customer.value = personName(inv); phone.value = inv.customerPhone || ""; reference.value = inv.customerReference || ""; amount.value = inv.balance; description.value = `Payment for invoice ${inv.invoiceNo}`; } };
  const body = el("div", { class: "form-grid" }, [field("Link to manual invoice", invoiceSelect, { full: true }), field("Customer / Recipient *", customer), field("Phone", phone), field("Amount received (₦) *", amount), field("Payment method", paymentType), field("Reference", reference), field("Description", description, { full: true })]);
  const m = modal({ title: "Create Manual Receipt", size: "lg", body, footer: [btn("Create Receipt", { variant: "success", onclick: async () => {
    const paid = money(amount.value); const inv = invoiceSelect.value ? db.get("invoices", invoiceSelect.value) : null;
    if (!customer.value.trim()) return toast("Enter the customer or recipient name.", "error"); if (paid <= 0) return toast("Enter a valid payment amount.", "error"); if (inv && paid > num(inv.balance)) return toast("Amount exceeds the linked invoice balance.", "error");
    const now = Date.now(); const receiptNo = await nextReceiptNo();
    const receipt = { id: uuid(), manual: true, receiptNo, invoiceId: inv?.id || "", invoiceNo: inv?.invoiceNo || "", studentId: "", studentName: customer.value.trim(), customerName: customer.value.trim(), customerPhone: phone.value.trim(), customerReference: reference.value.trim(), amount: paid, paymentType: paymentType.value, description: description.value.trim(), balance: 0, totalBill: inv?.totalAmount || paid, cashier: ctx.user?.name || ctx.user?.email || "", date: now, createdAt: now };
    if (inv) { inv.payments = [...(inv.payments || []), { receiptNo, amount: paid, date: now }]; inv.amountPaid = calculateTotalPaid(inv.payments); inv.balance = calculateOutstandingBalance(inv.totalAmount, inv.amountPaid); inv.status = inv.balance === 0 ? "PAID" : "PARTIALLY PAID"; db.save("invoices", inv); receipt.balance = inv.balance; }
    db.save("receipts", receipt); db.save("payments", { id: receipt.id, ...receipt }); toast(`Manual receipt ${receiptNo} created.`, "success"); m.close(); afterSave?.(receipt);
  } })] });
}

function documentActions(record, type) {
  const html = type === "invoice" ? invoiceDoc(record, null) : receiptDoc(record, null, record.invoiceId ? db.get("invoices", record.invoiceId) : null);
  return el("div", { class: "row", style: "gap:6px;flex-wrap:wrap" }, [btn("Preview", { sm: true, onclick: () => previewHtml(html, { title: `${type === "invoice" ? "Invoice" : "Receipt"} ${type === "invoice" ? record.invoiceNo : record.receiptNo}` }) }), btn("PDF", { sm: true, onclick: () => downloadPdf(html, { title: `${type} ${type === "invoice" ? record.invoiceNo : record.receiptNo}` }) }), type === "receipt" ? btn("80 mm", { sm: true, onclick: () => previewHtml(eightyMillimetreReceipt(record), { title: `Receipt ${record.receiptNo} — 80mm` }) }) : null]);
}

export function render(root, ctx) {
  if (ctx.key === "printcenter") return renderPrintCenter(root, ctx);
  root.appendChild(pageHead("Manual Invoice & Receipt", "Create official documents for walk-in customers and prospective students without creating a student account.", [btn("+ Manual Invoice", { variant: "primary", onclick: () => invoiceForm(ctx, () => draw()) }), btn("+ Manual Receipt", { variant: "success", onclick: () => receiptForm(ctx, () => draw()) })]));
  const openPrintCenter = btn("Open Print Center", { onclick: () => { location.hash = "#printcenter"; } });
  root.appendChild(card("How it works", [
    el("div", { class: "muted", text: "Manual documents use the same branded invoice and receipt formats, numbers, cloud sync, and audit trail as student billing. They do not create or change a student record." }),
    el("div", { class: "row", style: "gap:8px;margin-top:10px" }, [openPrintCenter])
  ]));
  const search = input({ placeholder: "Search manual documents…", style: "max-width:360px" }); root.appendChild(el("div", { style: "margin:14px 0" }, [search]));
  const host = el("div"); root.appendChild(host);
  const draw = () => {
    const q = search.value.trim().toLowerCase(); const invs = manualInvoices().filter(x => `${x.invoiceNo} ${personName(x)} ${x.customerPhone || ""}`.toLowerCase().includes(q)).sort((a,b) => b.createdAt-a.createdAt); const recs = manualReceipts().filter(x => `${x.receiptNo} ${personName(x)} ${x.customerPhone || ""}`.toLowerCase().includes(q)).sort((a,b) => (b.date||0)-(a.date||0));
    host.innerHTML = "";
    host.appendChild(card("Manual Invoices", [table([{ label:"Invoice No", key:"invoiceNo" }, { label:"Customer", render: personName }, { label:"Total", align:"right", render:i=>naira(i.totalAmount) }, { label:"Balance", align:"right", render:i=>naira(i.balance) }, { label:"Date", render:i=>fmtDate(i.createdAt) }, { label:"", render:i=>documentActions(i,"invoice") }], invs, { empty:"No manual invoices yet." })]));
    host.appendChild(card("Manual Receipts", [table([{ label:"Receipt No", key:"receiptNo" }, { label:"Customer", render: personName }, { label:"Amount", align:"right", render:r=>naira(r.amount) }, { label:"Invoice", key:"invoiceNo" }, { label:"Date", render:r=>fmtDate(r.date) }, { label:"", render:r=>documentActions(r,"receipt") }], recs, { empty:"No manual receipts yet." })]));
  };
  draw(); search.oninput = draw; const offI = db.on("invoices", draw); const offR = db.on("receipts", draw); return () => { offI(); offR(); };
}

export function renderPrintCenter(root) {
  root.appendChild(pageHead("Print Center", "Print each manual document in its full official format, or select up to six compact documents per A4 page."));
  const selected = new Set(); const host = el("div"); root.appendChild(host);
  const printSelected = () => {
    const docs = Array.from(selected).map(key => { const [type, id] = key.split(":"); const record = db.get(type === "invoice" ? "invoices" : "receipts", id); return record ? { type, record } : null; }).filter(Boolean);
    if (!docs.length) return toast("Select at least one manual document.", "error"); previewHtml(sixUpHtml(docs), { title: `Manual documents — ${docs.length} selected` });
  };
  const draw = () => {
    host.innerHTML = "";
    const docs = [...manualInvoices().map(record => ({ type:"invoice", record })), ...manualReceipts().map(record => ({ type:"receipt", record }))].sort((a,b) => (b.record.createdAt || b.record.date || 0) - (a.record.createdAt || a.record.date || 0));
    const keys = new Set(docs.map(d => `${d.type}:${d.record.id}`));
    [...selected].forEach(key => { if (!keys.has(key)) selected.delete(key); });
    const selectType = (type) => {
      docs.filter(d => d.type === type).forEach(d => selected.add(`${d.type}:${d.record.id}`));
      draw();
    };
    const clearSelection = () => { selected.clear(); draw(); };
    const selectAll = () => { docs.forEach(d => selected.add(`${d.type}:${d.record.id}`)); draw(); };
    const print = btn(`Print selected (${selected.size}) — six per A4`, { variant:"primary", icon:"🖨️", onclick: printSelected });
    const choose = el("div", { class:"row", style:"gap:8px;flex-wrap:wrap" }, [
      btn("Select all", { onclick: selectAll }),
      btn("Select invoices", { onclick: () => selectType("invoice") }),
      btn("Select receipts", { onclick: () => selectType("receipt") }),
      btn("Clear", { variant:"ghost", onclick: clearSelection }), print
    ]);
    const selectionStatus = el("div", { style:"font-weight:700;color:var(--primary,#123f7a)" }, `${selected.size} document${selected.size === 1 ? "" : "s"} selected`);
    const selectCell = (d) => {
      const key = `${d.type}:${d.record.id}`;
      const check = input({ type:"checkbox", checked:selected.has(key), title:`Select ${d.type === "invoice" ? d.record.invoiceNo : d.record.receiptNo}` });
      check.onclick = (event) => event.stopPropagation();
      check.onchange = () => { check.checked ? selected.add(key) : selected.delete(key); draw(); };
      return check;
    };
    host.appendChild(card("Manual print queue", [
      el("div", { class:"row", style:"justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px" }, [selectionStatus, choose]),
      el("div", { class:"muted", style:"margin-bottom:12px", text:"Tick individual rows below, choose a document type, or select all. Only your selected documents are included in the compact A4 print job." }),
      table([{ label:"Select", align:"center", render:selectCell }, { label:"Type", render:d=>d.type === "invoice" ? "School Invoice" : "Payment Receipt" }, { label:"Document No", render:d=>d.type === "invoice" ? d.record.invoiceNo : d.record.receiptNo }, { label:"Customer", render:d=>personName(d.record) }, { label:"Amount", align:"right", render:d=>naira(d.type === "invoice" ? d.record.totalAmount : d.record.amount) }, { label:"Date", render:d=>fmtDate(d.record.createdAt || d.record.date) }, { label:"", render:d=>documentActions(d.record,d.type) }], docs, { empty:"No manual documents available for printing." })
    ]));
  };
  draw(); const offI = db.on("invoices", draw); const offR = db.on("receipts", draw); return () => { offI(); offR(); };
}
