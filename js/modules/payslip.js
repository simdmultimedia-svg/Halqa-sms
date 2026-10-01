import { db } from "../core/db.js";
import { el, toast, naira, modal, uuid } from "../core/utils.js";
import { card, pageHead, table, btn, textarea } from "../core/ui.js";
import { payslipDoc } from "../core/documents.js";
import { printHtml, downloadPdf } from "../core/print.js";
import { can } from "../core/rbac.js";

function userStaffId(user) {
  if (!user || !user.uid) return null;
  // 1. Direct property on session (set by auth.js from Firebase)
  if (user.staffId) return user.staffId;
  // 2. Local DB lookups (may be empty on teacher's device)
  const userRec = db.get("users", user.uid);
  if (userRec?.staffId) return userRec.staffId;
  const roleRec = db.get("userRoles", user.uid);
  if (roleRec?.staffId) return roleRec.staffId;
  const mapRec = db.list("staffLoginMap").find(m => m.uid === user.uid);
  if (mapRec?.staffId) return mapRec.staffId;
  // 3. Email-based fallback: match teacher's login email to staff record
  if (user.email) {
    const staffByEmail = db.list("staff").find(s => s.email && s.email.toLowerCase() === user.email.toLowerCase());
    if (staffByEmail) return staffByEmail.id;
  }
  return null;
}

function submitComplaint(ps, ctx) {
  const note = textarea({ placeholder: "Describe the issue with this payslip..." });
  const m = modal({ title: "Submit Payslip Complaint", body: note, footer: [
    btn("Submit Complaint", { variant: "primary", onclick: () => {
      const message = note.value.trim();
      if (!message) return toast("Enter complaint details.", "error");
      db.save("salaryComplaints", {
        id: uuid(),
        uid: ctx.user.uid,
        staffId: userStaffId(ctx.user),
        email: ctx.user.email,
        name: ctx.user.name || ps.staffName || ctx.user.email,
        payslipId: ps.id,
        payslipNo: ps.payslipNo || "",
        message,
        status: "open",
        createdAt: Date.now()
      });
      toast("Complaint submitted.", "success");
      m.close();
    }})
  ] });
}

export function showPayslip(id, ctx) {
  const ps = db.get("payslips", id);
  if (!ps) return toast("Payslip not found", "error");
  const staffId = ctx ? userStaffId(ctx.user) : null;
  // Security: staff can only view their own payslip.
  if (ctx && !can(ctx.user.role, "viewAllPayslips") && ps.staffId !== staffId) {
    return toast("You can only view your own payslip.", "error");
  }
  const staff = db.get("staff", ps.staffId);
  const html = payslipDoc(ps, staff);
  const prev = el("div", { class: "doc-preview" });
  prev.innerHTML = `<div style="font-family:Arial">${html}</div>`;
  const footer = [
    btn("Print", { onclick: () => printHtml(html, { title: "Payslip " + ps.payslipNo }) }),
    btn("Download PDF", { variant: "primary", onclick: () => downloadPdf(html, { title: "Payslip", filename: `Payslip_${ps.payslipNo || ps.staffName}.pdf` }) })
  ];
  if (ctx && !can(ctx.user.role, "viewAllPayslips")) {
    footer.push(btn("Submit Complaint", { variant: "warning", onclick: () => submitComplaint(ps, ctx) }));
  }
  modal({ title: "Payslip " + (ps.payslipNo || ""), size: "lg", body: prev, footer });
}

export function render(root, ctx) {
  root.appendChild(pageHead("Payslips", "View payslips. Staff see only their own; Admin/Accountant see all."));
  const seeAll = can(ctx.user.role, "viewAllPayslips");
  const staffId = userStaffId(ctx.user);
  const host = el("div");
  root.appendChild(host);
  const draw = () => {
    let rows = db.list("payslips");
    if (!seeAll) rows = rows.filter((p) => p.staffId === staffId && (p.status === "published" || (!p.status && p.payslipNo)));
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    host.innerHTML = "";
    host.appendChild(card("", [table([
      { label: "Payslip No", key: "payslipNo", render: (p) => p.payslipNo || "Draft" }, { label: "Staff", key: "staffName" }, { label: "Month", key: "monthLabel" },
      { label: "Net Pay", align: "right", render: (p) => naira(p.netPay) },
      { label: "", render: (p) => btn("View", { sm: true, variant: "primary", onclick: () => showPayslip(p.id, ctx) }) }
    ], rows, { empty: seeAll ? "No payslips yet." : "You have no payslips yet." })]));
  };
  draw();
  const off = db.on("payslips", draw);
  return () => off();
}
