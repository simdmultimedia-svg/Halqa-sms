import { db } from "../core/db.js";
import { el, naira, fmtDateTime } from "../core/utils.js";
import { card, pageHead, table, btn } from "../core/ui.js";
import { receiptDoc } from "../core/documents.js";
import { downloadImage, printHtml } from "../core/print.js";

export function render(root, ctx) {
  const student = ctx.user.studentId && db.get("students", ctx.user.studentId);
  if (!student) return root.appendChild(card("Student account not linked", [el("p", { class: "muted", text: "Ask the school administrator to link this login to your student record." })]));
  const receipts = db.query("receipts", (r) => r.studentId === student.id).sort((a, b) => (b.date || 0) - (a.date || 0));
  root.appendChild(pageHead("My Payment Receipts", `${student.fullName} — ${student.admissionNo || "Student"}`));
  root.appendChild(card("Paid Receipts", [table([
    { label: "Receipt No.", key: "receiptNo" }, { label: "Payment Type", key: "paymentType" }, { label: "Amount", align: "right", render: (r) => naira(r.amount) },
    { label: "Date", render: (r) => fmtDateTime(r.date) },
    { label: "", render: (r) => { const invoice = db.get("invoices", r.invoiceId); const html = receiptDoc(r, student, invoice); return el("div", { class: "row" }, [btn("Print", { sm: true, onclick: () => printHtml(html, { title: `Receipt ${r.receiptNo}` }) }), btn("Download", { sm: true, variant: "primary", onclick: () => downloadImage(html, { title: `Receipt ${r.receiptNo}`, filename: `Receipt_${r.receiptNo}.png` }) })]); } }
  ], receipts, { empty: "No paid receipts are available yet." })]));
}
