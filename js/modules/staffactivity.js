import { db } from "../core/db.js";
import { el, naira, fmtDate, fmtDateTime, debounce, confirmDialog, modal, toast } from "../core/utils.js";
import { card, pageHead, table, btn, input, field, statCard } from "../core/ui.js";
import { getBranding, headerHtml } from "../core/branding.js";
import { printHtml } from "../core/print.js";
import { staffActivities, logActivity } from "../core/activity.js";
import { showPayslip } from "./payslip.js";
import { isPresentStatus } from "../core/staffattendance.js";

export function render(root, ctx) {
  if (ctx.param) return profile(root, ctx, ctx.param);
  list(root, ctx);
}

function list(root, ctx) {
  root.appendChild(pageHead("Staff Activities", "Open a staff member to view their full activity profile, performance dashboard and activity log."));
  const search = input({ placeholder: "Search staff\u2026", style: "max-width:300px" });
  root.appendChild(el("div", { class: "row", style: "margin-bottom:14px" }, [search]));
  const host = el("div");
  root.appendChild(host);
  const draw = () => {
    const q = (search.value || "").toLowerCase();
    let rows = db.list("staff").sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    if (q) rows = rows.filter((s) => `${s.name} ${s.staffNo} ${s.post || ""}`.toLowerCase().includes(q));
    host.innerHTML = "";
    host.appendChild(card("", [table([
      { label: "Staff No", key: "staffNo" }, { label: "Name", key: "name" },
      { label: "Post", key: "post" }, { label: "Department", key: "department" },
      { label: "Activities", align: "right", render: (s) => String(staffActivities(s.id).length) },
      { label: "", render: (s) => btn("Open Profile", { sm: true, variant: "primary", onclick: () => ctx.go("staffactivity", s.id) }) }
    ], rows, { empty: "No staff registered yet." })]));
  };
  draw();
  search.oninput = debounce(draw, 200);
  const off = db.on("staff", draw);
  return () => off();
}

function staffAttendanceStats(staffId) {
  let present = 0, total = 0;
  db.list("staffAttendance").forEach((rec) => {
    const r = (rec.records || []).find((x) => x.staffId === staffId);
    if (r) { total++; if (isPresentStatus(r.status)) present++; }
  });
  return { present, total, rate: total ? Math.round((present / total) * 100) : 0 };
}

function openActivityForm(existingAct, staffId, user, onSaved) {
  const moduleInp = input({ value: existingAct?.module || "", placeholder: "e.g. Lesson Plan, Result, Leave" });
  const actionInp = input({ value: existingAct?.action || "", placeholder: "e.g. Submitted, Approved, Absent" });
  const descInp   = input({ value: existingAct?.description || "", placeholder: "Describe the activity" });

  const body = el("div", { class: "form-grid" }, [
    field("Module / Category", moduleInp, { full: true }),
    field("Action / Type", actionInp),
    field("Description", descInp, { full: true })
  ]);

  const saveBtn = btn("Save", { variant: "primary", onclick: () => {
    if (!moduleInp.value.trim() || !actionInp.value.trim()) {
      toast("Module and Action are required", "error"); return;
    }
    if (existingAct) {
      db.save("activities", { ...existingAct, module: moduleInp.value.trim(), action: actionInp.value.trim(), description: descInp.value.trim() });
    } else {
      logActivity({ module: moduleInp.value.trim(), action: actionInp.value.trim(), description: descInp.value.trim(), staffId, user: user.email });
    }
    toast("Activity saved", "success");
    m.close();
    onSaved();
  } });
  const cancelBtn = btn("Cancel", { onclick: () => m.close() });
  const m = modal({ title: existingAct ? "Edit Staff Activity" : "Add Staff Activity", body, footer: [cancelBtn, saveBtn] });
  return m;
}

