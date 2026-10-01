import { db } from "../core/db.js";
import { el, fmtDate, modal } from "../core/utils.js";
import { card, pageHead, table, btn, field } from "../core/ui.js";
import * as cfg from "../core/config.js";

export async function render(root, ctx) {
  root.appendChild(pageHead("My Assignments", "View assignments for your class."));
  if (!ctx.user.studentId) {
    root.appendChild(card("Not linked", [el("p", { class: "muted", text: "No student linked to this account." })]));
    return;
  }
  const student = db.get("students", ctx.user.studentId);
  if (!student) {
    root.appendChild(card("Not found", [el("p", { class: "muted", text: "Student profile not found." })]));
    return;
  }
  const rows = db.query("assignments", a => a.classId === student.classId && (!a.sectionId || a.sectionId === student.sectionId))
    .sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));
  root.appendChild(card(`${student.fullName} - ${cfg.className(student.classId)}`, [table([
    { label: "Title", key: "title" },
    { label: "Subject", key: "subject" },
    { label: "Due Date", render: a => fmtDate(a.dueDate) },
    { label: "Teacher", render: a => a.teacherName || "" },
    { label: "", render: a => btn("View", { sm: true, variant: "primary", onclick: () => viewAssignment(a) }) }
  ], rows, { empty: "No assignments for your class yet." })]));
}

function viewAssignment(a) {
  const attachment = a.attachment
    ? el("a", { href: a.attachment, download: a.attachmentName || "attachment", text: a.attachmentName || "Download attachment" })
    : el("span", { class: "muted", text: "No attachment" });
  modal({ title: "Assignment", size: "lg", body: el("div", { class: "form-grid" }, [
    field("Title", el("div", { text: a.title || "" }), { full: true }),
    field("Description", el("div", { text: a.description || "" }), { full: true }),
    field("Subject", el("div", { text: a.subject || "" })),
    field("Due Date", el("div", { text: fmtDate(a.dueDate) })),
    field("Teacher", el("div", { text: a.teacherName || "" })),
    field("Attachment", attachment, { full: true })
  ])});
}
