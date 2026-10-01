// Scholarship & Discount Management Module
// Full CRUD for scholarship plans, discount plans, student assignments,
// and comprehensive financial impact reports.
import { db } from "../core/db.js";
import { el, toast, naira, num, fmtDate, modal } from "../core/utils.js";
import { card, pageHead, table, btn, input, field, select, studentPicker } from "../core/ui.js";
import { can } from "../core/rbac.js";
import { logActivity } from "../core/activity.js";
import * as cfg from "../core/config.js";
import {
  SCHOLARSHIP_TYPES, DISCOUNT_TYPES, SCHOLARSHIP_ROLES,
  listScholarships, saveScholarship, deleteScholarship,
  listDiscounts, saveDiscount, deleteDiscount,
  listStudentScholarships, listStudentDiscounts,
  allStudentScholarships, allStudentDiscounts,
  assignScholarship, revokeStudentScholarship,
  assignDiscount, revokeStudentDiscount,
  computeAllDeductions
} from "../core/scholarships.js";

const canManage = (role) =>
  SCHOLARSHIP_ROLES.includes(role) || can(role, "manageSettings");

export function render(root, ctx) {
  root.appendChild(pageHead(
    "Scholarships & Discounts",
    "Manage scholarship plans, discount plans, student assignments, and financial benefit reports."
  ));

  if (!canManage(ctx.user.role)) {
    root.appendChild(card("Access Denied", [
      el("p", { class: "muted", text: "Only Admin, Principal, Proprietor, or Finance Manager can manage scholarships and discounts." })
    ]));
    return;
  }

  const tabs = el("div", { class: "row", style: "margin-bottom:16px;flex-wrap:wrap;gap:8px" }, [
    btn("Scholarship Plans", { variant: "primary", icon: "🎓", onclick: () => showTab("plans-scholar") }),
    btn("Discount Plans", { icon: "🏷️", onclick: () => showTab("plans-discount") }),
    btn("Assign Scholarship", { icon: "✅", onclick: () => showTab("assign-scholar") }),
    btn("Assign Discount", { icon: "✅", onclick: () => showTab("assign-discount") }),
    btn("Student Benefits", { icon: "👤", onclick: () => showTab("student-view") }),
    btn("Reports", { icon: "📊", onclick: () => showTab("reports") })
  ]);
  root.appendChild(tabs);

  const host = el("div");
  root.appendChild(host);

  function showTab(tab) {
    host.innerHTML = "";
    if (tab === "plans-scholar") renderScholarshipPlans();
    else if (tab === "plans-discount") renderDiscountPlans();
    else if (tab === "assign-scholar") renderAssignScholarship();
    else if (tab === "assign-discount") renderAssignDiscount();
    else if (tab === "student-view") renderStudentBenefits();
    else if (tab === "reports") renderReports();
  }

  // ─── Scholarship Plans ─────────────────────────────────────────────────────

  function renderScholarshipPlans() {
    host.innerHTML = "";
    const c = card("Scholarship Plans",
      [table([
        { label: "Name", key: "name" },
        { label: "Type", key: "type" },
        { label: "Value", render: (s) => s.valueType === "percent" ? `${s.value}%` : naira(s.value) },
        { label: "Status", render: (s) => el("span", { class: `tag ${s.status === "Active" ? "green" : "red"}`, text: s.status }) },
        { label: "Created", render: (s) => fmtDate(s.createdAt) },
        {
          label: "", render: (s) => el("div", { class: "row", style: "gap:4px" }, [
            btn("Edit", { sm: true, onclick: () => scholarshipForm(s) }),
            btn("Delete", { sm: true, variant: "danger", onclick: () => confirmDelete("scholarship", s.id, s.name) })
          ])
        }
      ], listScholarships(), { empty: "No scholarship plans created yet." })],
      btn("+ New Scholarship Plan", { variant: "primary", icon: "🎓", onclick: () => scholarshipForm(null) })
    );
    host.appendChild(c);
  }

  function scholarshipForm(existing) {
    const isNew = !existing;
    const name = input({ value: existing?.name || "", placeholder: "e.g. Academic Excellence Award" });
    const typeSel = select(() => [...SCHOLARSHIP_TYPES.map((t) => ({ value: t, label: t, selected: existing?.type === t }))]);
    const valueType = select(() => [
      { value: "percent", label: "Percentage (%)", selected: (existing?.valueType || "percent") === "percent" },
      { value: "fixed", label: "Fixed Amount (₦)", selected: existing?.valueType === "fixed" }
    ]);
    const value = input({ type: "number", min: "0", value: existing?.value || "", placeholder: "e.g. 50 or 50000" });
    const sessionInp = input({ value: existing?.session || cfg.currentSession(), placeholder: "e.g. 2025/2026" });
    const termInp = select(() => [
      { value: "All Terms", label: "All Terms", selected: (existing?.term || "All Terms") === "All Terms" },
      { value: "First Term", label: "First Term", selected: existing?.term === "First Term" },
      { value: "Second Term", label: "Second Term", selected: existing?.term === "Second Term" },
      { value: "Third Term", label: "Third Term", selected: existing?.term === "Third Term" }
    ]);
    const effectiveDate = input({ type: "date", value: existing?.effectiveDate || new Date().toISOString().slice(0, 10) });
    const statusSel = select(() => [
      { value: "Active", label: "Active", selected: (existing?.status || "Active") === "Active" },
      { value: "Inactive", label: "Inactive", selected: existing?.status === "Inactive" }
    ]);
    const notes = input({ value: existing?.description || existing?.notes || "", placeholder: "Description, eligibility, or approval note" });

    const body = el("div", { class: "form-grid" }, [
      field("Scholarship Name", name),
      field("Type", typeSel),
      field("Value Type", valueType),
      field("Value (% or ₦)", value),
      field("Session", sessionInp),
      field("Term", termInp),
      field("Effective Date", effectiveDate),
      field("Status", statusSel),
      field("Description", notes, { full: true })
    ]);

    const m = modal({
      title: isNew ? "New Scholarship Plan" : "Edit Scholarship Plan",
      body,
      footer: [
        btn("Save", {
          variant: "success", onclick: () => {
            if (!name.value.trim()) return toast("Enter a name", "error");
            if (!value.value || num(value.value) <= 0) return toast("Enter a valid value", "error");
            const plan = saveScholarship({
              id: existing?.id || undefined,
              name: name.value.trim(),
              type: typeSel.value,
              valueType: valueType.value,
              value: num(value.value),
              session: sessionInp.value.trim(),
              term: termInp.value,
              effectiveDate: effectiveDate.value,
              status: statusSel.value,
              description: notes.value,
              notes: notes.value,
              createdAt: existing?.createdAt || Date.now(),
              createdBy: existing?.createdBy || ctx.user.uid
            });
            db.save("auditLogs", {
              id: "sch-" + plan.id, type: "scholarship", uid: ctx.user.uid, at: Date.now(),
              message: `${isNew ? "Created" : "Updated"} scholarship plan: ${plan.name}`
            });
            logActivity({ module: "Scholarships", action: isNew ? "Plan Created" : "Plan Updated", description: `${isNew ? "Created" : "Updated"} scholarship plan: ${plan.name}`, user: ctx.user.email });
            toast(isNew ? "Scholarship plan created" : "Plan updated", "success");
            m.close();
            renderScholarshipPlans();
          }
        }),
        btn("Cancel", { onclick: () => m.close() })
      ]
    });
  }

  function confirmDelete(type, id, name) {
    const m = modal({
      title: "Confirm Delete",
      body: el("p", { text: `Are you sure you want to delete "${name}"? This cannot be undone.` }),
      footer: [
        btn("Delete", {
          variant: "danger", onclick: () => {
            if (type === "scholarship") deleteScholarship(id);
            else deleteDiscount(id);
            db.save("auditLogs", { id: "del-" + id, type: "delete", uid: ctx.user.uid, at: Date.now(), message: `Deleted ${type} plan: ${name}` });
            toast("Deleted successfully", "success");
            m.close();
            if (type === "scholarship") renderScholarshipPlans();
            else renderDiscountPlans();
          }
        }),
        btn("Cancel", { onclick: () => m.close() })
      ]
    });
  }

  // ─── Discount Plans ────────────────────────────────────────────────────────

  function renderDiscountPlans() {
    host.innerHTML = "";
    const c = card("Discount Plans",
      [table([
        { label: "Name", key: "name" },
        { label: "Type", key: "type" },
        { label: "Value", render: (s) => s.valueType === "percent" ? `${s.value}%` : naira(s.value) },
        { label: "Status", render: (s) => el("span", { class: `tag ${s.status === "Active" ? "green" : "red"}`, text: s.status }) },
        { label: "Auto", render: (s) => s.autoManaged ? el("span", { class: "tag orange", text: "Auto" }) : el("span", { class: "muted", text: "—" }) },
        {
          label: "", render: (s) => s.autoManaged ? el("span", { class: "muted", text: "System Managed" }) : el("div", { class: "row", style: "gap:4px" }, [
            btn("Edit", { sm: true, onclick: () => discountForm(s) }),
            btn("Delete", { sm: true, variant: "danger", onclick: () => confirmDelete("discount", s.id, s.name) })
          ])
        }
      ], listDiscounts(), { empty: "No discount plans created yet." })],
      btn("+ New Discount Plan", { variant: "primary", icon: "🏷️", onclick: () => discountForm(null) })
    );
    host.appendChild(c);
  }

  function discountForm(existing) {
    const isNew = !existing;
    const name = input({ value: existing?.name || "", placeholder: "e.g. Early Bird Discount" });
    const typeSel = select(() => [...DISCOUNT_TYPES.map((t) => ({ value: t, label: t, selected: existing?.type === t }))]);
    const valueType = select(() => [
      { value: "percent", label: "Percentage (%)", selected: (existing?.valueType || "percent") === "percent" },
      { value: "fixed", label: "Fixed Amount (₦)", selected: existing?.valueType === "fixed" }
    ]);
    const value = input({ type: "number", min: "0", value: existing?.value || "", placeholder: "e.g. 5 or 10000" });
    const discountSessionInp = input({ value: existing?.session || cfg.currentSession(), placeholder: "e.g. 2025/2026" });
    const discountTermInp = select(() => [
      { value: "All Terms", label: "All Terms", selected: (existing?.term || "All Terms") === "All Terms" },
      { value: "First Term", label: "First Term", selected: existing?.term === "First Term" },
      { value: "Second Term", label: "Second Term", selected: existing?.term === "Second Term" },
      { value: "Third Term", label: "Third Term", selected: existing?.term === "Third Term" }
    ]);
    const statusSel = select(() => [
      { value: "Active", label: "Active", selected: (existing?.status || "Active") === "Active" },
      { value: "Inactive", label: "Inactive", selected: existing?.status === "Inactive" }
    ]);
    const notes = input({ value: existing?.description || existing?.notes || "", placeholder: "Description, approval note, or conditions" });

    const body = el("div", { class: "form-grid" }, [
      field("Discount Name", name),
      field("Type", typeSel),
      field("Value Type", valueType),
      field("Value (% or ₦)", value),
      field("Session", discountSessionInp),
      field("Term", discountTermInp),
      field("Status", statusSel),
      field("Description / Conditions", notes, { full: true })
    ]);

    const m = modal({
      title: isNew ? "New Discount Plan" : "Edit Discount Plan",
      body,
      footer: [
        btn("Save", {
          variant: "success", onclick: () => {
            if (!name.value.trim()) return toast("Enter a name", "error");
            if (!value.value || num(value.value) <= 0) return toast("Enter a valid value", "error");
            const plan = saveDiscount({
              id: existing?.id || undefined,
              name: name.value.trim(),
              type: typeSel.value,
              valueType: valueType.value,
              value: num(value.value),
              session: discountSessionInp.value.trim(),
              term: discountTermInp.value,
              status: statusSel.value,
              description: notes.value,
              notes: notes.value,
              createdAt: existing?.createdAt || Date.now(),
              createdBy: existing?.createdBy || ctx.user.uid
            });
            db.save("auditLogs", {
              id: "disc-" + plan.id, type: "discount", uid: ctx.user.uid, at: Date.now(),
              message: `${isNew ? "Created" : "Updated"} discount plan: ${plan.name}`
            });
            logActivity({ module: "Discounts", action: isNew ? "Plan Created" : "Plan Updated", description: `${isNew ? "Created" : "Updated"} discount plan: ${plan.name}`, user: ctx.user.email });
            toast(isNew ? "Discount plan created" : "Plan updated", "success");
            m.close();
            renderDiscountPlans();
          }
        }),
        btn("Cancel", { onclick: () => m.close() })
      ]
    });
  }

  // ─── Assign Scholarship ────────────────────────────────────────────────────

  function renderAssignScholarship() {
    host.innerHTML = "";
    const c = card("Assign Scholarship to Student");
    c.appendChild(el("p", { class: "muted", text: "Select a student and an approved scholarship plan. The discount will automatically apply when generating invoices for the selected session/term." }));

    let pickedStudent = null;
    const picker = studentPicker((sel) => {
      pickedStudent = sel.studentId ? db.get("students", sel.studentId) : null;
      refreshAssignments();
    });
    c.appendChild(picker.wrap);

    const schSel = select(() => [{ value: "", label: "Select Scholarship Plan" },
      ...listScholarships().filter((s) => s.status === "Active").map((s) => ({
        value: s.id, label: `${s.name} (${s.valueType === "percent" ? s.value + "%" : naira(s.value)})`
      }))
    ]);
    const sessionInput = input({ value: cfg.currentSession(), placeholder: "e.g. 2025/2026" });
    const termSel = select(() => [
      { value: "All Terms", label: "All Terms" },
      { value: "First Term", label: "First Term" },
      { value: "Second Term", label: "Second Term" },
      { value: "Third Term", label: "Third Term" }
    ]);
    const expiryInput = input({ value: "", placeholder: "e.g. 2026/2027 (blank = no expiry)" });

    const form = el("div", { class: "form-grid", style: "margin-top:14px" }, [
      field("Scholarship Plan", schSel),
      field("Effective Session", sessionInput),
      field("Effective Term", termSel),
      field("Expiry Session (optional)", expiryInput)
    ]);
    c.appendChild(form);

    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [
      btn("Assign Scholarship", {
        variant: "success", icon: "✅", onclick: () => {
          if (!pickedStudent) return toast("Select a student first", "error");
          if (!schSel.value) return toast("Select a scholarship plan", "error");
          try {
            const result = assignScholarship({
              studentId: pickedStudent.id,
              scholarshipId: schSel.value,
              approvedBy: ctx.user.name || ctx.user.email,
              effectiveSession: sessionInput.value,
              effectiveTerm: termSel.value,
              expirySession: expiryInput.value
            });
            const plan = listScholarships().find((s) => s.id === schSel.value);
            db.save("auditLogs", {
              id: "asgn-sch-" + result.id, type: "scholarship-assign", uid: ctx.user.uid, at: Date.now(),
              message: `Granted ${plan?.name} to ${pickedStudent.fullName} (${pickedStudent.admissionNo}) for ${sessionInput.value} ${termSel.value}`
            });
            logActivity({
              module: "Scholarships", action: "Scholarship Assigned",
              description: `Assigned ${plan?.name} to ${pickedStudent.fullName} for ${sessionInput.value} ${termSel.value}`,
              studentId: pickedStudent.id, user: ctx.user.email
            });
            toast(`Scholarship assigned to ${pickedStudent.fullName}`, "success");
            refreshAssignments();
          } catch (e) { toast(e.message, "error"); }
        }
      })
    ]));

    const assignHost = el("div", { style: "margin-top:16px" });
    c.appendChild(assignHost);
    host.appendChild(c);

    function refreshAssignments() {
      assignHost.innerHTML = "";
      if (!pickedStudent) return;
      const assignments = db.query("studentScholarships", (r) => r.studentId === pickedStudent.id)
        .sort((a, b) => b.createdAt - a.createdAt);
      assignHost.appendChild(card(`Scholarships for ${pickedStudent.fullName}`, [
        table([
          { label: "Scholarship", key: "scholarshipName" },
          { label: "Value", render: (a) => a.valueType === "percent" ? `${a.value}%` : naira(a.value) },
          { label: "Session", key: "effectiveSession" },
          { label: "Term", key: "effectiveTerm" },
          { label: "Status", render: (a) => el("span", { class: `tag ${a.status === "Active" ? "green" : "red"}`, text: a.status }) },
          { label: "Approved By", key: "approvedBy" },
          { label: "Date", render: (a) => fmtDate(a.approvalDate) },
          {
            label: "", render: (a) => a.status === "Active" ? btn("Revoke", {
              sm: true, variant: "danger", onclick: () => {
                revokeStudentScholarship(a.id, ctx.user.name || ctx.user.email);
                db.save("auditLogs", { id: "rev-sch-" + a.id, type: "revoke", uid: ctx.user.uid, at: Date.now(), message: `Revoked ${a.scholarshipName} from ${pickedStudent.fullName}` });
                toast("Scholarship revoked", "success");
                refreshAssignments();
              }
            }) : el("span", { class: "muted", text: "—" })
          }
        ], assignments, { empty: "No scholarships assigned yet." })
      ]));
    }
  }

  // ─── Assign Discount ───────────────────────────────────────────────────────

  function renderAssignDiscount() {
    host.innerHTML = "";
    const c = card("Assign Discount to Student");
    c.appendChild(el("p", { class: "muted", text: "Select a student and a discount plan. Family discounts can also be auto-applied from Settings." }));

    let pickedStudent = null;
    const picker = studentPicker((sel) => {
      pickedStudent = sel.studentId ? db.get("students", sel.studentId) : null;
      refreshAssignments();
    });
    c.appendChild(picker.wrap);

    const discSel = select(() => [{ value: "", label: "Select Discount Plan" },
      ...listDiscounts().filter((s) => s.status === "Active").map((s) => ({
        value: s.id, label: `${s.name} (${s.valueType === "percent" ? s.value + "%" : naira(s.value)})`
      }))
    ]);
    const sessionInput = input({ value: cfg.currentSession(), placeholder: "e.g. 2025/2026" });
    const termSel = select(() => [
      { value: "All Terms", label: "All Terms" },
      { value: "First Term", label: "First Term" },
      { value: "Second Term", label: "Second Term" },
      { value: "Third Term", label: "Third Term" }
    ]);

    const form = el("div", { class: "form-grid", style: "margin-top:14px" }, [
      field("Discount Plan", discSel),
      field("Effective Session", sessionInput),
      field("Effective Term", termSel)
    ]);
    c.appendChild(form);

    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [
      btn("Assign Discount", {
        variant: "success", icon: "✅", onclick: () => {
          if (!pickedStudent) return toast("Select a student first", "error");
          if (!discSel.value) return toast("Select a discount plan", "error");
          try {
            const result = assignDiscount({
              studentId: pickedStudent.id,
              discountId: discSel.value,
              approvedBy: ctx.user.name || ctx.user.email,
              effectiveSession: sessionInput.value,
              effectiveTerm: termSel.value
            });
            const plan = listDiscounts().find((d) => d.id === discSel.value);
            db.save("auditLogs", {
              id: "asgn-disc-" + result.id, type: "discount-assign", uid: ctx.user.uid, at: Date.now(),
              message: `Granted ${plan?.name} to ${pickedStudent.fullName} (${pickedStudent.admissionNo}) for ${sessionInput.value} ${termSel.value}`
            });
            logActivity({
              module: "Discounts", action: "Discount Assigned",
              description: `Assigned ${plan?.name} to ${pickedStudent.fullName} for ${sessionInput.value} ${termSel.value}`,
              studentId: pickedStudent.id, user: ctx.user.email
            });
            toast(`Discount assigned to ${pickedStudent.fullName}`, "success");
            refreshAssignments();
          } catch (e) { toast(e.message, "error"); }
        }
      })
    ]));

    const assignHost = el("div", { style: "margin-top:16px" });
    c.appendChild(assignHost);
    host.appendChild(c);

    function refreshAssignments() {
      assignHost.innerHTML = "";
      if (!pickedStudent) return;
      const assignments = db.query("studentDiscounts", (r) => r.studentId === pickedStudent.id)
        .sort((a, b) => b.createdAt - a.createdAt);
      assignHost.appendChild(card(`Discounts for ${pickedStudent.fullName}`, [
        table([
          { label: "Discount", key: "discountName" },
          { label: "Value", render: (a) => a.valueType === "percent" ? `${a.value}%` : naira(a.value) },
          { label: "Session", key: "effectiveSession" },
          { label: "Term", key: "effectiveTerm" },
          { label: "Status", render: (a) => el("span", { class: `tag ${a.status === "Active" ? "green" : "red"}`, text: a.status }) },
          { label: "Approved By", key: "approvedBy" },
          {
            label: "", render: (a) => a.status === "Active" ? btn("Revoke", {
              sm: true, variant: "danger", onclick: () => {
                revokeStudentDiscount(a.id, ctx.user.name || ctx.user.email);
                db.save("auditLogs", { id: "rev-disc-" + a.id, type: "revoke", uid: ctx.user.uid, at: Date.now(), message: `Revoked ${a.discountName} from ${pickedStudent.fullName}` });
                toast("Discount revoked", "success");
                refreshAssignments();
              }
            }) : el("span", { class: "muted", text: "—" })
          }
        ], assignments, { empty: "No discounts assigned yet." })
      ]));
    }
  }

  // ─── Student Benefits View ─────────────────────────────────────────────────

  function renderStudentBenefits() {
    host.innerHTML = "";
    const c = card("Student Financial Benefits");
    c.appendChild(el("p", { class: "muted", text: "View all active scholarships and discounts for any student, including live bill preview." }));

    let pickedStudent = null;
    const picker = studentPicker((sel) => {
      pickedStudent = sel.studentId ? db.get("students", sel.studentId) : null;
      refreshBenefits();
    });
    c.appendChild(picker.wrap);

    const benefitHost = el("div", { style: "margin-top:16px" });
    c.appendChild(benefitHost);
    host.appendChild(c);

    function refreshBenefits() {
      benefitHost.innerHTML = "";
      if (!pickedStudent) return;

      const scholarships = listStudentScholarships(pickedStudent.id);
      const discounts = listStudentDiscounts(pickedStudent.id);

      const schCard = card("Active Scholarships", [
        table([
          { label: "Scholarship", key: "scholarshipName" },
          { label: "Type", key: "scholarshipType" },
          { label: "Value", render: (a) => a.valueType === "percent" ? `${a.value}%` : naira(a.value) },
          { label: "Session", key: "effectiveSession" },
          { label: "Term", key: "effectiveTerm" },
          { label: "Approved By", key: "approvedBy" },
          { label: "Date", render: (a) => fmtDate(a.approvalDate) }
        ], scholarships, { empty: "No active scholarships." })
      ]);

      const discCard = card("Active Discounts", [
        table([
          { label: "Discount", key: "discountName" },
          { label: "Type", key: "discountType" },
          { label: "Value", render: (a) => a.valueType === "percent" ? `${a.value}%` : naira(a.value) },
          { label: "Session", key: "effectiveSession" },
          { label: "Term", key: "effectiveTerm" },
          { label: "Approved By", key: "approvedBy" }
        ], discounts, { empty: "No active discounts." })
      ]);

      benefitHost.appendChild(schCard);
      benefitHost.appendChild(discCard);

      // Bill preview
      const invoices = db.query("invoices", (i) => i.studentId === pickedStudent.id).sort((a, b) => b.createdAt - a.createdAt);
      if (invoices.length) {
        const latest = invoices[0];
        const gross = (latest.services || []).reduce((a, s) => a + num(s.amount), 0);
        const ded = computeAllDeductions(pickedStudent.id, latest.services || [], gross, latest.session, latest.term);
        const previewHtml = `
          <div style="padding:12px;background:var(--surface);border-radius:8px;font-size:13px">
            <div style="font-weight:700;margin-bottom:8px">Latest Invoice Preview (${latest.invoiceNo})</div>
            <table style="width:100%;border-collapse:collapse">
              <tr><td>Gross Charges</td><td style="text-align:right">${naira(gross)}</td></tr>
              ${ded.scholarshipBreakdown.map((s) => `<tr style="color:var(--success)"><td>− ${s.name}</td><td style="text-align:right">−${naira(s.amount)}</td></tr>`).join("")}
              ${ded.discountBreakdown.map((d) => `<tr style="color:var(--warning)"><td>− ${d.name}</td><td style="text-align:right">−${naira(d.amount)}</td></tr>`).join("")}
              <tr style="font-weight:800;border-top:2px solid var(--border)"><td>Net Payable</td><td style="text-align:right">${naira(ded.netAmount)}</td></tr>
            </table>
          </div>`;
        const previewEl = el("div", { html: previewHtml });
        benefitHost.appendChild(card("Bill Impact Preview", [previewEl]));
      }
    }
  }

  // ─── Reports ───────────────────────────────────────────────────────────────

  function renderReports() {
    host.innerHTML = "";

    const allSch = allStudentScholarships().filter((a) => a.status === "Active");
    const allDisc = allStudentDiscounts().filter((a) => a.status === "Active");
    const invoices = db.list("invoices");

    // Scholarship impact
    let totalSchVal = 0;
    invoices.forEach((inv) => { totalSchVal += num(inv.scholarship); });

    // Discount impact
    let totalDiscVal = 0;
    invoices.forEach((inv) => { totalDiscVal += num(inv.discount); });

    const totalRevenue = db.list("payments").reduce((a, p) => a + num(p.amount), 0);
    const totalBilled = invoices.reduce((a, i) => a + num(i.totalAmount), 0);
    const grossBilled = invoices.reduce((a, i) => a + (i.services || []).reduce((b, s) => b + num(s.amount), 0), 0);

    // Stat cards
    host.appendChild(el("div", { class: "grid grid-4" }, [
      statCard("🎓", String(allSch.length), "Active Scholarships"),
      statCard("🏷️", String(allDisc.length), "Active Discounts"),
      statCard("💸", naira(totalSchVal), "Scholarships Granted"),
      statCard("💰", naira(totalDiscVal), "Discounts Granted")
    ]));

    host.appendChild(el("div", { class: "grid grid-4" }, [
      statCard("📋", naira(grossBilled), "Gross Billed"),
      statCard("📉", naira(totalSchVal + totalDiscVal), "Total Reductions"),
      statCard("✅", naira(totalBilled), "Net Billed"),
      statCard("🏦", naira(totalRevenue), "Revenue Collected")
    ]));

    // Scholarship details table
    const schRows = allSch.map((a) => {
      const student = db.get("students", a.studentId);
      return {
        student: student?.fullName || a.studentId,
        admNo: student?.admissionNo || "—",
        scholarship: a.scholarshipName,
        type: a.scholarshipType,
        value: a.valueType === "percent" ? `${a.value}%` : naira(a.value),
        session: a.effectiveSession,
        term: a.effectiveTerm,
        approvedBy: a.approvedBy
      };
    });

    host.appendChild(card("Scholarship Report — Active Students", [
      table([
        { label: "Student", key: "student" },
        { label: "Adm No", key: "admNo" },
        { label: "Scholarship", key: "scholarship" },
        { label: "Type", key: "type" },
        { label: "Value", key: "value" },
        { label: "Session", key: "session" },
        { label: "Term", key: "term" },
        { label: "Approved By", key: "approvedBy" }
      ], schRows, { empty: "No active scholarship assignments." })
    ]));

    // Discount details table
    const discRows = allDisc.map((a) => {
      const student = db.get("students", a.studentId);
      return {
        student: student?.fullName || a.studentId,
        admNo: student?.admissionNo || "—",
        discount: a.discountName,
        type: a.discountType,
        value: a.valueType === "percent" ? `${a.value}%` : naira(a.value),
        session: a.effectiveSession,
        term: a.effectiveTerm
      };
    });

    host.appendChild(card("Discount Report — Active Students", [
      table([
        { label: "Student", key: "student" },
        { label: "Adm No", key: "admNo" },
        { label: "Discount", key: "discount" },
        { label: "Type", key: "type" },
        { label: "Value", key: "value" },
        { label: "Session", key: "session" },
        { label: "Term", key: "term" }
      ], discRows, { empty: "No active discount assignments." })
    ]));
  }

  // Default view
  showTab("plans-scholar");
}

function statCard(icon, value, label) {
  return el("div", { class: "card stat" }, [
    el("div", { class: "ic", text: icon }),
    el("div", {}, [el("div", { class: "v", text: value }), el("div", { class: "l", text: label })])
  ]);
}
