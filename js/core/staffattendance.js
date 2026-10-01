import { db } from "./db.js";
import { num } from "./utils.js";

export const STAFF_ATTENDANCE_STATUSES = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "late_permission", label: "Late With Permission" },
  { value: "absent", label: "Absent" },
  { value: "absent_permission", label: "Absent With Permission" }
];

export function attendanceSettings() {
  const s = db.setting("attendanceSettings") || {};
  return {
    officialResumptionTime: s.officialResumptionTime || "",
    latePenalty1: num(s.latePenalty1) || 0,
    latePenalty2: num(s.latePenalty2) || 0,
    dailySalaryMethod: s.dailySalaryMethod || "basic",
    workingDaysPerMonth: num(s.workingDaysPerMonth) || 0
  };
}

export function statusLabel(status) {
  const key = normalizeStatus(status);
  return STAFF_ATTENDANCE_STATUSES.find((s) => s.value === key)?.label || status || "";
}

export function normalizeStatus(status) {
  const s = String(status || "present").toLowerCase().replace(/\s+/g, "_");
  if (s === "late_with_permission" || s === "late_permission") return "late_permission";
  if (s === "absent_with_permission" || s === "absent_permission") return "absent_permission";
  if (s === "late") return "late";
  if (s === "absent") return "absent";
  return "present";
}

export function isPresentStatus(status) {
  const s = normalizeStatus(status);
  return s === "present" || s === "late" || s === "late_permission";
}

export function isLateStatus(status) {
  const s = normalizeStatus(status);
  return s === "late" || s === "late_permission";
}

export function isPermissionStatus(status) {
  const s = normalizeStatus(status);
  return s === "late_permission" || s === "absent_permission";
}

export function timeToMinutes(time) {
  const parts = String(time || "").split(":");
  return num(parts[0]) * 60 + num(parts[1]);
}

export function salaryBase(staff, method = attendanceSettings().dailySalaryMethod) {
  const basic = num(staff?.basic);
  if (method === "gross") return basic + num(staff?.officeAllowance) + num(staff?.specialAllowance);
  return basic;
}

export function dailyRate(staff, settings = attendanceSettings(), fallbackWorkingDays = null) {
  const days = num(fallbackWorkingDays) || num(settings.workingDaysPerMonth) || 0;
  return days > 0 ? salaryBase(staff, settings.dailySalaryMethod) / days : 0;
}

export function computeAttendanceDeduction({ staff, status, arrivalTime, workingDays } = {}) {
  const settings = attendanceSettings();
  const normalized = normalizeStatus(status);
  if (normalized === "late") {
    if (!settings.officialResumptionTime) return 0;
    const arrived = timeToMinutes(arrivalTime || settings.officialResumptionTime);
    const official = timeToMinutes(settings.officialResumptionTime);
    if (arrived <= official) return 0;
    return arrived >= official + 30 ? settings.latePenalty2 : settings.latePenalty1;
  }
  if (normalized === "absent") return dailyRate(staff, settings, workingDays);
  return 0;
}

export function attendanceSummaryForMonth(staffId, monthKey, staff, workingDays = null) {
  const summary = {
    present: 0,
    late: 0,
    latePermission: 0,
    absent: 0,
    absentPermission: 0,
    deductions: 0,
    latenessDeduction: 0,
    absenceDeduction: 0,
    records: []
  };
  db.list("staffAttendance").forEach((day) => {
    if (!String(day.date || "").startsWith(monthKey)) return;
    const rec = (day.records || []).find((r) => r.staffId === staffId);
    if (!rec) return;
    const status = normalizeStatus(rec.status);
    const deduction = rec.deduction == null
      ? computeAttendanceDeduction({ staff, status, arrivalTime: rec.arrivalTime, workingDays })
      : num(rec.deduction);
    summary.records.push({ ...rec, date: day.date, status, deduction });
    if (status === "present") summary.present++;
    if (status === "late") {
      summary.late++;
      summary.latenessDeduction += deduction;
    }
    if (status === "late_permission") summary.latePermission++;
    if (status === "absent") {
      summary.absent++;
      summary.absenceDeduction += deduction;
    }
    if (status === "absent_permission") summary.absentPermission++;
    summary.deductions += deduction;
  });
  return summary;
}
