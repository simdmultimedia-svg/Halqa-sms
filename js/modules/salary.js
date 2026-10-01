import { db } from "../core/db.js";
import { num, el, naira, toast, modal, uuid } from "../core/utils.js";
import { calculateNetSalary } from "../core/calculations.js";
import { card, pageHead, table, input, field, btn, select } from "../core/ui.js";
import { nextPayslipNo } from "../core/idgen.js";
import { can } from "../core/rbac.js";
import { showPayslip } from "./payslip.js";
import { attendanceSettings, attendanceSummaryForMonth } from "../core/staffattendance.js";
import { captureFingerprint, identifyFingerprint, fingerprintServiceAvailable } from "../core/fingerprint.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function computeNet(ps) {
  const perDay = num(ps.workingDays) ? num(ps.basic) / num(ps.workingDays) : 0;
  const absenceDeduction = ps.attendanceDeduction == null ? perDay * num(ps.daysAbsent) : num(ps.attendanceDeduction);
  ps.deduction = (ps.deductions || []).reduce((sum, d) => sum + num(d.amount), 0) + num(ps.legacyDeduction || 0);
  ps.bonus = (ps.bonuses || []).reduce((sum, b) => sum + num(b.amount), 0) + num(ps.legacyBonus || 0);
  return calculateNetSalary(ps.basic, [ps.officeAllowance, ps.specialAllowance], ps.bonus, ps.deduction, absenceDeduction);
}

