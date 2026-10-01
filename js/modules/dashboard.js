import { db } from "../core/db.js";
import { el } from "../core/utils.js";
import { naira, num, fmtDate, sumBy } from "../core/utils.js";
import { statCard, card, table } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { normaliseRole } from "../core/rbac.js";

export function render(root, ctx) {
  const draw = () => {
    root.innerHTML = "";
    const role = normaliseRole(ctx.user.role);
    console.log("[DEBUG] Dashboard render - role:", role, "ctx.user:", ctx.user);

    if (role === "Teacher") return drawTeacherDashboard(root, ctx);
    if (role === "Accountant") return drawAccountantDashboard(root, ctx);
    if (role === "Staff") return drawStaffDashboard(root, ctx);
    if (role === "Student") return drawStudentDashboard(root, ctx);

    // Super Admin, Admin, Principal, Vice Principal, and others get the general dashboard
    console.log("[DEBUG] Dashboard - showing general dashboard for role:", role);

    const students = db.query("students", (s) => s.status !== "graduated");
    const staff = db.list("staff");
    const invoices = db.list("invoices");
    const payments = db.list("payments");
    const revenue = sumBy(payments, (p) => p.amount);
    const outstanding = sumBy(invoices, (i) => i.balance);
    const todayAtt = db.query("attendance", (a) => a.date === new Date().toISOString().slice(0, 10));
    const presentToday = sumBy(todayAtt, (a) => (a.records || []).filter((r) => r.status === "present").length);

    const stats = el("div", { class: "grid grid-4" }, [
      statCard("\uD83D\uDC65", students.length, "Total Students"),
      statCard("\uD83D\uDC68\u200D\uD83C\uDFEB", staff.length, "Total Staff"),
      statCard("\uD83D\uDCB0", naira(revenue), "Total Revenue"),
      statCard("\u26A0\uFE0F", naira(outstanding), "Outstanding Fees")
    ]);

    // population by section
    const bySection = cfg.sections().map((s) => ({ name: s.name, count: students.filter((st) => st.sectionId === s.id).length }));
    const maxPop = Math.max(1, ...bySection.map((b) => b.count));
    const popBars = el("div", {}, bySection.map((b) => el("div", { style: "margin:8px 0" }, [
      el("div", { class: "row", style: "justify-content:space-between" }, [el("span", { text: b.name }), el("b", { text: String(b.count) })]),
      el("div", { style: "height:10px;background:var(--bg);border-radius:6px;overflow:hidden" }, [
        el("div", { style: `height:100%;width:${(b.count / maxPop) * 100}%;background:var(--brand)` })])
    ])));

    // recent admissions + payments
    const recentAdm = students.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
    const recentPay = payments.slice().sort((a, b) => b.date - a.date).slice(0, 6);

    const titleRow = el("div", { class: "section-title", style: "display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap" }, [
      el("div", {}, [
        el("h2", { text: "Dashboard" }),
        el("div", { class: "muted", text: `${cfg.currentSession()} \u2022 ${cfg.currentTerm()}` })
      ])
    ]);

    // Add import button for admins to merge offline teacher backups
    const importBtn = el("label", { class: "btn btn-secondary btn-sm", style: "cursor:pointer;display:inline-flex;align-items:center;gap:6px;" }, [
      el("span", { text: "📥 Import Teacher Offline Data" }),
      el("input", {
        type: "file",
        accept: ".json",
        style: "display:none",
        onchange: (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const payload = JSON.parse(ev.target.result);
              if (payload.type !== "cic-kano-offline-backup") throw new Error("Invalid backup format");
              let importedCount = 0;
              (payload.records || []).forEach(record => {
                if (record.col && record.data && record.data.id) {
                  // Merge by latest updatedAt timestamp if it exists
                  const existing = db.get(record.col, record.data.id);
                  if (!existing || !existing.updatedAt || !record.data.updatedAt || record.data.updatedAt > existing.updatedAt) {
                    db.save(record.col, record.data);
                    importedCount++;
                  }
                }
              });
              alert(`Successfully merged ${importedCount} records from the offline backup. Check your system!`);
              draw();
            } catch (err) {
              alert("Failed to parse file: " + err.message);
            }
          };
          reader.readAsText(file);
          e.target.value = ""; // reset
        }
      })
    ]);
    titleRow.appendChild(importBtn);

    root.appendChild(titleRow);
    root.appendChild(stats);

    const row = el("div", { class: "grid grid-2" }, [
      card("Student Population by Section", [popBars]),
      card("Fee Collection", [el("div", {}, [
        el("div", { class: "stat", style: "margin-bottom:10px" }, [el("div", { class: "ic", text: "\uD83D\uDCC8" }),
        el("div", {}, [el("div", { class: "v", text: naira(revenue) }), el("div", { class: "l", text: "Collected" })])]),
        el("div", { class: "stat" }, [el("div", { class: "ic", text: "\uD83E\uDDFE" }),
        el("div", {}, [el("div", { class: "v", text: String(invoices.length) }), el("div", { class: "l", text: "Invoices issued" })])]),
        el("div", { class: "muted", style: "margin-top:10px", text: `Today's attendance marked present: ${presentToday}` })
      ])])
    ]);
    root.appendChild(row);

    root.appendChild(el("div", { class: "grid grid-2" }, [
      card("Recent Admissions", [table(
        [{ label: "Name", key: "fullName" }, { label: "Adm No", key: "admissionNo" },
        { label: "Class", render: (s) => cfg.className(s.classId) }, { label: "Date", render: (s) => fmtDate(s.createdAt) }],
        recentAdm, { empty: "No admissions yet" })]),
      card("Recent Payments", [table(
        [{ label: "Receipt", key: "receiptNo" }, { label: "Student", key: "studentName" },
        { label: "Amount", align: "right", render: (p) => naira(p.amount) }, { label: "Date", render: (p) => fmtDate(p.date) }],
        recentPay, { empty: "No payments yet" })])
    ]));
  };
  draw();
  const offs = ["students", "payments", "invoices", "attendance"].map((c) => db.on(c, draw));
  return () => offs.forEach((o) => o());
}

