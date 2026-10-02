import { el, naira, fmtDate } from "../core/utils.js";
import { card, pageHead, table, btn } from "../core/ui.js";
import { db } from "../core/db.js";
import { invoiceDoc } from "../core/documents.js";
import { downloadPdf, printHtml } from "../core/print.js";

export async function render(root, ctx) {
  const student = ctx.user.studentId && db.get("students", ctx.user.studentId);
  if (!student) return root.appendChild(card("Student account not linked", [el("p", { class: "muted", text: "Ask the school administrator to link this login to your student record." })]));
  const invoices = db.query("invoices", (i) => i.studentId === student.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  root.appendChild(pageHead("My Invoices", `${student.fullName} — ${student.admissionNo || "Student"}`));
  root.appendChild(card("Generated Invoices", [table([
    { label: "Invoice No.", key: "invoiceNo" }, { label: "Term", render: (i) => `${i.term || "—"} ${i.session || ""}` },
    { label: "Total", align: "right", render: (i) => naira(i.totalAmount) }, { label: "Balance", align: "right", render: (i) => naira(i.balance) },
    { label: "Status", key: "status" }, { label: "Date", render: (i) => fmtDate(i.createdAt) },
    { label: "", render: (i) => el("div", { class: "row" }, [btn("Print", { sm: true, onclick: () => printHtml(invoiceDoc(i, student), { title: `Invoice ${i.invoiceNo}` }) }), btn("Download PDF", { sm: true, variant: "primary", onclick: () => downloadPdf(invoiceDoc(i, student), { title: `Invoice ${i.invoiceNo}`, filename: `Invoice_${i.invoiceNo}.pdf` }) })]) }
  ], invoices, { empty: "No invoices have been generated for you." })]));
}
