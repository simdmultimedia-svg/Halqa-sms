import { db } from "../core/db.js";
import { el, toast, fmtDate, todayISO, uuid, naira } from "../core/utils.js";
import { card, pageHead, table, btn, select, input, field } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { printHtml } from "../core/print.js";
import { headerHtml } from "../core/branding.js";
import { computeNet } from "./salary.js";
import { normaliseRole } from "../core/rbac.js";
import {
  STAFF_ATTENDANCE_STATUSES,
  attendanceSummaryForMonth,
  computeAttendanceDeduction,
  isLateStatus,
  isPermissionStatus,
  normalizeStatus
} from "../core/staffattendance.js";
import { captureFingerprint, identifyFingerprint, fingerprintServiceAvailable } from "../core/fingerprint.js";

export function render(root, ctx) {
  const isTeacher = normaliseRole(ctx.user.role) === "Teacher";
  const staff = isTeacher ? db.query("staff", s => s.email === ctx.user.email || s.id === ctx.user.staffId)[0] : null;
  const assignedClasses = staff?.assignedClasses || [];

  root.appendChild(pageHead("Attendance", "Mark and review student and staff attendance."));
  const tabs = el("div", { class: "row", style: "margin-bottom:14px" }, [
    btn("Student Attendance", { variant: "primary", onclick: () => studentTab() }),
    btn("Staff Attendance", { onclick: () => staffTab() }),
    btn("Summary", { onclick: () => summaryTab() })
  ]);
  root.appendChild(tabs);
  const host = el("div");
  root.appendChild(host);
  studentTab();

  function studentTab() {
    host.innerHTML = "";
    const c = card("Mark Student Attendance");
    
    let secs = cfg.sections();
    if (isTeacher) {
        const secIds = [...new Set(assignedClasses.map(cId => cId.split('-')[0]))];
        secs = secs.filter(s => secIds.includes(s.id));
    }
    const secSel = select(() => [{ value: "", label: "Section" }, ...secs.map((s) => ({ value: s.id, label: s.name }))]);
    const clsSel = select(() => [{ value: "", label: "Class" }]);
    const date = input({ type: "date", value: todayISO() });
    
    secSel.onchange = () => { 
        clsSel.innerHTML = '<option value="">Class</option>'; 
        let cls = cfg.classes(secSel.value);
        if (isTeacher) cls = cls.filter(k => assignedClasses.includes(k.id));
        cls.forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name }))); 
    };
    const loadBtn = btn("Load", { variant: "primary", onclick: () => loadRoster() });
    
    const scanBtn = btn("Scan Student 🖐️", { variant: "secondary", onclick: async () => {
      const isAvail = await fingerprintServiceAvailable();
      if (!isAvail) return toast("Hardware scanner service not available.", "error");
      
      scanBtn.disabled = true; scanBtn.textContent = "Scanning...";
      try {
        const capture = await captureFingerprint();
        if (!capture.success) throw new Error(capture.error || "Capture failed");
        
        const allPrints = db.list("fingerprints").filter(f => f.role === "student");
        if (allPrints.length === 0) throw new Error("No student fingerprints enrolled.");
        
        scanBtn.textContent = "Identifying...";
        const match = await identifyFingerprint(capture.template, allPrints.map(f => f.template));
        if (!match.success) throw new Error(match.error || "Unrecognized student");
        
        const matchedPrint = allPrints[match.matchIndex];
        const studentId = matchedPrint.ownerId;
        
        const row = document.querySelector(`.student-row-${studentId}`);
        if (row) {
          const sel = row.querySelector("select");
          if (sel) {
            sel.value = "present";
            sel.dispatchEvent(new Event("change"));
          }
          row.style.backgroundColor = "var(--success-light, #d1fae5)";
          setTimeout(() => row.style.backgroundColor = "", 2000);
          toast("Student marked present", "success");
        } else {
          toast("Student recognized but not in this loaded class", "warning");
        }
      } catch (err) {
        toast(err.message, "error");
      }
      scanBtn.disabled = false; scanBtn.textContent = "Scan Student 🖐️";
    } });

    const importInput = el("input", { type: "file", accept: ".json", style: "display:none" });
    const importBtn = btn("Import JSON", { variant: "ghost", onclick: () => importInput.click() });

    c.appendChild(el("div", { class: "row" }, [secSel, clsSel, date, loadBtn, scanBtn, importBtn, importInput]));
    const roster = el("div", { style: "margin-top:14px" });
    c.appendChild(roster);
    host.appendChild(c);

    function loadRoster() {
      if (!clsSel.value) return toast("Select a class", "error");
      const students = db.query("students", (s) => cfg.studentInClass(s, clsSel.value) && s.status === "active");
      const existing = db.find("attendance", (a) => a.classId === clsSel.value && a.date === date.value);
      const map = {}; (existing?.records || []).forEach((r) => map[r.studentId] = r.status);
      roster.innerHTML = "";
      if (!students.length) { roster.appendChild(el("p", { class: "muted", text: "No students in this class." })); return; }
      const rowsState = students.map((s) => ({ studentId: s.id, name: s.fullName, status: map[s.id] || "present" }));
      const list = el("div");
      
      const selects = {};
      
      rowsState.forEach((r) => {
        const sel = select(() => ["present", "absent", "late"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1), selected: r.status === v })), { style: "width:120px" });
        sel.onchange = () => r.status = sel.value;
        selects[r.studentId] = sel;
        list.appendChild(el("div", { class: `svc-row student-row-${r.studentId}` }, [el("span", { class: "nm", text: r.name }), sel]));
      });
      roster.appendChild(list);
      roster.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("Save Attendance", { variant: "success", onclick: () => {
        db.save("attendance", { id: existing?.id || uuid(), classId: clsSel.value, sectionId: secSel.value, date: date.value, records: rowsState, by: ctx.user.email, at: Date.now() });
        toast("Attendance saved", "success");
      } })]));

      importInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            if (!Array.isArray(data)) throw new Error("Expected array");
            let count = 0;
            data.forEach(item => {
              const stId = item.studentId || (item.admissionNo ? students.find(s => s.admissionNo === item.admissionNo)?.id : null);
              if (stId && selects[stId]) {
                selects[stId].value = item.status || "present";
                selects[stId].dispatchEvent(new Event("change"));
                count++;
              }
            });
            toast(`Mapped ${count} student records from JSON`, "success");
          } catch(err) {
            toast("Invalid JSON", "error");
          }
          importInput.value = "";
        };
        reader.readAsText(file);
      };
    }
  }

  function staffTab() {
    host.innerHTML = "";
    const c = card("Mark Staff Attendance");
    const date = input({ type: "date", value: todayISO() });
    const loadBtn = btn("Load", { variant: "primary", onclick: load });
    
    const scanBtn = btn("Scan Staff 🖐️", { variant: "secondary", onclick: async () => {
      const isAvail = await fingerprintServiceAvailable();
      if (!isAvail) return toast("Hardware scanner service not available.", "error");
      
      scanBtn.disabled = true; scanBtn.textContent = "Scanning...";
      try {
        const capture = await captureFingerprint();
        if (!capture.success) throw new Error(capture.error || "Capture failed");
        
        const allPrints = db.list("fingerprints").filter(f => f.role === "staff");
        if (allPrints.length === 0) throw new Error("No staff fingerprints enrolled.");
        
        scanBtn.textContent = "Identifying...";
        const match = await identifyFingerprint(capture.template, allPrints.map(f => f.template));
        if (!match.success) throw new Error(match.error || "Unrecognized staff");
        
        const matchedPrint = allPrints[match.matchIndex];
        const staffId = matchedPrint.ownerId;
        
        const row = document.querySelector(`.staff-row-${staffId}`);
        if (row) {
          const sel = row.querySelector("select");
          if (sel) {
            sel.value = "present";
            sel.dispatchEvent(new Event("change"));
          }
          row.style.backgroundColor = "var(--success-light, #d1fae5)";
          setTimeout(() => row.style.backgroundColor = "", 2000);
          toast("Staff marked present", "success");
        } else {
          toast("Staff recognized but not in roster", "warning");
        }
      } catch (err) {
        toast(err.message, "error");
      }
      scanBtn.disabled = false; scanBtn.textContent = "Scan Staff 🖐️";
    } });

    const importInput = el("input", { type: "file", accept: ".json", style: "display:none" });
    const importBtn = btn("Import JSON", { variant: "ghost", onclick: () => importInput.click() });

    c.appendChild(el("div", { class: "row" }, [field("Date", date), loadBtn, scanBtn, importBtn, importInput]));
    const roster = el("div", { style: "margin-top:14px" }); c.appendChild(roster); host.appendChild(c);
    function load() {
      const staff = db.list("staff");
      const existing = db.find("staffAttendance", (a) => a.date === date.value);
      const map = {}; (existing?.records || []).forEach((r) => map[r.staffId] = r);
      roster.innerHTML = "";
      if (!staff.length) { roster.appendChild(el("p", { class: "muted", text: "No staff registered." })); return; }
      const st = staff.map((s) => {
        const old = map[s.id] || {};
        return {
          staffId: s.id,
          name: s.name,
          status: normalizeStatus(old.status),
          arrivalTime: old.arrivalTime || "",
          reason: old.reason || "",
          approvedBy: old.approvedBy || "",
          notes: old.notes || "",
          deduction: old.deduction || 0,
          permission: !!old.permission
        };
      });
      
      const selects = {};
      
      st.forEach((r) => {
        const staffRec = db.get("staff", r.staffId) || {};
        const sel = select(() => STAFF_ATTENDANCE_STATUSES.map((v) => ({ value: v.value, label: v.label, selected: r.status === v.value })), { style: "min-width:170px" });
        selects[r.staffId] = sel;
        const arrival = input({ type: "time", value: r.arrivalTime || "07:46", style: "width:120px" });
        const reason = input({ value: r.reason || "", placeholder: "Reason", style: "min-width:170px" });
        const approvedBy = input({ value: r.approvedBy || "", placeholder: "Approved by", style: "min-width:150px" });
        const notes = input({ value: r.notes || "", placeholder: "Notes", style: "min-width:180px" });
        const deduction = el("b", { text: naira(r.deduction || 0) });
        const extra = el("div", { class: "row", style: "gap:8px;flex-wrap:wrap" });
        const refresh = () => {
          r.status = sel.value;
          r.arrivalTime = isLateStatus(r.status) ? arrival.value : "";
          r.reason = reason.value.trim();
          r.approvedBy = approvedBy.value.trim();
          r.notes = notes.value.trim();
          r.permission = isPermissionStatus(r.status);
          r.deduction = computeAttendanceDeduction({ staff: staffRec, status: r.status, arrivalTime: r.arrivalTime });
          deduction.textContent = naira(r.deduction);
          extra.style.display = isLateStatus(r.status) || isPermissionStatus(r.status) ? "" : "none";
          arrival.parentElement.style.display = isLateStatus(r.status) ? "" : "none";
          reason.parentElement.style.display = isPermissionStatus(r.status) ? "" : "none";
          approvedBy.parentElement.style.display = isPermissionStatus(r.status) ? "" : "none";
          notes.parentElement.style.display = isPermissionStatus(r.status) ? "" : "none";
        };
        sel.onchange = refresh;
        arrival.oninput = refresh; reason.oninput = refresh; approvedBy.oninput = refresh; notes.oninput = refresh;
        extra.appendChild(field("Arrival Time", arrival));
        extra.appendChild(field("Reason", reason));
        extra.appendChild(field("Approved By", approvedBy));
        extra.appendChild(field("Notes", notes));
        refresh();
        roster.appendChild(el("div", { class: `svc-row staff-row-${r.staffId}`, style: "align-items:flex-start;gap:12px" }, [
          el("span", { class: "nm", text: r.name }),
          el("div", { class: "row", style: "gap:8px;flex:2;align-items:flex-start" }, [sel, extra]),
          el("span", { class: "muted", text: "Deduction:" }),
          deduction
        ]));
      });
      roster.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("Save", { variant: "success", onclick: () => {
        st.forEach((r) => {
          const staffRec = db.get("staff", r.staffId) || {};
          r.status = normalizeStatus(r.status);
          r.permission = isPermissionStatus(r.status);
          r.deduction = computeAttendanceDeduction({ staff: staffRec, status: r.status, arrivalTime: r.arrivalTime });
          if (staffRec.id) {
            db.save("staff", {
              ...staffRec,
              attendanceProfile: {
                date: date.value,
                status: r.status,
                arrivalTime: r.arrivalTime || "",
                deduction: r.deduction,
                permission: r.permission,
                reason: r.reason || "",
                approvedBy: r.approvedBy || "",
                notes: r.notes || "",
                updatedAt: Date.now()
              }
            });
          }
        });
        db.save("staffAttendance", { id: existing?.id || uuid(), date: date.value, records: st, by: ctx.user.email, at: Date.now() });
        
        const monthKey = date.value.substring(0, 7);
        let synced = 0;
        st.forEach((r) => {
          const draft = db.find("payslips", p => p.staffId === r.staffId && p.month === monthKey && p.status === "draft");
          if (draft) {
            const staffRec = db.get("staff", r.staffId) || {};
            const att = attendanceSummaryForMonth(r.staffId, monthKey, staffRec, draft.workingDays);
            draft.attendanceDeduction = att.deductions;
            draft.latenessDeduction = att.latenessDeduction;
            draft.absenceDeduction = att.absenceDeduction;
            draft.daysAbsent = att.absent;
            draft.lateDays = att.late;
            draft.latePermissionDays = att.latePermission;
            draft.absentPermissionDays = att.absentPermission;
            draft.attendanceRecords = att.records;
            draft.netPay = computeNet(draft);
            db.save("payslips", draft);
            synced++;
          }
        });
        toast(synced > 0 ? `Saved & Synced to ${synced} draft payslip(s)` : "Saved", "success");
      } })]));

      importInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            if (!Array.isArray(data)) throw new Error("Expected array");
            let count = 0;
            data.forEach(item => {
              const sId = item.staffId || (item.email ? staff.find(s => s.email === item.email)?.id : null);
              if (sId && selects[sId]) {
                selects[sId].value = item.status || "present_early";
                selects[sId].dispatchEvent(new Event("change"));
                count++;
              }
            });
            toast(`Mapped ${count} staff records from JSON`, "success");
          } catch(err) {
            toast("Invalid JSON", "error");
          }
          importInput.value = "";
        };
        reader.readAsText(file);
      };
    }
  }

  function summaryTab() {
    host.innerHTML = "";
    const all = db.list("attendance");
    const rows = all.map((a) => ({
      date: a.date, klass: cfg.className(a.classId),
      present: (a.records || []).filter((r) => r.status === "present").length,
      absent: (a.records || []).filter((r) => r.status === "absent").length,
      late: (a.records || []).filter((r) => r.status === "late").length,
      _a: a
    })).sort((x, y) => (x.date < y.date ? 1 : -1));
    host.appendChild(card("Attendance Summary", [table([
      { label: "Date", render: (r) => fmtDate(r.date) }, { label: "Class", key: "klass" },
      { label: "Present", key: "present" }, { label: "Absent", key: "absent" }, { label: "Late", key: "late" },
      { label: "", render: (r) => btn("Print", { sm: true, onclick: () => printDay(r._a) }) }
    ], rows, { empty: "No attendance recorded yet" })]));
    const staffRows = db.list("staff").map((s) => {
      const summary = attendanceSummaryForMonth(s.id, "", s);
      return { staff: s.name, ...summary };
    }).sort((a, b) => a.staff.localeCompare(b.staff));
    host.appendChild(card("Staff Attendance Summary", [table([
      { label: "Staff Name", key: "staff" },
      { label: "Days Present", key: "present", align: "right" },
      { label: "Days Late", key: "late", align: "right" },
      { label: "Late With Permission", key: "latePermission", align: "right" },
      { label: "Days Absent", key: "absent", align: "right" },
      { label: "Absent With Permission", key: "absentPermission", align: "right" },
      { label: "Total Deductions", align: "right", render: (r) => naira(r.deductions) }
    ], staffRows, { empty: "No staff attendance recorded yet" })]));
  }

  function printDay(a) {
    const body = `${headerHtml()}<div class="doc-title">Attendance Report</div>
      <p>Class: ${cfg.className(a.classId)} &nbsp; Date: ${fmtDate(a.date)}</p>
      <table class="doc-table"><tr><th>S/N</th><th>Student</th><th>Status</th></tr>
      ${(a.records || []).map((r, i) => { const s = db.get("students", r.studentId); return `<tr><td>${i + 1}</td><td>${s ? s.fullName : r.studentId}</td><td>${r.status}</td></tr>`; }).join("")}</table>`;
    printHtml(body, { title: "Attendance " + a.date });
  }
}