export function render(root, ctx) {
  if (!can(ctx.user.role, "manageSalary")) { root.appendChild(pageHead("Salary")); root.appendChild(card("Access", [el("p", { class: "muted", text: "Only Admin / Accountant can manage salary." })])); return; }
  root.appendChild(pageHead("Salary", "Generate monthly payslips for staff."));
  const now = new Date();
  const monthSel = select(() => MONTHS.map((m, i) => ({ value: i, label: m, selected: i === now.getMonth() })));
  const yearInp = input({ type: "number", value: String(now.getFullYear()), style: "width:110px" });
  const workdays = input({ type: "number", value: String(attendanceSettings().workingDaysPerMonth), style: "width:90px" });
  const gen = btn("Generate Payslips", { variant: "primary", onclick: () => generate() });
  root.appendChild(card("Generate", [el("div", { class: "row" }, [field("Month", monthSel), field("Year", yearInp), field("Working Days", workdays), el("div", { style: "align-self:flex-end" }, [gen])])]));
  const host = el("div");
  root.appendChild(host);

  function monthKey() { return `${yearInp.value}-${String(num(monthSel.value) + 1).padStart(2, "0")}`; }

  function generate() {
    const staff = db.list("staff");
    if (!staff.length) return toast("No staff registered", "error");
    const key = monthKey();
    let created = 0;
    staff.forEach((s) => {
      const exists = db.find("payslips", (p) => p.staffId === s.id && p.month === key);
      if (exists) return;
      const att = attendanceSummaryForMonth(s.id, key, s, num(workdays.value));
      
      const perf = db.query("staffPerformance", p => p.staffId === s.id && p.month === key);
      const perfBonus = perf.length > 0 ? num(perf[0].monthlyBonus) : 0;
      const defaultBonuses = [];
      if (perfBonus > 0) {
        defaultBonuses.push({ id: uuid(), amount: perfBonus, reason: "Performance Bonus", date: Date.now(), createdBy: "System" });
      }

      const ps = {
        id: uuid(), staffId: s.id, staffName: s.name, month: key, monthLabel: `${MONTHS[num(monthSel.value)]} ${yearInp.value}`,
        basic: num(s.basic), officeAllowance: num(s.officeAllowance), specialAllowance: num(s.specialAllowance),
        workingDays: num(workdays.value), daysAbsent: att.absent, bonus: perfBonus, deduction: 0,
        bonuses: defaultBonuses, deductions: [],
        attendanceDeduction: att.deductions, latenessDeduction: att.latenessDeduction, absenceDeduction: att.absenceDeduction,
        lateDays: att.late, latePermissionDays: att.latePermission, absentPermissionDays: att.absentPermission,
        attendanceRecords: att.records, remarks: "", payDate: Date.now(), createdAt: Date.now(), status: "draft"
      };
      ps.netPay = computeNet(ps);
      db.save("payslips", ps); created++;
    });
    toast(`${created} payslip(s) generated`, "success");
    draw();
  }

  function draw() {
    const key = monthKey();
    const rows = db.query("payslips", (p) => p.month === key).sort((a, b) => (a.staffName || "").localeCompare(b.staffName || ""));
    const publishAllBtn = btn("Publish All Drafts", { variant: "success", onclick: async () => {
      const drafts = rows.filter(p => p.status !== "published");
      if (!drafts.length) return toast("No drafts to publish", "info");
      if (!confirm(`Publish ${drafts.length} payslips to staff dashboards?`)) return;
      for (const p of drafts) {
        if (!p.payslipNo) p.payslipNo = await nextPayslipNo();
        p.status = "published";
        db.save("payslips", p);
      }
      toast("Payslips published", "success");
      draw();
    }});
    const wipeAllBtn = btn("Wipe All (" + rows.length + ")", { variant: "danger", onclick: () => {
      if (!rows.length) return toast("No payslips to delete", "info");
      if (!confirm(`⚠️ DELETE all ${rows.length} payslips for ${key}? This cannot be undone.`)) return;
      if (!confirm(`Are you absolutely sure? This will permanently remove ${rows.length} payslip(s).`)) return;
      rows.forEach(p => db.remove("payslips", p.id));
      toast(`${rows.length} payslip(s) deleted`, "success");
      draw();
    }});
    host.innerHTML = "";
    host.appendChild(card(`Payslips \u2014 ${key}`, [
      el("div", { style: "margin-bottom: 10px; display: flex; gap: 8px; flex-wrap: wrap;" }, [publishAllBtn, wipeAllBtn]),
      table([
      { label: "Payslip", key: "payslipNo", render: (p) => p.payslipNo || "(draft)" },
      { label: "Staff", key: "staffName" }, { label: "Basic", align: "right", render: (p) => naira(p.basic) },
      { label: "Bonus", align: "right", render: (p) => naira(p.bonus) }, { label: "Attendance Deduction", align: "right", render: (p) => naira(p.attendanceDeduction) },
      { label: "Other Deduction", align: "right", render: (p) => naira(p.deduction) },
      { label: "Net Pay", align: "right", render: (p) => naira(p.netPay) },
      { label: "", render: (p) => el("div", { class: "row", style: "gap: 4px;" }, [
        btn("Edit", { sm: true, onclick: () => editPs(p.id) }),
        p.status === "published" 
          ? btn("View", { sm: true, variant: "primary", onclick: () => finalizeAndShow(p.id) }) 
          : btn("Publish", { sm: true, variant: "success", onclick: async () => {
              if (!p.payslipNo) p.payslipNo = await nextPayslipNo();
              p.status = "published"; db.save("payslips", p);
              toast("Published to staff dashboard", "success"); draw();
            }}),
        btn("🗑", { sm: true, variant: "danger", onclick: () => {
          if (!confirm(`Delete payslip for ${p.staffName}?`)) return;
          db.remove("payslips", p.id);
          toast("Payslip deleted", "success"); draw();
        }})
      ]) }
    ], rows, { empty: "No payslips for this month yet. Click Generate." })]));
  }
  draw();

  function editPs(id) {
    const p = db.get("payslips", id);
    if (!p.bonuses) p.bonuses = p.bonus ? [{ id: uuid(), amount: p.bonus, reason: "Legacy Bonus", date: Date.now(), createdBy: "System" }] : [];
    if (!p.deductions) p.deductions = p.deduction ? [{ id: uuid(), amount: p.deduction, reason: "Legacy Deduction", date: Date.now(), createdBy: "System" }] : [];
    
    p.legacyBonus = 0;
    p.legacyDeduction = 0;

    let localBonuses = [...p.bonuses];
    let localDeductions = [...p.deductions];

    const daysAbsent = input({ type: "number", value: String(p.daysAbsent) });
    const attendanceDeduction = input({ type: "number", value: String(p.attendanceDeduction == null ? 0 : p.attendanceDeduction) });
    const remarks = input({ value: p.remarks || "" });
    
    const bonusContainer = el("div", { style: "margin-top:15px; border-top: 1px solid #ddd; padding-top: 10px;" });
    const dedContainer = el("div", { style: "margin-top:15px; border-top: 1px solid #ddd; padding-top: 10px;" });

    const renderLists = () => {
        bonusContainer.innerHTML = "<b>Bonuses</b><br>";
        localBonuses.forEach(b => {
            const row = el("div", { class: "row", style: "gap: 5px; margin-bottom: 5px;" }, [
                el("span", { text: `${b.reason}: ${naira(b.amount)}`, style: "flex: 1;" }),
                btn("\u2715", { sm: true, variant: "danger", onclick: () => { localBonuses = localBonuses.filter(x => x.id !== b.id); renderLists(); } })
            ]);
            bonusContainer.appendChild(row);
        });
        const addBBtn = btn("+ Add Bonus", { sm: true, onclick: () => {
            const amt = prompt("Enter Bonus Amount (\u20A6):");
            if (!amt || isNaN(amt)) return;
            const rsn = prompt("Enter Bonus Reason:");
            if (!rsn) return;
            localBonuses.push({ id: uuid(), amount: num(amt), reason: rsn, date: Date.now(), createdBy: ctx.user.email });
            renderLists();
        }});
        bonusContainer.appendChild(addBBtn);

        dedContainer.innerHTML = "<b>Deductions</b><br>";
        localDeductions.forEach(d => {
            const row = el("div", { class: "row", style: "gap: 5px; margin-bottom: 5px;" }, [
                el("span", { text: `${d.reason}: ${naira(d.amount)}`, style: "flex: 1;" }),
                btn("\u2715", { sm: true, variant: "danger", onclick: () => { localDeductions = localDeductions.filter(x => x.id !== d.id); renderLists(); } })
            ]);
            dedContainer.appendChild(row);
        });
        const addDBtn = btn("+ Add Deduction", { sm: true, onclick: () => {
            const amt = prompt("Enter Deduction Amount (\u20A6):");
            if (!amt || isNaN(amt)) return;
            const rsn = prompt("Enter Deduction Reason:");
            if (!rsn) return;
            localDeductions.push({ id: uuid(), amount: num(amt), reason: rsn, date: Date.now(), createdBy: ctx.user.email });
            renderLists();
        }});
        dedContainer.appendChild(addDBtn);
    };

    renderLists();

    const body = el("div", { class: "form-grid" }, [
      field("Days Absent", daysAbsent),
      field("Attendance Deduction (\u20A6)", attendanceDeduction),
      field("Remarks", remarks, { full: true })
    ]);
    body.appendChild(bonusContainer);
    body.appendChild(dedContainer);

    const approvalContainer = el("div", { style: "margin-top:15px; border-top: 1px solid #ddd; padding-top: 10px;" });
    const renderApproval = () => {
        approvalContainer.innerHTML = "";
        if (p.biometricApprovedBy) {
            const approver = db.get("users", p.biometricApprovedBy) || db.get("staff", p.biometricApprovedBy) || { name: p.biometricApprovedBy };
            approvalContainer.appendChild(el("div", { class: "tag green" }, [document.createTextNode(`✓ Biometrically Approved by ${approver.name || approver.email || p.biometricApprovedBy}`)]));
        } else {
            const approveBtn = btn("Approve via Fingerprint", { variant: "secondary", onclick: async () => {
                const isAvail = await fingerprintServiceAvailable();
                if (!isAvail) return toast("Hardware scanner service not available.", "error");
                
                approveBtn.disabled = true; approveBtn.textContent = "Scanning...";
                try {
                    const capture = await captureFingerprint();
                    if (!capture.success) throw new Error(capture.error || "Capture failed");
                    
                    const allPrints = db.list("fingerprints").filter(f => f.role === "staff");
                    if (allPrints.length === 0) throw new Error("No staff fingerprints enrolled.");
                    
                    approveBtn.textContent = "Identifying...";
                    const match = await identifyFingerprint(capture.template, allPrints.map(f => f.template));
                    if (!match.success) throw new Error(match.error || "Unrecognized fingerprint");
                    
                    const matchedPrint = allPrints[match.matchIndex];
                    const ownerId = matchedPrint.ownerId;
                    
                    const staffRec = db.get("staff", ownerId);
                    if (!staffRec) throw new Error("Staff record not found.");
                    
                    if (staffRec.role !== "Super Admin" && staffRec.role !== "Accountant") {
                        throw new Error("Unauthorized. Only Super Admin or Accountant can biometrically approve payslips.");
                    }
                    
                    p.biometricApprovedBy = ownerId;
                    toast("Payslip biometrically approved", "success");
                    renderApproval();
                } catch (err) {
                    toast(err.message, "error");
                    approveBtn.disabled = false; approveBtn.textContent = "Approve via Fingerprint";
                }
            }});
            approvalContainer.appendChild(approveBtn);
        }
    };
    renderApproval();
    body.appendChild(approvalContainer);

    const m = modal({ title: "Edit Payslip \u2014 " + p.staffName, body, footer: [btn("Save", { variant: "primary", onclick: () => {
      Object.assign(p, { 
        daysAbsent: num(daysAbsent.value), 
        attendanceDeduction: num(attendanceDeduction.value), 
        remarks: remarks.value,
        bonuses: localBonuses,
        deductions: localDeductions
      });
      p.netPay = computeNet(p); 
      db.save("payslips", p); 
      toast("Updated", "success"); 
      m.close(); 
      draw();
    } })] });
  }

  async function finalizeAndShow(id) {
    const p = db.get("payslips", id);
    if (!p.payslipNo) { p.payslipNo = await nextPayslipNo(); p.status = "published"; db.save("payslips", p); }
    showPayslip(id, ctx);
  }
}