function drawTeacherDashboard(root, ctx) {
  const staff = ctx.user.staffId ? db.get("staff", ctx.user.staffId) : null;
  const assignedClasses = staff?.assignedClasses || [];
  const assignedSubjects = staff?.assignedSubjects || [];
  const today = new Date().toISOString().slice(0, 10);
  const lessons = db.query("lessonPlans", (p) => p.staffId === ctx.user.staffId || assignedClasses.includes(p.classId));
  const todayLessons = lessons.filter((p) => (p.date || "").slice(0, 10) === today);
  const assignments = db.query("assignments", (a) => a.staffId === ctx.user.staffId || assignedClasses.includes(a.classId));
  const results = db.query("results", (r) => assignedClasses.includes(r.classId));
  const attendance = db.query("attendance", (a) => assignedClasses.includes(a.classId));
  const payslips = db.query("payslips", (p) => p.staffId === ctx.user.staffId);

  root.appendChild(pageTitle("Teacher Dashboard", ctx));

  // --- OFFLINE EXPORT LOGIC ---
  let pendingCount = 0;
  try {
    const qRaw = localStorage.getItem("CIC KANO:__syncqueue");
    if (qRaw) pendingCount = JSON.parse(qRaw).length;
  } catch (e) { }
  // Export button (always shown)
  const exportBtn = el("button", {
    class: "btn btn-primary",
    text: "📥 Export Offline Work",
    onclick: () => {
      try {
        const q = JSON.parse(localStorage.getItem("CIC KANO:__syncqueue") || "[]");
        const records = [];
        q.forEach(op => {
          if (op.action === "put" && op.col && op.id) {
            const data = db.get(op.col, op.id);
            if (data) records.push({ col: op.col, data: data });
          }
        });
        const backup = {
          type: "cic-kano-offline-backup",
          timestamp: Date.now(),
          records: records
        };
        const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `teacher-offline-backup-${Date.now()}.json`;
        a.click();
        alert(`Successfully generated backup file with ${records.length} records. Please send this file to the Admin.`);
      } catch (e) {
        alert("Export failed: " + e.message);
      }
    }
  });
  console.log('Teacher Dashboard: Emergency Offline Data Recovery card added. pendingCount =', pendingCount);
  root.appendChild(card("⚠️ Emergency Offline Data Recovery", [
    el("p", { text: `You have ${pendingCount} pending updates that have not synced to the cloud due to connection or quota limits.`, style: "color:var(--danger);font-weight:bold" }),
    el("p", { text: "To ensure your work is not lost, click the button below to download a backup file of your entered results, and send it to the Administrator via WhatsApp or Email.", style: "margin-bottom: 12px; max-width: 600px;" }),
    exportBtn
  ]));
  // ---------------------------------------

  root.appendChild(el("div", { class: "grid grid-4" }, [
    statCard("C", assignedClasses.length, "Assigned Classes"),
    statCard("S", assignedSubjects.length, "Assigned Subjects"),
    statCard("L", todayLessons.length, "Today's Lessons"),
    statCard("P", payslips.length ? "Available" : "Pending", "Payslip Status")
  ]));
  root.appendChild(el("div", { class: "grid grid-2" }, [
    card("Pending Assignments", [table([{ label: "Title", key: "title" }, { label: "Class", render: (a) => cfg.className(a.classId) }], assignments.slice(0, 8), { empty: "No assignments." })]),
    card("Examination Summary", [el("p", { class: "muted", text: `${results.length} result record(s) in assigned classes.` })]),
    card("Attendance Summary", [el("p", { class: "muted", text: `${attendance.length} attendance sheet(s) for assigned classes.` })]),
    card("Today's Lessons", [table([{ label: "Topic", render: (p) => p.topic || p.title || "-" }, { label: "Class", render: (p) => cfg.className(p.classId) }], todayLessons, { empty: "No lessons scheduled today." })])
  ]));
}

