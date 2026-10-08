import { db } from "../core/db.js";
import { el, toast, naira, num, fmtDate, modal } from "../core/utils.js";
import { calculateInvoiceTotal, calculateLineTotal } from "../core/calculations.js";
import { card, pageHead, table, btn, input, field, select, studentPicker } from "../core/ui.js";
import { applyPayment, recalcInvoice, removeService, invoiceForStudent } from "../core/billing.js";
import { can } from "../core/rbac.js";
import { showReceipt } from "./receipts.js";
import { logActivity } from "../core/activity.js";
import * as cfg from "../core/config.js";

export function render(root, ctx) {
  root.appendChild(pageHead("Fees & Payments", "All payments happen here. Select a student to load their invoice and assigned services."));
  if (!can(ctx.user.role, "collectPayment")) {
    root.appendChild(card("Access", [el("p", { class: "muted", text: "Your role can view fees but not collect payments." })]));
  }
  const searchWrap = el("div", { style: "position:relative;" });
  const searchInp = input({ type: "search", placeholder: "Search by name, admission no, phone, or class...", style: "width:100%; padding:10px; font-size:16px;" });
  const resultsDiv = el("div", { style: "position:absolute; top:100%; left:0; right:0; background:#fff; border:1px solid #ccc; z-index:10; max-height:300px; overflow-y:auto; display:none; box-shadow:0 4px 12px rgba(0,0,0,0.15);" });
  
  searchWrap.appendChild(searchInp);
  searchWrap.appendChild(resultsDiv);
  root.appendChild(card("Find Student", [searchWrap]));
  
  const host = el("div");
  root.appendChild(host);

  let allStudents = [];
  
  // Load students asynchronously to not block UI
  import("../core/db.js").then(({ db }) => {
    allStudents = db.list("students").filter(s => s.status !== "graduated");
  });

  searchInp.oninput = () => {
    const q = searchInp.value.toLowerCase().trim();
    resultsDiv.innerHTML = "";
    if (q.length < 2) {
      resultsDiv.style.display = "none";
      return;
    }
    const matches = allStudents.filter(s => {
      const clsName = (cfg.className(s.classId) || "").toLowerCase();
      return (s.fullName || "").toLowerCase().includes(q) ||
             (s.admissionNo || "").toLowerCase().includes(q) ||
             (s.parentPhone || "").toLowerCase().includes(q) ||
             clsName.includes(q);
    }).slice(0, 20); // Limit to 20 results for speed
    
    if (matches.length === 0) {
      resultsDiv.appendChild(el("div", { style: "padding:10px; color:#888;", text: "No students found." }));
    } else {
      matches.forEach(s => {
        const row = el("div", { 
          style: "padding:10px; border-bottom:1px solid #eee; cursor:pointer; display:flex; justify-content:space-between; align-items:center;",
          onclick: () => {
            searchInp.value = s.fullName;
            resultsDiv.style.display = "none";
            loadStudent(s.id);
          }
        });
        row.onmouseover = () => row.style.background = "#f4f6f8";
        row.onmouseout = () => row.style.background = "transparent";
        
        row.appendChild(el("div", {}, [
          el("div", { style: "font-weight:700; color:#111;", text: s.fullName }),
          el("div", { style: "font-size:12px; color:#666;", text: `Admn: ${s.admissionNo} â€¢ Class: ${cfg.className(s.classId)} â€¢ Phone: ${s.parentPhone || "N/A"}` })
        ]));
        
        const invoiceCount = invoiceForStudent(s.id).length;
        row.appendChild(el("div", { style: "font-size:11px; padding:3px 6px; background:#e0e7ff; color:#3730a3; border-radius:4px;", text: `${invoiceCount} Invoice(s)` }));
        
        resultsDiv.appendChild(row);
      });
    }
    resultsDiv.style.display = "block";
  };

  // Close search results when clicking outside
  document.addEventListener("click", (e) => {
    if (!searchWrap.contains(e.target)) resultsDiv.style.display = "none";
  });

  function loadStudent(studentId) {
    const student = db.get("students", studentId);
    const invoices = invoiceForStudent(studentId).filter((i) => i.balance > 0 || i.status !== "PAID");
    const allInvoices = invoiceForStudent(studentId);
    host.innerHTML = "";
    if (!allInvoices.length) { host.appendChild(card("Invoice", [el("p", { class: "muted", text: "No invoice found for this student. Generate one from Admission or Bulk Invoice." })])); return; }
    const inv = invoices[0] || allInvoices[0];
    renderInvoice(student, inv);
  }

  function renderInvoice(student, inv) {
    host.innerHTML = "";
    const canPay = can(ctx.user.role, "collectPayment") && inv.balance > 0 && (inv.payments || []).length < 2;
    const allSvcRows = (inv.services || []).map((s) => ({
      ...s, _remove: s.optional && inv.amountPaid === 0
        ? btn("Remove", { sm: true, variant: "danger", onclick: () => { removeService(inv, s.id); toast("Service removed, bill recalculated"); renderInvoice(student, db.get("invoices", inv.id)); } })
        : el("span", { class: "muted", text: "\u2014" })
    }));

    // Split into Tuition, Books, and Other Services
    const tuitionRows  = allSvcRows.filter(s => (s.name || "").toLowerCase().includes("tuition"));
    const bookRows     = allSvcRows.filter(s => s.type === "book");
    const serviceRows  = allSvcRows.filter(s => !((s.name || "").toLowerCase().includes("tuition")) && s.type !== "book");

    const tuitionTotal  = calculateInvoiceTotal(tuitionRows);
    const booksTotal    = calculateInvoiceTotal(bookRows);
    const servicesTotal = calculateInvoiceTotal(serviceRows);

    const svcCols = [
      { label: "Description", key: "name" },
      { label: "Amount", align: "right", render: (s) => naira(calculateLineTotal(s)) },
      { label: "", render: (s) => s._remove }
    ];
    const summary = el("div", { class: "grid grid-4" }, [
      el("div", { class: "card stat" }, [el("div", { class: "ic", text: "\uD83E\uDDFE" }), el("div", {}, [el("div", { class: "v", text: naira(inv.grossAmount || inv.totalAmount) }), el("div", { class: "l", text: "Original Charges" })])]),
      el("div", { class: "card stat" }, [el("div", { class: "ic", text: "\uD83C\uDF93" }), el("div", {}, [el("div", { class: "v", text: naira(inv.scholarship || 0) }), el("div", { class: "l", text: "Scholarship Applied" })])]),
      el("div", { class: "card stat" }, [el("div", { class: "ic", text: "\uD83C\uDFF7\uFE0F" }), el("div", {}, [el("div", { class: "v", text: naira(inv.discount || 0) }), el("div", { class: "l", text: "Discount Applied" })])]),
      el("div", { class: "card stat" }, [el("div", { class: "ic", text: "\uD83D\uDCB0" }), el("div", {}, [el("div", { class: "v", text: naira(inv.totalAmount) }), el("div", { class: "l", text: "Net Amount Due" })])])
    ]);
    const summary2 = el("div", { class: "grid grid-4" }, [
      el("div", { class: "card stat" }, [el("div", { class: "ic", text: "\uD83D\uDCB5" }), el("div", {}, [el("div", { class: "v", text: naira(inv.amountPaid) }), el("div", { class: "l", text: "Amount Paid" })])]),
      el("div", { class: "card stat" }, [el("div", { class: "ic", text: "\u26A0\uFE0F" }), el("div", {}, [el("div", { class: "v", text: naira(inv.balance) }), el("div", { class: "l", text: "Outstanding Balance" })])]),
      el("div", { class: "card stat" }, [el("div", { class: "ic", text: "\uD83D\uDCCC" }), el("div", {}, [el("div", { class: "v", text: inv.status }), el("div", { class: "l", text: "Status" })])])
    ]);
    host.appendChild(el("div", { class: "section-title" }, [el("h3", { text: `${student.fullName} \u2014 ${student.admissionNo}`, style: "flex:1;margin:0" }),
      el("span", { class: "muted", text: `${cfg.sectionName(student.sectionId)} / ${cfg.className(student.classId)} \u2022 Invoice ${inv.invoiceNo}` })]));
    host.appendChild(summary);
    host.appendChild(summary2);
    host.appendChild(card("📋 Tuition", [
      table(svcCols, tuitionRows, { empty: "No tuition line items." }),
      tuitionTotal > 0 ? el("div", { style: "text-align:right;font-weight:700;padding:6px 0;border-top:1px solid var(--border)", text: "Subtotal: " + naira(tuitionTotal) }) : null
    ].filter(Boolean)));

    if (serviceRows.length > 0) {
      host.appendChild(card("⚙️ï¸ Services", [
        table(svcCols, serviceRows, { empty: "No service line items." }),
        el("div", { style: "text-align:right;font-weight:700;padding:6px 0;border-top:1px solid var(--border)", text: "Subtotal: " + naira(servicesTotal) })
      ]));
    }

    if (bookRows.length > 0) {
      host.appendChild(card("📚 Books Purchased", [
        table(svcCols, bookRows, { empty: "No books on this invoice." }),
        el("div", { style: "text-align:right;font-weight:700;padding:6px 0;border-top:1px solid var(--border)", text: "Subtotal: " + naira(booksTotal) })
      ]));
    }

    // Scholarship & Discount breakdown for cashier clarity
    if ((inv.scholarship || 0) > 0 || (inv.discount || 0) > 0) {
      const breakdownRows = [];
      (inv.scholarshipBreakdown || (inv.scholarship > 0 ? [{ name: "Scholarship Adjustment", amount: inv.scholarship }] : [])).forEach((s) =>
        breakdownRows.push(el("div", { style: "display:flex;justify-content:space-between;padding:4px 0;color:var(--success,#2a7d4f)" }, [
          el("span", { text: `🎓 ${s.name}` }),
          el("span", { text: `âˆ’ ${naira(s.amount)}`, style: "font-weight:700" })
        ]))
      );
      (inv.discountBreakdown || (inv.discount > 0 ? [{ name: "Discount", amount: inv.discount }] : [])).forEach((d) =>
        breakdownRows.push(el("div", { style: "display:flex;justify-content:space-between;padding:4px 0;color:#b56b00" }, [
          el("span", { text: `ðŸ·ï¸ ${d.name}` }),
          el("span", { text: `âˆ’ ${naira(d.amount)}`, style: "font-weight:700" })
        ]))
      );
      breakdownRows.push(el("div", { style: "display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid var(--border);font-weight:800;font-size:15px;margin-top:4px" }, [
        el("span", { text: "Net Amount Payable" }),
        el("span", { text: naira(inv.totalAmount) })
      ]));
      host.appendChild(card("Why Amount Was Reduced", breakdownRows));
    }

    // Payment history
    const receipts = db.query("receipts", (r) => r.invoiceId === inv.id).sort((a, b) => a.date - b.date);
    host.appendChild(card("Payment History", [table([
      { label: "Receipt", key: "receiptNo" }, { label: "Type", key: "paymentType" },
      { label: "Amount", align: "right", render: (r) => naira(r.amount) }, { label: "Date", render: (r) => fmtDate(r.date) },
      { label: "", render: (r) => btn("Receipt", { sm: true, onclick: () => showReceipt(r.id) }) }
    ], receipts, { empty: "No payments recorded" })]));

    if (canPay) host.appendChild(paymentForm(student, inv));
    else if (inv.balance <= 0) host.appendChild(card("", [el("p", { class: "muted", text: "\u2705 This invoice is fully paid." })]));

  }

  function paymentForm(student, inv) {
    const c = card("Collect Payment");
    const typeSel = select(() => [{ value: "Full Payment", label: "Full Payment" }, { value: "Part Payment", label: "Part Payment" }]);
    const amount = input({ type: "number", min: "0", value: String(inv.balance), max: String(inv.balance) });
    typeSel.onchange = () => { if (typeSel.value === "Full Payment") { amount.value = String(inv.balance); amount.disabled = true; } else { amount.disabled = false; } };
    amount.disabled = true;
    const grid = el("div", { class: "form-grid" }, [field("Payment Option", typeSel), field("Amount (\u20A6)", amount)]);
    c.appendChild(grid);
    const pay = btn("Record Payment & Print Receipt", { variant: "success", icon: "\u2713", onclick: async () => {
      try {
        const { receipt } = await applyPayment(inv, { amount: typeSel.value === "Full Payment" ? inv.balance : num(amount.value), paymentType: typeSel.value, cashier: ctx.user.name });
        db.save("auditLogs", { id: "pay-" + receipt.id, type: "payment", uid: ctx.user.uid, at: Date.now(), message: `Collected ${naira(receipt.amount)} from ${student.fullName} (${receipt.receiptNo})` });
        logActivity({ module: "Fees", action: "Payment Received", description: `Paid ${naira(receipt.amount)} (${receipt.paymentType}) \u2014 receipt ${receipt.receiptNo}`, studentId: student.id, user: ctx.user.email });
        toast(`Payment recorded \u2014 ${receipt.receiptNo}`, "success");
        showReceipt(receipt.id);
        renderInvoice(student, db.get("invoices", inv.id));
      } catch (e) { toast(e.message, "error", 4000); }
    } });
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [pay]));
    return c;
  }
}

