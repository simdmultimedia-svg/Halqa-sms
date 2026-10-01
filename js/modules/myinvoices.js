import { el, naira, num, fmtDate } from "../core/utils.js";
import { card, pageHead, table, statCard } from "../core/ui.js";
import { db } from "../core/db.js";
import * as cfg from "../core/config.js";

export async function render(root, ctx) {
  if (!ctx.user.studentId) {
    root.innerHTML = "<div class='card'><p class='muted'>No student linked to this account.</p></div>";
    return;
  }

  const studentId = ctx.user.studentId;
  const student = db.get("students", studentId);
  const invoices = db.query("invoices", i => i.studentId === studentId).sort((a, b) => b.createdAt - a.createdAt);

  root.appendChild(pageHead("My Invoices & Books", student ? `${student.fullName} — ${student.admissionNo}` : ""));

  // ── My Books Summary ──────────────────────────────────────────────────────
  const allBookLines = [];
  invoices.forEach(inv => {
    (inv.services || []).filter(s => s.type === "book").forEach(s => {
      allBookLines.push({
        name: s.name,
        amount: num(s.amount),
        invoiceNo: inv.invoiceNo,
        term: inv.term,
        status: inv.status
      });
    });
  });

  const booksPaid = allBookLines.filter(b => b.status === "PAID");
  const booksUnpaid = allBookLines.filter(b => b.status !== "PAID");
  const totalBookCharges = allBookLines.reduce((a, b) => a + b.amount, 0);

  const booksStats = el("div", { class: "grid grid-3", style: "margin-bottom:16px" }, [
    statCard("📚", String(allBookLines.length), "Total Books Assigned"),
    statCard("✅", String(booksPaid.length), "Books Paid"),
    statCard("💰", naira(totalBookCharges), "Total Book Charges")
  ]);
  root.appendChild(booksStats);

  if (allBookLines.length > 0) {
    root.appendChild(card("📚 My Books", [
      table([
        { label: "Book", key: "name" },
        { label: "Amount", align: "right", render: b => naira(b.amount) },
        { label: "Invoice", key: "invoiceNo" },
        { label: "Term", key: "term" },
        { label: "Status", render: b => el("span", {
          class: "badge " + (b.status === "PAID" ? "badge-success" : b.status === "PARTIALLY PAID" ? "badge-warning" : "badge-danger"),
          text: b.status
        })}
      ], allBookLines, { empty: "No books assigned." })
    ]));
  }

  // ── Invoices (delegate to existing invoices module) ────────────────────────
  const m = await import("./invoices.js");
  return m.render(root, { ...ctx, param: ctx.user.studentId });
}