function drawAccountantDashboard(root, ctx) {
  const invoices = db.list("invoices");
  const payments = db.list("payments");
  const receipts = db.list("receipts");
  const expenses = db.list("expenses");
  root.appendChild(pageTitle("Accountant Dashboard", ctx));
  root.appendChild(el("div", { class: "grid grid-4" }, [
    statCard("I", invoices.length, "Invoices"),
    statCard("R", receipts.length, "Receipts"),
    statCard("P", naira(sumBy(payments, (p) => p.amount)), "Payments"),
    statCard("E", naira(sumBy(expenses, (e) => e.amount)), "Expenses")
  ]));
}

function drawStaffDashboard(root, ctx) {
  const payslips = db.query("payslips", (p) => p.staffId === ctx.user.staffId);
  const attendance = db.query("staffAttendance", (a) => a.staffId === ctx.user.staffId || (a.records || []).some((r) => r.staffId === ctx.user.staffId));
  root.appendChild(pageTitle("Staff Dashboard", ctx));
  root.appendChild(el("div", { class: "grid grid-2" }, [
    statCard("A", attendance.length, "My Attendance Records"),
    statCard("P", payslips.length, "My Payslips")
  ]));
}

function drawStudentDashboard(root, ctx) {
  const results = db.query("results", (r) => r.studentId === ctx.user.studentId);
  const invoices = db.query("invoices", (i) => i.studentId === ctx.user.studentId);
  const receipts = db.query("receipts", (r) => r.studentId === ctx.user.studentId);
  const attendance = db.query("attendance", (a) => a.studentId === ctx.user.studentId || (a.records || []).some((r) => r.studentId === ctx.user.studentId));
  root.appendChild(pageTitle("Student Dashboard", ctx));
  root.appendChild(el("div", { class: "grid grid-4" }, [
    statCard("R", results.length, "My Results"),
    statCard("C", db.list("cbtAttempts").filter((a) => a.studentId === ctx.user.studentId).length, "My CBT Attempts"),
    statCard("I", invoices.length, "My Invoices"),
    statCard("A", attendance.length, "My Attendance")
  ]));
  root.appendChild(card("Recent Receipts", [table([{ label: "Receipt", key: "receiptNo" }, { label: "Amount", render: (r) => naira(r.amount) }], receipts.slice(0, 8), { empty: "No receipts yet." })]));
}

function pageTitle(title, ctx) {
  return el("div", { class: "section-title" }, [
    el("h2", { text: title }),
    el("div", { class: "muted", style: "flex:1", text: `${ctx.user.name || ctx.user.email}` })
  ]);
}
