import { db } from "../core/db.js";
import { el, toast, naira, fmtDateTime, modal } from "../core/utils.js";
import { card, pageHead, table, btn } from "../core/ui.js";
import { recalcInvoice } from "../core/billing.js";
import { lazyListen } from "../core/adapter.js";

function restoreInvoice(id, ctx) {
  const inv = db.get("deletedInvoices", id);
  if (!inv) return toast("Record not found", "error");
  delete inv.deletedBy;
  delete inv.deletedDate;
  db.save("invoices", inv);
  db.remove("deletedInvoices", id);
  db.save("auditLogs", { id: crypto.randomUUID(), type: "RESTORE_INVOICE", uid: ctx.user.email, at: Date.now(), message: `Restored invoice ${inv.invoiceNo}` });
  toast("Invoice restored", "success");
}

function permDeleteInvoice(id, ctx) {
  if (!confirm("This will PERMANENTLY delete the invoice. This cannot be undone. Continue?")) return;
  db.remove("deletedInvoices", id);
  db.save("auditLogs", { id: crypto.randomUUID(), type: "PERM_DELETE_INVOICE", uid: ctx.user.email, at: Date.now(), message: `Permanently deleted invoice ${id}` });
  toast("Permanently deleted", "success");
}

function restoreReceipt(id, ctx) {
  const rec = db.get("deletedReceipts", id);
  if (!rec) return toast("Record not found", "error");
  delete rec.deletedBy;
  delete rec.deletedDate;
  db.save("receipts", rec);
  db.save("payments", rec);
  db.remove("deletedReceipts", id);
  db.save("auditLogs", { id: crypto.randomUUID(), type: "RESTORE_RECEIPT", uid: ctx.user.email, at: Date.now(), message: `Restored receipt ${rec.receiptNo}` });

  // Accounting Protection: Re-apply receipt to invoice
  if (rec.invoiceId) {
    const inv = db.get("invoices", rec.invoiceId);
    if (inv) {
      inv.payments = inv.payments || [];
      if (!inv.payments.some(p => p.receiptNo === rec.receiptNo)) {
        inv.payments.push({ receiptNo: rec.receiptNo, amount: rec.amount, date: rec.date });
        recalcInvoice(inv);
      }
    }
  }
  toast("Receipt restored and accounting updated", "success");
}

function permDeleteReceipt(id, ctx) {
  if (!confirm("This will PERMANENTLY delete the receipt. This cannot be undone. Continue?")) return;
  db.remove("deletedReceipts", id);
  db.save("auditLogs", { id: crypto.randomUUID(), type: "PERM_DELETE_RECEIPT", uid: ctx.user.email, at: Date.now(), message: `Permanently deleted receipt ${id}` });
  toast("Permanently deleted", "success");
}

export function render(root, ctx) {
  lazyListen("deletedInvoices");
  lazyListen("deletedReceipts");
  
  root.appendChild(pageHead("Recycle Bin", "Restore or permanently delete soft-deleted financial records."));
  
  const host = el("div");
  root.appendChild(host);

  const draw = () => {
    host.innerHTML = "";
    
    const invs = db.list("deletedInvoices").sort((a,b) => b.deletedDate - a.deletedDate);
    const recs = db.list("deletedReceipts").sort((a,b) => b.deletedDate - a.deletedDate);

    const invoicesTab = card("", [
      table([
        { label: "Invoice No", key: "invoiceNo" },
        { label: "Student", key: "studentName" },
        { label: "Total", render: i => naira(i.totalAmount) },
        { label: "Deleted By", key: "deletedBy" },
        { label: "Deleted At", render: i => fmtDateTime(i.deletedDate) },
        { label: "Actions", render: i => el("div", { class: "row" }, [
          btn("Restore", { sm: true, variant: "success", onclick: () => { restoreInvoice(i.id, ctx); draw(); } }),
          btn("Permanent Delete", { sm: true, variant: "danger", style: "margin-left: 5px;", onclick: () => { permDeleteInvoice(i.id, ctx); draw(); } })
        ])}
      ], invs, { empty: "No deleted invoices" })
    ]);

    const receiptsTab = card("", [
      table([
        { label: "Receipt No", key: "receiptNo" },
        { label: "Student", key: "studentName" },
        { label: "Amount", render: r => naira(r.amount) },
        { label: "Deleted By", key: "deletedBy" },
        { label: "Deleted At", render: r => fmtDateTime(r.deletedDate) },
        { label: "Actions", render: r => el("div", { class: "row" }, [
          btn("Restore", { sm: true, variant: "success", onclick: () => { restoreReceipt(r.id, ctx); draw(); } }),
          btn("Permanent Delete", { sm: true, variant: "danger", style: "margin-left: 5px;", onclick: () => { permDeleteReceipt(r.id, ctx); draw(); } })
        ])}
      ], recs, { empty: "No deleted receipts" })
    ]);

    let activeTab = "invoices";
    
    const renderTabs = () => {
      host.innerHTML = "";
      const tabsHost = el("div", { style: "display:flex; gap:10px; margin-bottom: 20px;" }, [
        btn(`Deleted Invoices (${invs.length})`, { variant: activeTab === "invoices" ? "primary" : "light", onclick: () => { activeTab = "invoices"; renderTabs(); } }),
        btn(`Deleted Receipts (${recs.length})`, { variant: activeTab === "receipts" ? "primary" : "light", onclick: () => { activeTab = "receipts"; renderTabs(); } })
      ]);
      host.appendChild(tabsHost);
      
      if (activeTab === "invoices") {
        host.appendChild(invoicesTab);
      } else {
        host.appendChild(receiptsTab);
      }
    };
    
    renderTabs();
  };

  draw();
  const off1 = db.on("deletedInvoices", draw);
  const off2 = db.on("deletedReceipts", draw);
  return () => { off1(); off2(); };
}
