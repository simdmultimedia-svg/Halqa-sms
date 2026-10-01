import { db } from "../core/db.js";
import { el, toast, num, uuid, debounce, confirmDialog, download } from "../core/utils.js";
import { card, pageHead, btn, select, input, field } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { can, normaliseRole } from "../core/rbac.js";
import { calculateStudentSubjectTotal, calculateStudentAverage, calculatePositions } from "../core/calculations.js";

const MAX_SCORES = { ca1: 20, ca2: 20, exam: 60 };

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveTeacherStaff(user) {
  const roleRec = user?.uid ? db.get("userRoles", user.uid) : null;
  const staffId = user?.staffId || roleRec?.staffId;
  return db.query("staff", (s) =>
    (staffId && s.id === staffId) ||
    (user?.uid && (s.uid === user.uid || s.userId === user.uid)) ||
    (user?.email && norm(s.email) === norm(user.email))
  )[0] || null;
}

export function render(root, ctx) {
  const role = normaliseRole(ctx.user.role);
  if (!can(ctx.user.role, "manageResults") && role !== "Teacher") {
    root.appendChild(card("Access", [el("p", { class: "muted", text: "Your role cannot enter results." })]));
    return;
  }

  const isTeacher = role === "Teacher";
  const staff = isTeacher ? resolveTeacherStaff(ctx.user) : null;
  const assignedClasses = new Set((staff?.assignedClasses || staff?.classes || []).map(String));
  const assignedSubjects = new Set((staff?.assignedSubjects || staff?.subjects || []).map(norm));
  const canAdminister = ["Super Admin", "Admin", "Principal", "Exam Officer"].includes(role);

  const subjectAllowed = (subject) => true; // Removed strict assignment check
  const selectedSubjectAllowed = (classId, subjectName) => true; // Removed strict assignment check

  root.appendChild(pageHead("Results Entry", "Create, edit and publish CA and exam scores without duplicate records."));

  let classes = cfg.classes();
  // removed: if (isTeacher) classes = classes.filter(c => assignedClasses.has(String(c.id)));

  const clsSel = select(() => [{ value: "", label: "Select Class" }, ...classes.map(c => ({ value: c.id, label: c.name }))]);
  const subSel = select(() => [{ value: "", label: "Select Subject" }]);
  const termSel = select(() => (cfg.sessions().terms || ["First Term", "Second Term", "Third Term"]).map(t => ({ value: t, label: t, selected: t === cfg.currentTerm() })));
  const sessionSel = select(() => (cfg.sessions().list || [cfg.currentSession()]).filter(Boolean).map(s => ({ value: s, label: s, selected: s === cfg.currentSession() })));
  if (!sessionSel.options.length) sessionSel.appendChild(el("option", { value: cfg.currentSession(), text: cfg.currentSession() || "Current Session" }));

  clsSel.onchange = () => {
    subSel.innerHTML = '<option value="">Select Subject</option>';
    const secId = classes.find(c => String(c.id) === String(clsSel.value))?.sectionId;
    
    const allSubjects = cfg.subjects();
    let sectionSubjects = [];
    let otherSubjects = [];

    if (secId) {
      sectionSubjects = allSubjects.filter(s => s.sectionId === secId);
      otherSubjects = allSubjects.filter(s => s.sectionId !== secId);
    } else {
      sectionSubjects = allSubjects;
    }
    
    const seen = new Set();
    const addOptions = (list, parentNode) => {
      list.forEach(s => {
        if (!seen.has(s.name)) {
          seen.add(s.name);
          parentNode.appendChild(el("option", { value: s.name, text: s.name }));
        }
      });
    };

    if (sectionSubjects.length > 0) {
      const group = el("optgroup", { label: "Class Subjects" });
      addOptions(sectionSubjects, group);
      subSel.appendChild(group);
    }

    if (otherSubjects.length > 0) {
      const group = el("optgroup", { label: "Other Subjects" });
      addOptions(otherSubjects, group);
      subSel.appendChild(group);
    }

    host.innerHTML = "";
  };

  const loadBtn = btn("Load / Edit Sheet", { variant: "primary", onclick: () => loadSheet() });
  const downloadCsvBtn = btn("Download Marking Sheet", { onclick: () => downloadMarkingSheet() });
  const uploadCsvInput = el("input", { type: "file", accept: ".csv", style: "display:none" });
  uploadCsvInput.onchange = (e) => handleUploadMarkedSheet(e.target.files[0]);
  const uploadCsvBtn = btn("Upload Marked Sheet", { onclick: () => uploadCsvInput.click() });
  
  const actionsDiv = el("div", { style: "margin-top:10px; display:flex; gap:10px; align-items:center; flex-wrap:wrap" }, [
    loadBtn, downloadCsvBtn, uploadCsvBtn, uploadCsvInput
  ]);

  function getSortedStudentsForSelection() {
    const classId = clsSel.value;
    if (!classId) return [];
    return db.query("students", s => {
      if ((s.status || "active").toLowerCase() !== "active") return false;
      return cfg.studentInClass(s, classId);
    }).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  function downloadMarkingSheet() {
    const classId = clsSel.value;
    const subject = subSel.value;
    const term = termSel.value;
    const session = sessionSel.value;
    if (!classId || !subject || !term || !session) return toast("Select class, subject, term and session", "error");
    
    const students = getSortedStudentsForSelection();
    if (!students.length) return toast("No active students in this class.", "error");

    let csv = "Admission No,Student Name,CA1,CA2,Exam\r\n";
    students.forEach(s => {
      const rec = findResult(s.id, classId, term, session);
      const subRec = (rec?.subjects || []).find(sub => sub.name === subject) || {};
      const ca1 = subRec.ca1 != null ? subRec.ca1 : "";
      const ca2 = subRec.ca2 != null ? subRec.ca2 : "";
      const exam = subRec.exam != null ? subRec.exam : "";
      csv += `${s.admissionNo},${s.fullName.replace(/,/g, " ")},${ca1},${ca2},${exam}\r\n`;
    });
    
    const filename = `Marking_Sheet_${cfg.className(classId).replace(/\s+/g, "_")}_${subject.replace(/\s+/g, "_")}.csv`;
    download(filename, csv, "text/csv;charset=utf-8");
  }

  function handleUploadMarkedSheet(file) {
    if (!file) return;
    const classId = clsSel.value;
    const subject = subSel.value;
    if (!classId || !subject) {
      uploadCsvInput.value = "";
      return toast("Please select Class and Subject first.", "error");
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      uploadCsvInput.value = "";
      const text = e.target.result;
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      
      // Basic check for headers
      if (!lines[0].toLowerCase().includes("admission")) return toast("Invalid CSV format. Missing Admission No header.", "error");
      
      const parsedRows = lines.slice(1).map(line => {
        const cols = line.split(",");
        return {
          admNo: (cols[0] || "").trim(),
          ca1: (cols[2] || "").trim(),
          ca2: (cols[3] || "").trim(),
          exam: (cols[4] || "").trim()
        };
      }).filter(r => r.admNo);

      // We must render the sheet if it's not rendered, so we can populate the UI inputs.
      // If the sheet isn't loaded, load it.
      if (!host.querySelector("table")) {
        loadSheet();
      }

      let updatedCount = 0;
      parsedRows.forEach(row => {
        const inputIdPrefix = `res-input-${row.admNo.replace(/[^a-zA-Z0-9]/g, '-')}`;
        const ca1Input = document.getElementById(`${inputIdPrefix}-ca1`);
        const ca2Input = document.getElementById(`${inputIdPrefix}-ca2`);
        const examInput = document.getElementById(`${inputIdPrefix}-exam`);
        
        let changed = false;
        if (ca1Input && row.ca1) { ca1Input.value = row.ca1; changed = true; }
        if (ca2Input && row.ca2) { ca2Input.value = row.ca2; changed = true; }
        if (examInput && row.exam) { examInput.value = row.exam; changed = true; }
        
        if (changed && ca1Input) { // triggering input on any of them will trigger auto-save for the row
          ca1Input.dispatchEvent(new Event("input", { bubbles: true }));
          updatedCount++;
        }
      });
      
      toast(`Mapped and imported scores for ${updatedCount} students.`, "success");
    };
    reader.readAsText(file);
  }

  if (canAdminister) {
    const approveAllBtn = btn("Approve All Submitted Sheets", { variant: "success", onclick: async () => {
      const term = termSel.value;
      const session = sessionSel.value;
      if (!term || !session) return toast("Select term and session first.", "error");
      
      const submitted = db.query("resultApprovals", a => a.term === term && a.session === session && a.status === "Submitted");
      if (!submitted.length) return toast("No submitted sheets found for this term/session.", "info");
      
      if (!(await confirmDialog(`Are you sure you want to approve ${submitted.length} submitted sheet(s) at once?`))) return;
      
      submitted.forEach(a => {
        a.status = "Approved";
        a.updatedAt = Date.now();
        db.save("resultApprovals", a);
        db.save("auditLogs", { id: uuid(), type: "resultApproval", uid: ctx.user.uid, at: Date.now(), message: `${a.subject} for ${cfg.className(a.classId)} was bulk approved` });
      });
      toast(`Successfully approved ${submitted.length} sheet(s).`, "success");
      host.innerHTML = "";
    }});
    actionsDiv.appendChild(approveAllBtn);
  }

  root.appendChild(card("Filter", [
    el("div", { class: "form-grid" }, [
      field("Class", clsSel), field("Subject", subSel), field("Term", termSel), field("Session", sessionSel)
    ]),
    actionsDiv
  ]));

  const host = el("div");
  root.appendChild(host);

  function findResult(studentId, classId, term, session) {
    return db.find("results", r => r.studentId === studentId && r.classId === classId && r.term === term && r.session === session)
      || db.find("results", r => r.studentId === studentId && r.term === term && r.session === session);
  }

  function recalcRecord(rec) {
    rec.subjects = rec.subjects || [];
    rec.subjects.forEach((s) => {
      const ca1 = num(s.ca1);
      const ca2 = num(s.ca2);
      const exam = num(s.exam);
      const total = calculateStudentSubjectTotal(ca1, ca2, exam);
      const grading = cfg.gradeFor(total);
      Object.assign(s, { ca1, ca2, assignment: 0, project: 0, ca: ca1 + ca2, exam, total, grade: grading.grade, remark: grading.remark });
    });
    rec.total = rec.subjects.reduce((a, s) => a + num(s.total), 0);
    rec.average = calculateStudentAverage(rec.total, rec.subjects.length);
    rec.updatedAt = Date.now();
    return rec;
  }

  function loadSheet() {
    const classId = clsSel.value;
    const subject = subSel.value;
    const term = termSel.value;
    const session = sessionSel.value;
    if (!classId || !subject || !term || !session) return toast("Select class, subject, term and session", "error");

    const students = db.query("students", s => {
      if ((s.status || "active").toLowerCase() !== "active") return false;
      return cfg.studentInClass(s, classId);
    }).sort((a, b) => a.fullName.localeCompare(b.fullName));

    if (!students.length) {
      host.innerHTML = "<div class='card'><p class='muted'>No active students in this class.</p></div>";
      return;
    }

    const approvalId = `${classId}_${subject}_${term}_${session}`.replace(/[^a-zA-Z0-9]/g, "_");
    let approval = db.get("resultApprovals", approvalId) || { id: approvalId, classId, subject, term, session, status: "Draft" };
    const isLocked = approval.status === "Approved" || approval.status === "Published";
    const readOnly = isLocked && !canAdminister;

    const tableEl = el("table", { class: "tbl", style: "width:100%;white-space:nowrap" });
    tableEl.innerHTML = `<thead><tr>
      <th>Adm No</th><th>Name</th><th>CA1</th><th>CA2</th><th>Exam</th>
      <th>Total</th><th>Grade</th><th>Remark</th><th>Teacher Comment</th><th>Head Comment</th><th></th>
    </tr></thead><tbody></tbody>`;
    const tbody = tableEl.querySelector("tbody");

    const saveRowLogic = (student, vals, rowEls, explicit = false) => {
      if (readOnly) return;
      let rec = findResult(student.id, classId, term, session);
      if (!rec) {
        rec = { id: uuid(), studentId: student.id, sectionId: student.sectionId, classId, term, session, subjects: [], createdAt: Date.now() };
      }
      rec.sectionId = student.sectionId;
      rec.classId = classId;
      rec.term = term;
      rec.session = session;
      rec.teacherComment = vals.teacherComment;
      rec.headComment = vals.headComment;

      const ca1 = num(vals.ca1);
      const ca2 = num(vals.ca2);
      const exam = num(vals.exam);
      const total = calculateStudentSubjectTotal(ca1, ca2, exam);
      const grading = cfg.gradeFor(total);
      const nextSubject = { name: subject, ca1, ca2, assignment: 0, project: 0, ca: ca1 + ca2, exam, total, grade: grading.grade, remark: grading.remark };
      const idx = (rec.subjects || []).findIndex(s => s.name === subject);
      if (idx === -1) rec.subjects = [...(rec.subjects || []), nextSubject];
      else rec.subjects[idx] = { ...rec.subjects[idx], ...nextSubject };

      recalcRecord(rec);
      db.save("results", rec);
      if (explicit && canAdminister) db.save("auditLogs", { id: uuid(), type: "results", uid: ctx.user.uid, at: Date.now(), message: `Updated ${subject} result for ${student.fullName}` });
      computePositions(classId, term, session);

      rowEls.total.textContent = total;
      rowEls.grade.textContent = grading.grade;
      rowEls.remark.textContent = grading.remark;
      if (explicit) toast("Result updated", "success");
    };

    const rowDebouncers = {};
    const getDebouncer = (studentId) => {
      if (!rowDebouncers[studentId]) {
        rowDebouncers[studentId] = debounce((student, vals, rowEls, explicit = false) => {
          saveRowLogic(student, vals, rowEls, explicit);
        }, 800);
      }
      return rowDebouncers[studentId];
    };
    
    const saveRow = (student, vals, rowEls, explicit = false) => {
      if (explicit) {
        saveRowLogic(student, vals, rowEls, explicit);
      } else {
        getDebouncer(student.id)(student, vals, rowEls, explicit);
      }
    };

    const readVals = (rowEls) => ({
      ca1: rowEls.ca1.value,
      ca2: rowEls.ca2.value,
      exam: rowEls.exam.value,
      teacherComment: rowEls.teacherComment.value.trim(),
      headComment: rowEls.headComment.value.trim()
    });

    students.forEach(student => {
      const rec = findResult(student.id, classId, term, session);
      const subRec = (rec?.subjects || []).find(s => s.name === subject) || {};
      const tr = el("tr");
      tr.appendChild(el("td", { text: student.admissionNo }));
      tr.appendChild(el("td", { text: student.fullName }));

      const inputIdPrefix = `res-input-${student.admissionNo.replace(/[^a-zA-Z0-9]/g, '-')}`;

      const rowEls = {};
      const mkInput = (val, max, nextName, fieldName) => {
        const i = input({ type: "number", value: val != null ? val : "", max, min: 0, style: "width:62px", ...(readOnly ? { disabled: "disabled" } : {}) });
        if (fieldName) i.id = `${inputIdPrefix}-${fieldName}`;
        i.oninput = () => {
          let v = num(i.value);
          if (v > max) { i.value = max; toast(`Max score is ${max}`, "error"); }
          if (v < 0) i.value = 0;

          saveRow(student, readVals(rowEls), rowEls);
          
          // Auto-advance if the string length reaches the max possible length (e.g. 2 digits for 40)
          if (i.value.length >= String(max).length && nextName && rowEls[nextName]) {
            rowEls[nextName].focus();
            rowEls[nextName].select();
          }
        };
        i.onkeydown = (e) => {
          if (e.key === "Enter" && nextName && rowEls[nextName]) {
            rowEls[nextName].focus();
            rowEls[nextName].select();
          }
        };
        return i;
      };
      rowEls.ca1 = mkInput(subRec.ca1, MAX_SCORES.ca1, "ca2", "ca1");
      rowEls.ca2 = mkInput(subRec.ca2, MAX_SCORES.ca2, "exam", "ca2");
      rowEls.exam = mkInput(subRec.exam, MAX_SCORES.exam, null, "exam");
      rowEls.total = el("td", { text: subRec.total || "0", style: "font-weight:bold" });
      rowEls.grade = el("td", { text: subRec.grade || "-" });
      rowEls.remark = el("td", { text: subRec.remark || "-" });
      rowEls.teacherComment = input({ value: rec?.teacherComment || "", style: "min-width:160px", ...(readOnly ? { disabled: "disabled" } : {}) });
      rowEls.headComment = input({ value: rec?.headComment || "", style: "min-width:160px", ...(readOnly ? { disabled: "disabled" } : {}) });
      rowEls.teacherComment.oninput = () => saveRow(student, readVals(rowEls), rowEls);
      rowEls.headComment.oninput = () => saveRow(student, readVals(rowEls), rowEls);

      [rowEls.ca1, rowEls.ca2, rowEls.exam].forEach(i => tr.appendChild(el("td", {}, [i])));
      tr.appendChild(rowEls.total);
      tr.appendChild(rowEls.grade);
      tr.appendChild(rowEls.remark);
      tr.appendChild(el("td", {}, [rowEls.teacherComment]));
      tr.appendChild(el("td", {}, [rowEls.headComment]));
      tr.appendChild(el("td", {}, [el("div", { class: "row" }, [
        btn("Save", { sm: true, variant: "primary", attrs: readOnly ? { disabled: "disabled" } : {}, onclick: () => saveRow(student, readVals(rowEls), rowEls, true) }),
        btn("Delete", { sm: true, variant: "danger", attrs: readOnly ? { disabled: "disabled" } : {}, onclick: () => deleteSubject(student.id, classId, subject, term, session) })
      ])]));
      tbody.appendChild(tr);
    });

    const wfDiv = el("div", { class: "row", style: "margin-top:16px;gap:8px" });
    const statusBadge = el("span", { class: "badge", style: "margin-bottom:12px;display:inline-block", text: "Workflow Status: " + approval.status });

    if (!readOnly) {
      if (approval.status === "Draft") wfDiv.appendChild(btn("Submit to Exam Officer", { variant: "primary", onclick: () => updateStatus("Submitted") }));
      else if (approval.status === "Submitted" && canAdminister) {
        wfDiv.appendChild(btn("Approve", { variant: "success", onclick: () => updateStatus("Approved") }));
        wfDiv.appendChild(btn("Reject to Draft", { variant: "danger", onclick: () => updateStatus("Draft") }));
      }
    }
    if (canAdminister && isLocked) wfDiv.appendChild(btn("Unlock Sheet", { variant: "warning", onclick: () => updateStatus("Draft") }));
    if (canAdminister && approval.status === "Approved") wfDiv.appendChild(btn("Publish", { variant: "success", onclick: () => updateStatus("Published") }));

    function updateStatus(newStatus) {
      approval = { ...approval, status: newStatus, updatedAt: Date.now() };
      db.save("resultApprovals", approval);
      if (canAdminister) db.save("auditLogs", { id: uuid(), type: "resultApproval", uid: ctx.user.uid, at: Date.now(), message: `${subject} for ${cfg.className(classId)} is now ${newStatus}` });
      if (newStatus === "Published") computePositions(classId, term, session);
      toast(`Sheet status updated to ${newStatus}`, "success");
      loadSheet();
    }

    async function deleteSubject(studentId, classId, subject, term, session) {
      if (!(await confirmDialog("Delete this subject result for the selected student?", { danger: true, okText: "Delete" }))) return;
      const rec = findResult(studentId, classId, term, session);
      if (!rec) return;
      rec.subjects = (rec.subjects || []).filter(s => s.name !== subject);
      if (!rec.subjects.length) db.delete("results", rec.id);
      else db.save("results", recalcRecord(rec));
      computePositions(classId, term, session);
      toast("Result deleted", "success");
      loadSheet();
    }

    host.innerHTML = "";
    host.appendChild(card(`Entry Sheet: ${cfg.className(classId)} - ${subject}`, [
      statusBadge,
      el("div", { style: "overflow-x:auto" }, [tableEl]),
      wfDiv
    ]));
  }
}

function computePositions(classId, term = cfg.currentTerm(), session = cfg.currentSession()) {
  const recs = db.query("results", r => r.classId === classId && r.term === term && r.session === session);
  if (!recs.length) return;
  const classAvg = recs.reduce((a, r) => a + num(r.average), 0) / recs.length;
  
  const sorted = calculatePositions(recs);
  
  sorted.forEach((r) => {
    r.classSize = recs.length;
    r.classAverage = classAvg;
    db.save("results", r);
  });
}