function profile(root, ctx, staffId) {
  const s = db.get("staff", staffId);
  if (!s) {
    root.appendChild(pageHead("Staff Activities", ""));
    root.appendChild(card("Not found", [el("p", { class: "muted", text: "Staff member not found." })]));
    return;
  }

  root.appendChild(pageHead(`Staff Activity \u2014 ${s.name}`,
    `${s.staffNo} \u2022 ${s.post || ""} \u2022 ${s.department || ""}`,
    [btn("\u2190 All Staff", { onclick: () => ctx.go("staffactivity") })]));

  const payslips = db.query("payslips", (p) => p.staffId === staffId && (p.status === "published" || (!p.status && p.payslipNo)))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const lessonPlans = db.query("lessonPlans", (x) => x.staffId === staffId);
  const att = staffAttendanceStats(staffId);
  const assignedClasses = (s.assignedClasses || s.classes || []).length;
  const assignedSubjects = (s.assignedSubjects || s.subjects || []).length;
  const lastPay = payslips[0];

  const dash = card("Performance Dashboard");
  dash.appendChild(el("div", { class: "grid grid-3" }, [
    statCard("\uD83C\uDFEB", assignedClasses, "Classes Assigned"),
    statCard("\uD83D\uDCDA", assignedSubjects, "Subjects Assigned"),
    statCard("\uD83D\uDCC5", att.rate + "%", `Attendance (${att.present}/${att.total})`),
    statCard("\uD83D\uDCDD", lessonPlans.length, "Lesson Plans"),
    statCard("\uD83D\uDCC8", staffActivities(staffId).filter((a) => a.module === "Results").length, "Results Uploaded"),
    statCard("\uD83D\uDCB5", lastPay ? naira(lastPay.netPay) : "Pending",
      lastPay ? "Last Salary \u2022 " + (lastPay.monthLabel || "") : "Salary Status")
  ]));
  root.appendChild(dash);

  // ── Activity Log (Add / Edit / Delete / Print) ──────────────────────────────
  const actHost = el("div");
  root.appendChild(actHost);

  function drawActivities() {
    actHost.innerHTML = "";
    const isManager = ["Super Admin", "Admin", "Principal"].includes(ctx.user.role);
    const acts = staffActivities(staffId);
    
    const actionBtns = [];
    if (isManager) {
      actionBtns.push(btn("+ Add Activity", {
        variant: "primary", sm: true,
        onclick: () => openActivityForm(null, staffId, ctx.user, drawActivities)
      }));
    }
    actionBtns.push(btn("\uD83D\uDDA8 Print Activity Report", {
      sm: true,
      onclick: () => {
        const b = getBranding();
        const rows = acts.map((a) => `
          <tr><td>${fmtDate(a.at)}</td><td>${new Date(a.at).toLocaleTimeString()}</td>
          <td>${a.module || ""}</td><td>${a.action || ""}</td><td>${a.description || ""}</td></tr>`).join("");
        const html = `<!DOCTYPE html><html><head><title>Staff Activity Report — ${s.name}</title>
          <style>body{font-family:Arial,sans-serif;padding:20px}
          table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 8px;font-size:12px}
          th{background:#f5f5f5;font-weight:700}
          .footer{text-align:center;font-style:italic;font-weight:600;margin-top:20px}</style></head><body>
          ${headerHtml()}
          <h2>Staff Activity Report &mdash; ${s.name} (${s.staffNo})</h2>
          <p>Post: ${s.post || ""} &bull; Department: ${s.department || ""}</p>
          <table><thead><tr><th>Date</th><th>Time</th><th>Module</th><th>Action</th><th>Description</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='5' style='text-align:center'>No activities recorded</td></tr>"}</tbody></table>
          <div class="footer">${b.schoolName} appreciates your dedication and commitment to excellence.</div>
          </body></html>`;
        printHtml(html, { title: "Staff Activity Report", orientation: "landscape" });
      }
    }));
    
    actHost.appendChild(card("Activity Log", [
      el("div", { class: "row", style: "margin-bottom:10px; gap:8px;" }, actionBtns),
      table([
        { label: "Date", render: (a) => fmtDate(a.at) },
        { label: "Time", render: (a) => new Date(a.at).toLocaleTimeString() },
        { label: "Module", key: "module" },
        { label: "Action", key: "action" },
        { label: "Description", key: "description" },
        { label: "", render: (a) => isManager ? el("div", { class: "row" }, [
          btn("Edit", { sm: true, onclick: () => openActivityForm(a, staffId, ctx.user, drawActivities) }),
          btn("\u2715", { sm: true, variant: "danger", onclick: async () => {
            if (await confirmDialog("Delete this activity?", { danger: true, okText: "Delete" })) {
              db.delete("activities", a.id);
              toast("Activity deleted", "success");
              drawActivities();
            }
          } })
        ]) : el("span", { class: "muted", text: "—" }) }
      ], acts, { empty: "No recorded activities yet." })
    ]));
  }
  drawActivities();

  // Payslips / salary
  root.appendChild(card("Salary History & Payslips", [
    table([
      { label: "Payslip No", key: "payslipNo", render: (p) => p.payslipNo || "Draft" },
      { label: "Month", render: (p) => p.monthLabel || "" },
      { label: "Net Pay", align: "right", render: (p) => naira(p.netPay) },
      { label: "", render: (p) => btn("View", { sm: true, onclick: () => showPayslip(p.id, ctx) }) }
    ], payslips, { empty: "No payslips issued yet." })
  ]));
}
