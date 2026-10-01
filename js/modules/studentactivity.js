import { db } from "../core/db.js";
import { el, naira, num, fmtDate, fmtDateTime, debounce, confirmDialog, modal, toast } from "../core/utils.js";
import { card, pageHead, table, btn, input, select, field, statCard } from "../core/ui.js";
import { getBranding, headerHtml } from "../core/branding.js";
import { printHtml } from "../core/print.js";
import * as cfg from "../core/config.js";
import { studentActivities, logActivity } from "../core/activity.js";
import { invoiceForStudent } from "../core/billing.js";

export function render(root, ctx) {
  if (ctx.param) return profile(root, ctx, ctx.param);
  list(root, ctx);
}

function list(root, ctx) {
  root.appendChild(pageHead("Student Activities", "Open a student to view their activity profile, chronological timeline and parent view."));
  const search = input({ placeholder: "Search students\u2026", style: "max-width:300px" });
  const secSel = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))]);
  root.appendChild(el("div", { class: "row", style: "margin-bottom:14px" }, [search, secSel]));
  const host = el("div");
  root.appendChild(host);
  const draw = () => {
    const q = (search.value || "").toLowerCase();
    let rows = db.query("students", (s) => s.status !== "graduated");
    if (secSel.value) rows = rows.filter((s) => cfg.studentInSection(s, secSel.value));
    if (q) rows = rows.filter((s) => `${s.fullName} ${s.admissionNo}`.toLowerCase().includes(q));
    rows.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
    host.innerHTML = "";
    host.appendChild(card("", [table([
      { label: "Admission No", key: "admissionNo" }, { label: "Name", key: "fullName" },
      { label: "Class", render: (s) => cfg.className(s.classId) },
      { label: "Activities", align: "right", render: (s) => String(studentActivities(s.id).length) },
      { label: "", render: (s) => btn("Open Profile", { sm: true, variant: "primary", onclick: () => ctx.go("studentactivity", s.id) }) }
    ], rows, { empty: "No students found." })]));
  };
  draw();
  search.oninput = debounce(draw, 200);
  secSel.onchange = draw;
  const off = db.on("students", draw);
  return () => off();
}

function attendanceStats(studentId) {
  let present = 0, total = 0;
  db.list("attendance").forEach((rec) => {
    const r = (rec.records || []).find((x) => x.studentId === studentId);
    if (r) { total++; if (r.status === "present") present++; }
  });
  return { present, total, rate: total ? Math.round((present / total) * 100) : 0 };
}

function feeStatus(studentId) {
  const invs = invoiceForStudent(studentId);
  const charges = invs.reduce((a, i) => a + num(i.totalAmount), 0);
  const paid = invs.reduce((a, i) => a + num(i.amountPaid), 0);
  const balance = invs.reduce((a, i) => a + num(i.balance), 0);
  const status = balance <= 0 && charges > 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";
  return { charges, paid, balance, status };
}

function openActivityForm(existingAct, studentId, user, onSaved) {
  const moduleInp = input({ value: existingAct?.module || "", placeholder: "e.g. Academics, Sports, Behaviour" });
  const actionInp = input({ value: existingAct?.action || "", placeholder: "e.g. Award, Incident, Achievement" });
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
      logActivity({ module: moduleInp.value.trim(), action: actionInp.value.trim(), description: descInp.value.trim(), studentId, user: user.email });
    }
    toast("Activity saved", "success");
    m.close();
    onSaved();
  } });
  const cancelBtn = btn("Cancel", { onclick: () => m.close() });

  const m = modal({ title: existingAct ? "Edit Activity" : "Add Activity", body, footer: [cancelBtn, saveBtn] });
  return m;
}

