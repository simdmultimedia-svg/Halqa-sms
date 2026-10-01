import { db } from "../core/db.js";
import { el, toast, naira, fmtDateTime, modal, debounce } from "../core/utils.js";
import { card, pageHead, table, btn, input } from "../core/ui.js";
import { receiptDoc } from "../core/documents.js";
import { previewHtml, downloadPdf, downloadImage, shareDocumentToWhatsApp } from "../core/print.js";
import { calculateTotalPaid } from "../core/calculations.js";
import { softDeleteReceipt } from "../core/billing.js";
import { lazyListen } from "../core/adapter.js";
import { can } from "../core/rbac.js";
import * as cfg from "../core/config.js";

export function showReceipt(receiptId) {
  const r = db.get("receipts", receiptId);
  if (!r) return toast("Receipt not found", "error");
  const student = db.get("students", r.studentId);
  const invoice = db.get("invoices", r.invoiceId);
  const html = receiptDoc(r, student, invoice);
  const preview = el("div", { class: "doc-preview" });
  preview.innerHTML = `<div style="font-family:Arial">${html}</div>`;
  const m = modal({
    title: `Receipt ${r.receiptNo}`, size: "lg", body: preview,
    footer: [
      btn("Print", { icon: "🖨️", onclick: () => previewHtml(html, { title: "Receipt " + r.receiptNo }) }),
      btn("Download Image", { onclick: () => downloadImage(html, { title: "Receipt " + r.receiptNo, filename: `Receipt_${r.receiptNo}.png` }) }),
      btn("WhatsApp", { variant: "success", onclick: () => {
        const phone = student?.parentPhone || student?.guardianPhone || "";
        shareDocumentToWhatsApp(html, { title: "Receipt " + r.receiptNo, filename: `Receipt_${r.receiptNo}.png`, phone });
      } }),
      btn("Close", { variant: "primary", onclick: () => m.close() })
    ]
  });
}

