// Shared term-registration logic for Second/Third Term Registration modules.
// Generates charges + an invoice per student (never collects payment), links the
// student to a family ledger, logs activity and writes an audit record.
// Record-level and idempotent: a student already registered for the same term in
// the current session is skipped so no duplicate invoice/charge is ever created.
import { db } from "./db.js";
import { uuid, naira } from "./utils.js";
import * as cfg from "./config.js";
import { createInvoice, invoiceForStudent } from "./billing.js";
import { ensureFamilyForStudent } from "./family.js";
import { logActivity } from "./activity.js";

export function registrationType(term) { return term + " Registration"; }

export function existingRegistration(studentId, term) {
  const type = registrationType(term);
  return invoiceForStudent(studentId).find(
    (i) => i.type === type && i.session === cfg.currentSession() && i.term === term
  ) || null;
}

// Register a single student for a term. Returns { invoice, skipped }.
export async function registerStudentForTerm(student, lines, term, user) {
  const existing = existingRegistration(student.id, term);
  if (existing) return { invoice: existing, skipped: true };

  await ensureFamilyForStudent(student);
  const inv = await createInvoice({ student, services: lines, type: registrationType(term), term });
  db.save("auditLogs", {
    id: uuid(), type: "registration", uid: user.uid, at: Date.now(),
    message: `${term} registration for ${student.fullName} \u2014 ${inv.invoiceNo} (${naira(inv.totalAmount)})`
  });
  logActivity({
    module: registrationType(term), action: "Registered",
    description: `${term} registration \u2014 invoice ${inv.invoiceNo} (${naira(inv.totalAmount)})`,
    studentId: student.id, user: user.email
  });
  return { invoice: inv, skipped: false };
}