function profile(root, ctx, studentId) {
  const s = db.get("students", studentId);
  if (!s) {
    root.appendChild(pageHead("Student Activities", ""));
    root.appendChild(card("Not found", [el("p", { class: "muted", text: "Student not found." })]));
    return;
  }

  root.appendChild(pageHead(`Student Activity \u2014 ${s.fullName}`,
    `${s.admissionNo} \u2022 ${cfg.sectionName(s.sectionId)} / ${cfg.className(s.classId)} \u2022 ${s.admissionType || "Student"}`,
    [btn("\u2190 All Students", { onclick: () => ctx.go("studentactivity") })]));

  const att = attendanceStats(studentId);
  const results = db.query("results", (r) => r.studentId === studentId);
  const cbt = db.query("cbtAttempts", (a) => a.studentId === studentId);
  const assignments = db.query("assignments", (a) => a.classId === s.classId && (!a.sectionId || a.sectionId === s.sectionId));
  const behaviour = db.query("behaviour", (b) => b.studentId === studentId);
  const awards = behaviour.filter((b) => (b.type || "").toLowerCase() === "award");
  const discipline = behaviour.filter((b) => (b.type || "").toLowerCase() === "disciplinary");
  const library = db.query("library", (l) => l.studentId === studentId);
  const fee = feeStatus(studentId);

  const prof = card("Activity Profile");
  prof.appendChild(el("div", { class: "grid grid-4" }, [
    statCard("\uD83D\uDCC5", att.rate + "%", `Attendance (${att.present}/${att.total})`),
    statCard("\uD83D\uDCDD", assignments.length, "Assignments"),
    statCard("\uD83D\uDCBB", cbt.length, "CBT Attempts"),
    statCard("\uD83D\uDCC8", results.length, "Results / Exams"),
    statCard("\uD83C\uDFC5", awards.length, "Awards"),
    statCard("\u26A0\uFE0F", discipline.length, "Disciplinary"),
    statCard("\uD83D\uDCDA", library.length, "Library Records"),
    statCard("\uD83D\uDCB0", naira(fee.balance), "Fee Balance \u2022 " + fee.status)
  ]));
  root.appendChild(prof);

  // ── Activity Log (Add / Edit / Delete / Print) ──────────────────────────────
  const actHost = el("div");
  root.appendChild(actHost);

  function drawActivities() {
    actHost.innerHTML = "";
    const isManager = ["Super Admin", "Admin", "Principal"].includes(ctx.user.role);
    const acts = studentActivities(studentId);
    
    const actionBtns = [];
    if (isManager) {
      actionBtns.push(btn("+ Add Activity", {
        variant: "primary", sm: true,
        onclick: () => openActivityForm(null, studentId, ctx.user, drawActivities)
      }));
    }
    actionBtns.push(btn("\uD83D\uDDA8 Print Activity Report", {
      sm: true,
      onclick: () => {
        const b = getBranding();
        const rows = acts.map((a) => `
          <tr><td>${fmtDateTime(a.at)}</td><td>${a.module || ""}</td>
          <td>${a.action || ""}</td><td>${a.description || ""}</td><td>${a.user || ""}</td></tr>`).join("");
        const html = `<!DOCTYPE html><html><head><title>Activity Report — ${s.fullName}</title>
          <style>body{font-family:Arial,sans-serif;padding:20px}
          table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 8px;font-size:12px}
          th{background:#f5f5f5;font-weight:700}
          .footer{text-align:center;font-style:italic;font-weight:600;margin-top:20px}</style></head><body>
          ${headerHtml()}
          <h2>Activity Report &mdash; ${s.fullName} (${s.admissionNo})</h2>
          <p>Section: ${cfg.sectionName(s.sectionId)} / Class: ${cfg.className(s.classId)}</p>
          <table><thead><tr><th>Date &amp; Time</th><th>Module</th><th>Action</th><th>Description</th><th>By</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='5' style='text-align:center'>No activities recorded</td></tr>"}</tbody></table>
          <div class="footer">${b.schoolName} appreciates your dedication and commitment to excellence.</div>
          </body></html>`;
        printHtml(html, { title: "Student Activity Report", orientation: "landscape" });
      }
    }));
    
    actHost.appendChild(card("Activity Log", [
      el("div", { class: "row", style: "margin-bottom:10px; gap:8px;" }, actionBtns),
      table([
        { label: "Date & Time", render: (a) => fmtDateTime(a.at) },
        { label: "Module", key: "module" },
        { label: "Action", key: "action" },
        { label: "Description", key: "description" },
        { label: "By", key: "user" },
        { label: "", render: (a) => isManager ? el("div", { class: "row" }, [
          btn("Edit", { sm: true, onclick: () => openActivityForm(a, studentId, ctx.user, drawActivities) }),
          btn("\u2715", { sm: true, variant: "danger", onclick: async () => {
            if (await confirmDialog("Delete this activity?", { danger: true, okText: "Delete" })) {
              db.delete("activities", a.id);
              toast("Activity deleted", "success");
              drawActivities();
            }
          } })
        ]) : el("span", { class: "muted", text: "—" }) }
      ], acts, { empty: "No activities recorded yet." })
    ]));
  }
  drawActivities();

  // Timeline
  const evts = [];
  studentActivities(studentId).forEach((a) => evts.push({ at: a.at, label: `${a.action || a.module}: ${a.description || ""}` }));
  (s.history || []).forEach((h) => evts.push({ at: h.at, label: `${h.note || h.type}` }));
  db.query("receipts", (r) => r.studentId === studentId).forEach((r) => {
    if (!studentActivities(studentId).some((a) => a.refId === r.id || (a.description || "").includes(r.receiptNo)))
      evts.push({ at: r.date, label: `Paid ${naira(r.amount)} \u2014 receipt ${r.receiptNo}` });
  });
  evts.sort((a, b) => b.at - a.at);
  const tl = card("Student Timeline");
  if (!evts.length) tl.appendChild(el("p", { class: "muted", text: "No activity recorded yet." }));
  else tl.appendChild(el("div", { class: "timeline" }, evts.map((e) =>
    el("div", { class: "tl-item", style: "padding:8px 0;border-bottom:1px solid var(--border)" }, [
      el("div", { style: "font-weight:700;font-size:12px;color:var(--brand)", text: fmtDateTime(e.at) }),
      el("div", { text: e.label })
    ]))));
  root.appendChild(tl);

  // Parent view
  const pv = card("Parent View");
  pv.appendChild(el("p", { class: "muted", text: "Summary visible to the parent / guardian." }));
  pv.appendChild(el("div", { class: "grid grid-2" }, [
    el("div", {}, [
      el("div", { class: "row", style: "justify-content:space-between" }, [el("b", { text: "Attendance Rate" }), el("span", { text: att.rate + "%" })]),
      el("div", { class: "row", style: "justify-content:space-between" }, [el("b", { text: "Results Recorded" }), el("span", { text: String(results.length) })]),
      el("div", { class: "row", style: "justify-content:space-between" }, [el("b", { text: "Behaviour Reports" }), el("span", { text: String(behaviour.length) })])
    ]),
    el("div", {}, [
      el("div", { class: "row", style: "justify-content:space-between" }, [el("b", { text: "Total Charges" }), el("span", { text: naira(fee.charges) })]),
      el("div", { class: "row", style: "justify-content:space-between" }, [el("b", { text: "Total Paid" }), el("span", { text: naira(fee.paid) })]),
      el("div", { class: "row", style: "justify-content:space-between" }, [el("b", { text: "Outstanding" }), el("span", { text: naira(fee.balance) })])
    ])
  ]));
  root.appendChild(pv);
}