export function render(root, ctx) {
  lazyListen("receipts");
  lazyListen("students");
  lazyListen("invoices");
  if (ctx.param) showReceipt(ctx.param);
  root.appendChild(pageHead("Receipts", "All payment receipts, each linked to its invoice."));
  
  const search = input({ placeholder: "Search receipts\u2026", style: "max-width:320px" });
  const findDupBtn = btn("Find Duplicates", { variant: "warning", onclick: () => {
    search.value = "!duplicates";
    draw();
  } });
  
  let currentRows = [];
  const selectedIds = new Set();
  const isManager = ["Super Admin", "Admin"].includes(ctx.user.role) || can(ctx.user.role, "deleteRecords");

  const toolbarHost = el("div", { style: "margin-bottom: 15px;" });
  root.appendChild(toolbarHost);
  root.appendChild(el("div", { class: "row", style: "margin-bottom:14px; display:flex; gap:10px; align-items:center;" }, [search, findDupBtn]));
  const host = el("div");
  root.appendChild(host);

  const drawToolbar = () => {
    toolbarHost.innerHTML = "";
    if (selectedIds.size === 0 && !isManager) return;
    
    const tb = card("", [
      el("div", { style: "display: flex; gap: 10px; flex-wrap:wrap; align-items:center; justify-content:space-between;" }, [
        selectedIds.size > 0 ? el("div", { style: "font-size: 16px; font-weight: bold;" }, [
          document.createTextNode(`${selectedIds.size} Receipts Selected`)
        ]) : el("div", {}),
        el("div", { style: "display: flex; gap: 10px; flex-wrap:wrap;" }, [
          isManager ? btn("Select All", { variant: "light", onclick: () => selectionController.selectAll(currentRows.map(r => r.id)) }) : null,
          isManager && selectedIds.size > 0 ? btn("Deselect All", { variant: "light", onclick: () => { selectedIds.clear(); draw(); } }) : null,
          selectedIds.size > 0 ? btn("Print Selected", { variant: "success", icon: "\uD83D\uDDA8\uFE0F", onclick: () => {
            const htmls = Array.from(selectedIds).map(id => {
              const r = db.get("receipts", id);
              if (!r) return "";
              const s = db.get("students", r.studentId);
              const i = db.get("invoices", r.invoiceId);
              return `<div style="page-break-after:always">${receiptDoc(r, s, i)}</div>`;
            });
            previewHtml(htmls.join(""), { title: "Bulk Receipts" });
          }}) : null,
          selectedIds.size > 0 ? btn("Download Selected Images", { variant: "primary", onclick: () => {
              const htmls = Array.from(selectedIds).map(id => {
                const r = db.get("receipts", id);
                if (!r) return "";
                const s = db.get("students", r.studentId);
                const i = db.get("invoices", r.invoiceId);
                return `<div style="page-break-after:always">${receiptDoc(r, s, i)}</div>`;
              });
              downloadImage(htmls.join(""), { title: "Bulk Receipts", filename: "Bulk_Receipts.png" });
            }}) : null,
          isManager && selectedIds.size > 0 ? btn("Delete Selected", { variant: "danger", onclick: async () => {
            const ids = Array.from(selectedIds);
            const totalValue = calculateTotalPaid(ids.map(id => db.get("receipts", id)));
            const conf = prompt(`You are about to permanently delete ${ids.length} selected receipts (Value: ${naira(totalValue)}). Type DELETE to confirm:`);
            if (conf !== "DELETE") return toast("Deletion cancelled.", "error");
            for (let id of ids) await softDeleteReceipt(id, ctx.user.email);
            selectedIds.clear();
            toast(`Deleted ${ids.length} receipts.`, "success");
            draw();
          }}) : null,
          isManager ? btn("Mass Delete By Filter", { variant: "danger", onclick: async () => {
            if (!currentRows.length) return toast("No receipts in current filter.");
            const totalValue = calculateTotalPaid(currentRows);
            const conf = prompt(`You are about to delete all ${currentRows.length} filtered receipts (Total Value: ${naira(totalValue)}). Type DELETE to continue:`);
            if (conf !== "DELETE") return toast("Mass deletion cancelled.", "error");
            for (let row of currentRows) await softDeleteReceipt(row.id, ctx.user.email);
            selectedIds.clear();
            toast(`Mass deleted ${currentRows.length} receipts.`, "success");
            draw();
          }}) : null,
          selectedIds.size > 0 ? btn("Clear", { variant: "danger", onclick: () => { selectedIds.clear(); draw(); } }) : null
        ])
      ])
    ]);
    if (selectedIds.size > 0 || isManager) toolbarHost.appendChild(tb);
  };

  const selectionController = {
    has: (id) => selectedIds.has(id),
    selectAll: (ids) => { ids.forEach(id => selectedIds.add(id)); draw(); },
    clear: () => { selectedIds.clear(); draw(); },
    toggle: (id) => { if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id); draw(); }
  };

  const draw = () => {
    const q = (search.value || "").toLowerCase();
    let rows = db.list("receipts").sort((a, b) => b.date - a.date);
    if (q === "!duplicates") {
      const grouped = {};
      const duplicates = new Set();
      rows.forEach(r => {
        if (!r.invoiceId) return;
        const dt = new Date(r.date || Date.now()).toISOString().split('T')[0];
        const key = `${r.invoiceId}_${r.amount}_${dt}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(r);
      });
      Object.values(grouped).forEach(grp => {
        if (grp.length > 1) {
          grp.forEach(r => duplicates.add(r.id));
        }
      });
      rows = rows.filter(r => duplicates.has(r.id));
      if (rows.length === 0) toast("No duplicates found.", "success");
    } else if (q) {
      rows = rows.filter((r) => {
        const student = db.get("students", r.studentId) || {};
        const parentPhone = (student.parentPhone || "").toLowerCase();
        const className = cfg.className(student.classId || "").toLowerCase();
        return `${r.studentName} ${r.receiptNo} ${r.invoiceNo || ''} ${r.admissionNo} ${parentPhone} ${className}`.toLowerCase().includes(q);
      });
    }
    currentRows = rows;
    host.innerHTML = "";

    const validIds = new Set(db.list("receipts").map(r => r.id));
    for (const id of selectedIds) { if (!validIds.has(id)) selectedIds.delete(id); }

    const displayRows = rows.slice(0, 100);

    const currentIds = currentRows.map(r => r.id);
    const boundSelectionController = {
        ...selectionController,
        selectAll: () => selectionController.selectAll(currentIds)
    };

    const emptyMsg = rows.length > 100 ? `Showing 100 of ${rows.length} receipts. Use search to narrow down.` : "No receipts match the current filters.";

    host.appendChild(card("", [
      rows.length > 100 ? el("div", { style: "padding:10px; background:#eef2ff; color:#4f46e5; border-radius:4px; margin-bottom:10px; text-align:center; font-weight:bold;" }, `Showing latest 100 of ${rows.length} receipts. Use Search to find specific records.`) : el("span"),
      table([
      { label: "Receipt No", key: "receiptNo" }, { label: "Student", key: "studentName" },
      { label: "Type", key: "paymentType" }, { label: "Amount", align: "right", render: (r) => naira(r.amount) },
      { label: "Balance", align: "right", render: (r) => naira(r.balance) },
      { label: "Cashier", key: "cashier" }, { label: "Date", render: (r) => fmtDateTime(r.date) },
      { label: "", render: (r) => el("div", { class: "row" }, [
        btn("View", { sm: true, onclick: () => showReceipt(r.id) }),
        isManager ? btn("\u2715", { sm: true, variant: "danger", style: "margin-left:5px;", onclick: async () => {
          if (confirm("You are about to permanently delete this receipt. Continue?")) {
            await softDeleteReceipt(r.id, ctx.user.email);
            selectedIds.delete(r.id);
            toast("Receipt deleted.", "success");
            draw();
          }
        }}) : null
      ]) }
    ], displayRows, { empty: emptyMsg, selection: isManager ? boundSelectionController : null })]));
    
    drawToolbar();
  };
  draw();
  search.oninput = debounce(draw, 200);
  const off = db.on("receipts", draw);
  return () => off();
}
