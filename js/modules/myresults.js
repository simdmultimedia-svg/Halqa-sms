import { db } from "../core/db.js";
import { el } from "../core/utils.js";
import { card, pageHead, table, btn } from "../core/ui.js";
import { reportCardDoc } from "../core/documents.js";
import { downloadPdf, printHtml } from "../core/print.js";

export function render(root, ctx) {
  const studentId = ctx.user.studentId;
  const student = studentId && db.get("students", studentId);
  if (!student) {
    root.appendChild(card("Student account not linked", [el("p", { class: "muted", text: "Ask the school administrator to link this login to your student record." })]));
    return;
  }
  const results = db.query("results", (r) => r.studentId === studentId).sort((a, b) => String(b.session || "").localeCompare(String(a.session || "")) || String(b.term || "").localeCompare(String(a.term || "")));
  root.appendChild(pageHead("My Report Cards", `${student.fullName} — ${student.admissionNo || "Student"}`));
  root.appendChild(card("Available Report Cards", [table([
    { label: "Session", key: "session" },
    { label: "Term", key: "term" },
    { label: "Average", render: (r) => r.average == null ? "—" : Number(r.average).toFixed(2) },
    { label: "Position", render: (r) => r.position || "—" },
    { label: "", render: (r) => el("div", { class: "row" }, [
      btn("Print", { sm: true, onclick: () => printHtml(reportCardDoc(student, r), { title: `Report Card ${student.admissionNo || "Student"}` }) }),
      btn("Download PDF", { sm: true, variant: "primary", onclick: () => downloadPdf(reportCardDoc(student, r), { title: "Report Card", filename: `Report_${student.admissionNo || "Student"}_${String(r.term || "").replace(/\s+/g, "_")}.pdf` }) })
    ]) }
  ], results, { empty: "No published report cards are available yet." })]));
}
