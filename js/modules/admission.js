import { db } from "../core/db.js";
import { el, toast, naira, num, todayISO, modal, confirmDialog } from "../core/utils.js";
import { card, pageHead, field, input, select, btn, table, textarea, readFileAsDataURL, resizeImageAsDataURL, studentPicker } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { getBranding } from "../core/branding.js";
import { nextAdmissionId, nextStudentId } from "../core/idgen.js";
import { buildServiceLines, createInvoice, invoiceForStudent } from "../core/billing.js";
import { ensureFamilyForStudent } from "../core/family.js";
import { logActivity, staffForUser } from "../core/activity.js";
import { showInvoice } from "./invoices.js";
import { bookSelector, deductBookStock } from "./bookshop.js";
import { uniformSelector, buildUniformLines } from "./uniforms.js";
import { sendSms } from "../core/sms.js";
import { calculateInvoiceTotal } from "../core/calculations.js";

export function render(root, ctx) {
  root.appendChild(pageHead("Admission", "Register new students or process returning students. Admission never collects money \u2014 it generates an invoice."));
  const tabs = el("div", { class: "row", style: "margin-bottom:16px" }, [
    btn("New Student", { variant: "primary", icon: "\uD83C\uDF93", onclick: () => newStudentFlow(host, ctx) }),
    btn("Returning Student", { variant: "ghost", icon: "\uD83D\uDD01", onclick: () => returningFlow(host, ctx) }),
    btn("Multiple Admission", { variant: "ghost", icon: "👨‍👩‍👧‍👦", onclick: () => multipleStudentFlow(host, ctx) }),
    btn("Full Program Student", { variant: "ghost", icon: "\uD83D\uDD4C", onclick: () => fullProgramFlow(host, ctx) }),
    btn("Migration Student", { variant: "ghost", icon: "\uD83D\uDCE5", onclick: () => migrationFlow(host, ctx) })
  ]);
  root.appendChild(tabs);
  const host = el("div");
  root.appendChild(host);
  newStudentFlow(host, ctx);
}

function stepBar(active) {
  const labels = ["Section & Class", "Student Details", "Health Info", "Services & Books", "Generate"];
  return el("div", { class: "steps" }, labels.map((l, i) =>
    el("div", { class: "step " + (i < active ? "done" : i === active ? "active" : ""), text: `${i + 1}. ${l}` })));
}

function enrollmentTermSelector() {
  const sessions = cfg.sessions().list || [cfg.currentSession()];
  const terms = cfg.sessions().terms || ["First Term", "Second Term", "Third Term"];

  let defaultSession = cfg.currentSession();
  let defaultTerm = cfg.currentTerm();
  if (defaultTerm === "Third Term") {
    defaultTerm = "First Term";
    const idx = sessions.indexOf(defaultSession);
    if (idx >= 0 && idx < sessions.length - 1) {
      defaultSession = sessions[idx + 1];
    }
  }

  const sessionSel = select(() => sessions.map(s => ({ value: s, label: s, selected: s === defaultSession })));
  const termSel = select(() => terms.map(t => ({ value: t, label: t, selected: t === defaultTerm })));

  const wrap = el("div", { class: "row", style: "gap:12px; margin-bottom: 16px; background: var(--surface); padding: 12px; border-radius: 8px; border: 1px solid var(--border);" }, [
    el("div", { style: "flex:1" }, [el("label", { text: "Enrollment Session", style: "display:block;font-size:12px;font-weight:bold" }), sessionSel]),
    el("div", { style: "flex:1" }, [el("label", { text: "Enrollment Term", style: "display:block;font-size:12px;font-weight:bold" }), termSel])
  ]);

  return { wrap, getSession: () => sessionSel.value, getTerm: () => termSel.value };
}

function newStudentFlow(host, ctx) {
  host.innerHTML = "";
  const state = { step: 0, sectionId: "", classId: "", programIds: [], form: {}, health: {}, serviceIds: [], uniformType: "", uniformSelection: {}, includeBooks: false, selectedBookLines: [], createStudentAccount: false, studentEmail: "", studentPassword: "" };

  const termUI = enrollmentTermSelector();

  const draw = () => {
    host.innerHTML = "";
    const c = card("New Student Admission");
    c.classList.add("student-registration-card");
    c.appendChild(termUI.wrap);
    c.appendChild(stepBar(state.step));
    if (state.step === 0) c.appendChild(stepSection());
    else if (state.step === 1) c.appendChild(stepDetails());
    else if (state.step === 2) c.appendChild(stepHealth());
    else if (state.step === 3) c.appendChild(stepServices());
    host.appendChild(c);
  };

  function stepSection() {
    const wrap = el("div", { class: "student-registration-step" });
    wrap.appendChild(el("p", { class: "muted", text: "Step 1: Select the section and class to admit the student into." }));

    // Section chips
    wrap.appendChild(el("div", { style: "font-weight:600;margin-bottom:6px", text: "Section" }));
    const chips = el("div", { class: "chip-select" }, cfg.sections().map((s) =>
      el("div", {
        class: "chip" + (state.sectionId === s.id ? " sel" : ""), text: s.name, onclick: () => {
          state.sectionId = s.id;
          const primary = cfg.programForSection(s.id);
          state.programIds = primary ? [primary.id] : [s.id];
          // Reset classId if not valid for new section
          const validClasses = cfg.classes(s.id);
          if (!validClasses.find(c => c.id === state.classId)) state.classId = "";
          draw();
        }
      })));
    wrap.appendChild(chips);

    // Class selector (shown when section selected)
    if (state.sectionId) {
      const classes = cfg.classes(state.sectionId);
      if (classes.length > 0) {
        wrap.appendChild(el("div", { style: "font-weight:600;margin:14px 0 6px", text: "Class" }));
        const classChips = el("div", { class: "chip-select" }, classes.map((c) =>
          el("div", { class: "chip" + (state.classId === c.id ? " sel" : ""), text: c.name, onclick: () => { state.classId = c.id; state.uniformSelection = {}; state.includeBooks = false; state.selectedBookLines = []; draw(); } })));
        wrap.appendChild(classChips);
      }
      wrap.appendChild(programChecklist(state, true));
    }

    const next = btn("Continue \u2192", {
      variant: "primary", onclick: () => {
        if (!state.sectionId) return toast("Select a section", "error");
        if (!state.classId) return toast("Select a class", "error");
        state.step = 1; draw();
      }
    });
    wrap.appendChild(el("div", { class: "row", style: "margin-top:16px" }, [next]));
    return wrap;
  }

  function stepDetails() {
    const wrap = el("div", { class: "student-registration-step" });
    const f = state.form;
    const passport = el("div", { class: "passport-drop", text: "Upload Passport" });
    if (f.passport) passport.innerHTML = `<img src="${f.passport}">`;
    const fileInp = input({ type: "file", accept: "image/*", style: "display:none" });
    passport.onclick = () => fileInp.click();
    fileInp.onchange = async () => { if (fileInp.files[0]) { f.passport = await resizeImageAsDataURL(fileInp.files[0]); passport.innerHTML = `<img src="${f.passport}">`; } };

    const grid = el("div", { class: "form-grid" });
    const fullName = input({ value: f.fullName || "", placeholder: "Full Name" });
    const gender = select(() => ["", "Male", "Female"].map((g) => ({ value: g, label: g || "Select Gender", selected: f.gender === g })));
    const dob = input({ type: "date", value: f.dob || "" });
    const parentName = input({ value: f.parentName || "", placeholder: "Parent / Guardian Name" });
    const parentPhone = input({ value: f.parentPhone || "", placeholder: "Parent Phone" });
    const address = input({ value: f.address || "", placeholder: "Home Address" });
    const prevSchool = input({ value: f.previousSchool || "", placeholder: "Previous School (optional)" });
    const admDate = input({ type: "date", value: f.admissionDate || todayISO() });

    grid.appendChild(field("Full Name", fullName));
    grid.appendChild(field("Gender", gender));
    grid.appendChild(field("Date of Birth", dob));
    grid.appendChild(field("Admission Date", admDate));
    grid.appendChild(field("Parent / Guardian Name", parentName));
    grid.appendChild(field("Parent Phone", parentPhone));
    grid.appendChild(field("Address", address, { full: true }));
    grid.appendChild(field("Previous School", prevSchool, { full: true }));

    const left = el("div", { style: "flex:1" }, [grid]);
    const right = el("div", {}, [field("Passport", passport), fileInp]);
    wrap.appendChild(el("div", { class: "row", style: "align-items:flex-start;gap:20px" }, [right, left]));

    const sectionLabel = cfg.sectionName(state.sectionId);
    const className = cfg.className(state.classId);
    const programNames = cfg.studentProgramIds(state).map((id) => cfg.programName(id)).join(", ");
    wrap.appendChild(el("div", { style: "margin-top:8px;padding:8px 12px;background:var(--bg-alt,#f4f6fb);border-radius:8px;font-size:13px;color:var(--muted,#666)" },
      [el("span", { html: `\uD83C\uDFEB <b>Section:</b> ${sectionLabel} &nbsp;&nbsp; <b>Class:</b> ${className} &nbsp;&nbsp; <b>Programs:</b> ${programNames || sectionLabel}` })]));

    // Student Account Creation Section
    const accountSection = el("div", { style: "margin-top:16px;padding:16px;background:var(--surface);border-radius:8px;border:1px solid var(--border)" });
    accountSection.appendChild(el("h4", { text: "Student Login Account (Optional)", style: "margin:0 0 12px 0" }));

    const createAccountCb = input({ type: "checkbox" });
    createAccountCb.checked = state.createStudentAccount;
    const accountFields = el("div", { style: "display:none;margin-top:12px" });

    const studentEmail = input({ value: state.studentEmail || "", placeholder: "student@example.com" });
    const studentPassword = input({ value: state.studentPassword || "", placeholder: "Password (leave blank to auto-generate)" });
    const generatePassBtn = btn("Generate Password", {
      variant: "ghost", style: "font-size:12px;padding:4px 8px", onclick: () => {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
        let pass = "";
        for (let i = 0; i < 12; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
        studentPassword.value = pass;
        state.studentPassword = pass;
      }
    });

    const emailGrid = el("div", { class: "form-grid" });
    emailGrid.appendChild(field("Student Email", studentEmail));
    emailGrid.appendChild(field("Password", el("div", { class: "row", style: "gap:8px" }, [studentPassword, generatePassBtn])));
    accountFields.appendChild(emailGrid);

    createAccountCb.onchange = () => {
      state.createStudentAccount = createAccountCb.checked;
      accountFields.style.display = createAccountCb.checked ? "block" : "none";
    };

    accountSection.appendChild(el("label", { class: "row", style: "gap:8px;align-items:center" }, [createAccountCb, el("span", { text: "Create student login account" })]));
    accountSection.appendChild(accountFields);
    if (state.createStudentAccount) accountFields.style.display = "block";
    wrap.appendChild(accountSection);

    const back = btn("\u2190 Back", { onclick: () => { state.step = 0; draw(); } });
    const next = btn("Continue \u2192", {
      variant: "primary", onclick: () => {
        if (!fullName.value.trim()) return toast("Enter full name", "error");
        if (state.createStudentAccount && !studentEmail.value.trim()) return toast("Enter student email for account creation", "error");
        Object.assign(f, {
          fullName: fullName.value.trim(), gender: gender.value, dob: dob.value, admissionDate: admDate.value,
          parentName: parentName.value, parentPhone: parentPhone.value, address: address.value, previousSchool: prevSchool.value
        });
        state.studentEmail = studentEmail.value.trim();
        state.studentPassword = studentPassword.value;
        state.step = 2; draw();
      }
    });
    wrap.appendChild(el("div", { class: "row", style: "margin-top:16px" }, [back, next]));
    return wrap;
  }

  function stepHealth() {
    const wrap = el("div", { class: "student-registration-step" });
    wrap.appendChild(el("p", { class: "muted", text: "Step 3: Record any health conditions or medical history for this student (optional but recommended)." }));
    const h = state.health;

    const grid = el("div", { class: "form-grid" });
    const bloodGroup = select(() => ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(v => ({ value: v, label: v || "Select Blood Group", selected: h.bloodGroup === v })));
    const genotype = select(() => ["", "AA", "AS", "SS", "AC", "SC"].map(v => ({ value: v, label: v || "Select Genotype", selected: h.genotype === v })));
    const allergies = input({ value: h.allergies || "", placeholder: "e.g. Penicillin, Peanuts (comma-separated)" });
    const disabilities = input({ value: h.disabilities || "", placeholder: "e.g. Visual impairment, Hearing loss" });
    const chronicConditions = textarea({ rows: 2, placeholder: "e.g. Asthma, Diabetes, Epilepsy\u2026", style: "width:100%;resize:vertical" });
    if (h.chronicConditions) chronicConditions.value = h.chronicConditions;
    const medications = textarea({ rows: 2, placeholder: "Current medications if any\u2026", style: "width:100%;resize:vertical" });
    if (h.medications) medications.value = h.medications;
    const emergencyContact = input({ value: h.emergencyContact || "", placeholder: "Emergency contact name & phone" });
    const additionalNotes = textarea({ rows: 2, placeholder: "Any other relevant health information\u2026", style: "width:100%;resize:vertical" });
    if (h.additionalNotes) additionalNotes.value = h.additionalNotes;

    grid.appendChild(field("Blood Group", bloodGroup));
    grid.appendChild(field("Genotype", genotype));
    grid.appendChild(field("Known Allergies", allergies));
    grid.appendChild(field("Disabilities / Special Needs", disabilities));
    grid.appendChild(field("Chronic Conditions", chronicConditions, { full: true }));
    grid.appendChild(field("Current Medications", medications, { full: true }));
    grid.appendChild(field("Emergency Contact", emergencyContact, { full: true }));
    grid.appendChild(field("Additional Health Notes", additionalNotes, { full: true }));

    wrap.appendChild(grid);

    const back = btn("\u2190 Back", { onclick: () => { state.step = 1; draw(); } });
    const skip = btn("Skip", { variant: "ghost", onclick: () => { state.step = 3; draw(); } });
    const next = btn("Continue \u2192", {
      variant: "primary", onclick: () => {
        Object.assign(h, {
          bloodGroup: bloodGroup.value, genotype: genotype.value,
          allergies: allergies.value.trim(), disabilities: disabilities.value.trim(),
          chronicConditions: chronicConditions.value.trim(), medications: medications.value.trim(),
          emergencyContact: emergencyContact.value.trim(), additionalNotes: additionalNotes.value.trim(),
          recordedAt: Date.now()
        });
        state.step = 3; draw();
      }
    });
    wrap.appendChild(el("div", { class: "row", style: "margin-top:16px" }, [back, skip, next]));
    return wrap;
  }

  function stepServices() {
    const wrap = el("div", { class: "student-registration-step" });

    wrap.appendChild(el("p", { class: "muted", text: `Step 4: Select services for ${cfg.sectionName(state.sectionId)}. Section-specific prices apply.` }));
    const list = el("div");
    // A program charge replaces its matching tuition service. If the school
    // has no priced program configured, keep Tuition Fee in the selectable
    // charges so it cannot be omitted from the student's invoice.
    const hasProgramCharge = state.programIds.some((id) => num(cfg.program(id)?.fee) > 0);
    const feeServices = cfg.servicesForSection(state.sectionId).filter((s) =>
      s.type === "fee" && (!isTuitionService(s) || !hasProgramCharge)
    );

    // Display enrolled program fees as read-only items
    state.programIds.forEach((pid) => {
      const p = cfg.program(pid);
      if (p && num(p.fee) > 0) {
        const cb = input({ type: "checkbox" });
        cb.checked = true;
        cb.disabled = true;
        list.appendChild(el("div", { class: "svc-row" }, [cb, el("span", { class: "nm", text: `${p.name} Program Fee` }), el("span", { class: "amt", text: naira(p.fee) })]));
      }
    });

    feeServices.forEach((s) => {
      const checked = state.serviceIds.includes(s.id) || !s.optional;
      if (!s.optional && !state.serviceIds.includes(s.id)) state.serviceIds.push(s.id);
      const cb = input({ type: "checkbox" });
      cb.checked = checked;
      cb.onchange = () => { if (cb.checked) state.serviceIds.push(s.id); else state.serviceIds = state.serviceIds.filter((x) => x !== s.id); recalc(); };
      list.appendChild(el("div", { class: "svc-row" }, [cb, el("span", { class: "nm", text: s.name + (s.optional ? " (optional)" : "") }), el("span", { class: "amt", text: naira(cfg.servicePrice(s.id, state.sectionId)) })]));
    });
    const uniformBox = uniformSelector(state.sectionId, state.classId, { selection: state.uniformSelection, onSelectionChange: (sel) => { state.uniformSelection = sel; try { recalc(); } catch (_) { console.warn("[AUDIT]", _); } } });
    list.appendChild(uniformBox.wrap);

    const bookWrap = el("div", { style: "margin-top:16px; padding:16px; background:var(--surface); border-radius:8px; border:1px solid var(--border);" });
    const bookSel = bookSelector(state.sectionId, state.classId, {
      onSelectionChange: (lines) => { state.selectedBookLines = lines; recalc(); }
    });
    if (bookSel) {
      bookWrap.appendChild(el("div", { class: "section-title", style: "margin-bottom:8px" }, [el("h4", { text: "\uD83D\uDCDA Books Catalogue", style: "margin:0" })]));
      bookWrap.appendChild(bookSel.wrap);
    }

    const bcb = input({ type: "checkbox" });
    bcb.checked = state.includeBooks;
    bookWrap.style.display = bookSel ? "block" : "none";
    bcb.onchange = () => {
      state.includeBooks = bcb.checked;
      if (bookSel) {
        bookWrap.style.display = bcb.checked ? "block" : "none";
        bookSel.selectAll(bcb.checked);
      }
      recalc();
    };
    const booksPrice = cfg.booksPrice(state.sectionId);
    list.appendChild(el("div", { class: "svc-row" }, [bcb, el("span", { class: "nm", text: "Include Books (Add to Invoice)" }), el("span", { class: "amt", text: bookSel ? "Select items below" : (booksPrice > 0 ? naira(booksPrice) : "") })]));

    wrap.appendChild(list);
    if (bookSel) wrap.appendChild(bookWrap);

    const totalEl = el("div", { style: "text-align:right;font-size:18px;font-weight:800;margin-top:12px" });
    wrap.appendChild(totalEl);

    function recalc() {
      const lines = buildServiceLines(state.sectionId, { serviceIds: state.serviceIds, uniformSelection: state.uniformSelection, classId: state.classId, includeBooks: state.includeBooks });
      totalEl.textContent = "Total: " + naira(calculateInvoiceTotal([...lines, ...(state.selectedBookLines || [])]) + programFeeTotal(state));
    }
    recalc();

    const back = btn("\u2190 Back", { onclick: () => { state.step = 2; draw(); } });
    const gen = btn("Admit & Generate Invoice", { variant: "success", icon: "\u2713", onclick: () => finish(state, ctx, termUI.getSession(), termUI.getTerm()) });
    const addSibling = btn("Admit & Add Sibling", {
      variant: "primary", icon: "\u2795", onclick: () => finish(state, ctx, termUI.getSession(), termUI.getTerm(), () => {
        state.form.fullName = "";
        state.form.dob = "";
        state.form.gender = "";
        state.form.passport = "";
        state.health = {};
        state.serviceIds = [];
        state.uniformSelection = {};
        state.includeBooks = false;
        state.selectedBookLines = [];
        state.createStudentAccount = false;
        state.studentEmail = "";
        state.studentPassword = "";
        state.step = 0;
        state.classId = "";
        state.sectionId = "";
        draw();
      })
    });
    wrap.appendChild(el("div", { class: "row", style: "margin-top:16px" }, [back, gen, addSibling]));
    return wrap;
  }

  draw();
}

function multipleStudentFlow(host, ctx) {
  host.innerHTML = "";
  const state = { parent: {}, students: [] };

  // Initialize with one empty student
  addEmptyStudent();

  function addEmptyStudent() {
    state.students.push({
      id: "temp-" + Date.now() + Math.random(),
      fullName: "", gender: "", dob: "",
      sectionId: "", classId: "", programIds: [],
      serviceIds: [], includeBooks: false
    });
  }

  const draw = () => {
    host.innerHTML = "";
    const c = card("Multiple Student Admission");
    c.appendChild(el("p", { class: "muted", text: "Register a parent once and admit multiple children simultaneously. Invoices and Family Ledgers will be automatically generated." }));

    // Parent Section
    c.appendChild(el("h3", { text: "Step 1: Parent Information" }));
    const pGrid = el("div", { class: "form-grid" });
    const pName = input({ value: state.parent.name || "", placeholder: "Parent Full Name" });
    const pPhone = input({ value: state.parent.phone || "", placeholder: "Parent Phone Number" });
    const pEmail = input({ value: state.parent.email || "", placeholder: "Parent Email (Optional)" });
    const pAddress = textarea({ rows: 2, placeholder: "Home Address" });
    if (state.parent.address) pAddress.value = state.parent.address;

    pName.onchange = () => state.parent.name = pName.value;
    pPhone.onchange = () => state.parent.phone = pPhone.value;
    pEmail.onchange = () => state.parent.email = pEmail.value;
    pAddress.onchange = () => state.parent.address = pAddress.value;

    pGrid.appendChild(field("Parent Name", pName));
    pGrid.appendChild(field("Phone Number", pPhone));
    pGrid.appendChild(field("Email", pEmail));
    pGrid.appendChild(field("Address", pAddress, { full: true }));
    c.appendChild(pGrid);

    // Students Section
    c.appendChild(el("h3", { text: "Step 2: Student Details", style: "margin-top:24px" }));

    state.students.forEach((s, idx) => {
      const sCard = el("div", { style: "border:1px solid var(--border); border-radius:8px; padding:16px; margin-bottom:16px; position:relative;" });
      sCard.appendChild(el("div", { style: "font-weight:bold; margin-bottom:12px", text: `Student ${idx + 1}` }));

      if (state.students.length > 1) {
        const removeBtn = btn("Remove", {
          variant: "ghost", style: "position:absolute; top:12px; right:12px; color:var(--danger)", onclick: () => {
            state.students.splice(idx, 1);
            draw();
          }
        });
        sCard.appendChild(removeBtn);
      }

      const sGrid = el("div", { class: "form-grid" });
      const sName = input({ value: s.fullName, placeholder: "Student Full Name" });
      sName.onchange = () => s.fullName = sName.value;
      const sGender = select(() => ["", "Male", "Female"].map(g => ({ value: g, label: g || "Select Gender", selected: s.gender === g })));
      sGender.onchange = () => s.gender = sGender.value;
      const sDob = input({ type: "date", value: s.dob });
      sDob.onchange = () => s.dob = sDob.value;

      const sSec = select(() => [{ value: "", label: "Select Section" }, ...cfg.sections().map(x => ({ value: x.id, label: x.name, selected: s.sectionId === x.id }))]);
      const sCls = select(() => [{ value: "", label: "Select Class" }]);

      sSec.onchange = () => {
        s.sectionId = sSec.value;
        s.classId = "";
        const primary = cfg.programForSection(s.sectionId);
        s.programIds = primary ? [primary.id] : [s.sectionId];
        draw();
      };

      if (s.sectionId) {
        cfg.classes(s.sectionId).forEach(c => sCls.appendChild(el("option", { value: c.id, text: c.name, selected: s.classId === c.id })));
      }
      sCls.onchange = () => s.classId = sCls.value;

      sGrid.appendChild(field("Student Name", sName));
      sGrid.appendChild(field("Gender", sGender));
      sGrid.appendChild(field("Date of Birth", sDob));
      sGrid.appendChild(field("Section", sSec));
      sGrid.appendChild(field("Class", sCls));

      sCard.appendChild(sGrid);
      c.appendChild(sCard);
    });

    const addBtn = btn("+ Add Another Student", { variant: "ghost", style: "margin-bottom:24px", onclick: () => { addEmptyStudent(); draw(); } });
    c.appendChild(addBtn);

    const termUI = enrollmentTermSelector();
    c.appendChild(termUI.wrap);

    const submitBtn = btn("Admit All & Generate Family Ledger", { variant: "success", style: "width:100%; font-size:16px; padding:12px", onclick: () => submitAll(termUI.getSession(), termUI.getTerm()) });
    c.appendChild(submitBtn);

    host.appendChild(c);
  };

  async function submitAll(session, term) {
    if (!state.parent.name || !state.parent.phone) return toast("Parent Name and Phone are required.", "error");
    for (let i = 0; i < state.students.length; i++) {
      const s = state.students[i];
      if (!s.fullName) return toast(`Student ${i + 1} needs a name.`, "error");
      if (!s.sectionId || !s.classId) return toast(`Student ${i + 1} needs a Section and Class.`, "error");
    }

    const ok = await confirmDialog(`Admit ${state.students.length} students under parent ${state.parent.name}?`);
    if (!ok) return;

    try {
      const family = ensureFamilyForStudent(state.parent.phone, state.parent.name);
      if (state.parent.email) family.email = state.parent.email;
      if (state.parent.address) family.address = state.parent.address;
      db.save("families", family);

      let admittedCount = 0;
      for (const s of state.students) {
        const admissionNo = nextAdmissionId();
        const studentId = nextStudentId();

        const student = db.save("students", {
          id: studentId, admissionNo,
          fullName: s.fullName, gender: s.gender, dob: s.dob,
          sectionId: s.sectionId, classId: s.classId,
          programIds: s.programIds || [],
          status: "active",
          parentName: state.parent.name,
          parentPhone: state.parent.phone,
          parentEmail: state.parent.email,
          parentAddress: state.parent.address,
          familyId: family.id,
          recordedAt: Date.now()
        });

        const lines = buildServiceLines(s.sectionId, { serviceIds: s.serviceIds || [], classId: s.classId, includeBooks: false });
        const primaryProg = cfg.programForSection(s.sectionId);
        if (primaryProg) lines.unshift({ id: primaryProg.id, name: primaryProg.name, type: "fee", amount: num(primaryProg.fee), quantity: 1, required: true });

        const inv = await createInvoice({ student, services: lines, type: "New Student", session, term });

        db.save("auditLogs", { id: "adm-" + student.id, type: "admission", uid: ctx.user.uid, at: Date.now(), message: `Admitted ${student.fullName} (${admissionNo}) via Multiple Admission` });
        logActivity({ module: "Admission", action: "Multiple Admission", description: `Admitted ${student.fullName} (${admissionNo}) \u2014 invoice ${inv.invoiceNo}`, studentId: student.id, staffId: staffForUser(ctx.user)?.id || "", user: ctx.user.email });

        admittedCount++;
      }

      toast(`Successfully admitted ${admittedCount} students and created Family Ledger!`, "success", 6000);
      ctx.go("family");
    } catch (err) {
      toast("Error during multiple admission: " + err.message, "error");
    }
  }

  draw();
}

function programChecklist(state, includePrimary = false) {
  const wrap = el("div", { style: "margin-top:14px" });
  const primary = cfg.programForSection(state.sectionId);
  if (primary && !state.programIds.includes(primary.id)) state.programIds.unshift(primary.id);
  wrap.appendChild(el("div", { style: "font-weight:600;margin-bottom:6px", text: "Programs Enrolled" }));
  wrap.appendChild(el("p", { class: "muted", style: "font-size:12px;margin:0 0 8px", text: "Primary program is selected automatically. Tick any additional programs for this student." }));
  const list = el("div", { class: "chip-select" });
  cfg.programs({ activeOnly: true, session: "", term: "" }).forEach((p) => {
    const isPrimary = primary && p.id === primary.id;
    if (isPrimary && !includePrimary) return;
    const cb = input({ type: "checkbox" });
    cb.checked = state.programIds.includes(p.id);
    cb.disabled = isPrimary;
    cb.onchange = () => {
      if (cb.checked) state.programIds = [...new Set([...state.programIds, p.id])];
      else state.programIds = state.programIds.filter((id) => id !== p.id);
    };
    list.appendChild(el("label", { class: "chip" + (cb.checked ? " sel" : ""), style: "display:flex;align-items:center;gap:6px" }, [
      cb,
      el("span", { text: `${p.name} (${naira(p.fee)})${isPrimary ? " Primary" : ""}` })
    ]));
  });
  wrap.appendChild(list);
  return wrap;
}

function isTuitionService(s) {
  return (s.name || "").toLowerCase().includes("tuition fee");
}

function programFeeTotal(studentLike) {
  return cfg.studentProgramIds(studentLike).reduce((total, id) => total + num(cfg.program(id)?.fee), 0);
}

async function finish(state, ctx, session, term, onAddSibling = null) {
  // Duplicate name check
  const existing = db.list("students").filter(s => s.status !== "graduated" &&
    (s.fullName || "").toLowerCase().trim() === (state.form.fullName || "").toLowerCase().trim());
  if (existing.length > 0) {
    const names = existing.map(s => `${s.fullName} (${s.admissionNo}, ${cfg.sectionName(s.sectionId)})`).join("; ");
    const proceed = await confirmDialog(`A student with the same name already exists: ${names}. Proceed anyway?`, { title: "Duplicate Name Detected", okText: "Admit Anyway" });
    if (!proceed) return;
  }

  const admissionNo = await nextAdmissionId(new Date(state.form.admissionDate || Date.now()).getFullYear());
  const studentId = await nextStudentId();

  // Build health record (only if any field filled)
  const hasHealth = Object.values(state.health).some(v => v && String(v).trim());
  const healthRecord = hasHealth ? { ...state.health, recordedAt: Date.now(), recordedBy: ctx.user.email } : null;

  const student = db.save("students", {
    ...state.form, admissionNo, studentId, sectionId: state.sectionId,
    classId: state.classId, programIds: state.programIds, programs: state.programIds, programNames: state.programIds.map((id) => cfg.programName(id)), admissionType: "New Student",
    status: "active", session: cfg.currentSession(), createdBy: ctx.user.uid,
    healthConditions: healthRecord,
    history: [{ type: "admission", at: Date.now(), by: ctx.user.email, note: "New admission" }]
  });
  await ensureFamilyForStudent(student);

  // Create student login account if requested
  if (state.createStudentAccount && state.studentEmail) {
    try {
      const { supabase } = await import("../core/supabase.js");
      if (supabase) {
        // Generate password if not provided
        const password = state.studentPassword || Math.random().toString(36).slice(-8) + "A1!";

        // Create Supabase Auth user
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: state.studentEmail,
          password: password,
          options: {
            data: {
              full_name: student.fullName,
              student_id: student.studentId,
              admission_no: student.admissionNo
            }
          }
        });

        if (authError) {
          console.error("Error creating student auth account:", authError);
          toast("Warning: Could not create student login account: " + authError.message, "error");
        } else if (authData.user) {
          // Create user profile with Student role
          const { error: profileError } = await supabase
            .from('users')
            .insert({
              auth_id: authData.user.id,
              email: state.studentEmail,
              full_name: student.fullName,
              is_active: true,
              role: 'Student',
              status: 'Active'
            });

          if (profileError) {
            console.error("Error creating student profile:", profileError);
          } else {
            // Assign Student role
            const { data: roleData } = await supabase
              .from('roles')
              .select('id')
              .eq('name', 'Student')
              .single();

            if (roleData) {
              await supabase
                .from('user_roles')
                .insert({
                  user_id: authData.user.id,
                  role_id: roleData.id,
                  role: 'Student'
                });
            }

            toast(`Student account created! Email: ${state.studentEmail}, Password: ${password}`, "success", 8000);
          }
        }
      }
    } catch (e) {
      console.error("Error creating student account:", e);
      toast("Warning: Could not create student login account", "error");
    }
  }
  const programLines = state.programIds.map(id => {
    const p = cfg.program(id);
    if (!p || num(p.fee) <= 0) return null;
    return { id: "program:" + p.id, name: `${p.name} Program Fee`, amount: num(p.fee), quantity: 1, type: "program", programId: p.id, sectionId: p.sectionId || "" };
  }).filter(Boolean);

  const services = [
    ...programLines,
    ...buildServiceLines(state.sectionId, { serviceIds: state.serviceIds, uniformSelection: state.uniformSelection, classId: state.classId, includeBooks: state.includeBooks }),
    ...(state.selectedBookLines || [])
  ];
  const inv = await createInvoice({ student, services, type: "New Student", session, term });
  deductBookStock(state.selectedBookLines || []);
  db.save("auditLogs", { id: "adm-" + student.id, type: "admission", uid: ctx.user.uid, at: Date.now(), message: `Admitted ${student.fullName} (${admissionNo})` });
  logActivity({ module: "Admission", action: "New Admission", description: `Admitted ${student.fullName} (${admissionNo}) \u2014 invoice ${inv.invoiceNo}`, studentId: student.id, staffId: staffForUser(ctx.user)?.id || "", user: ctx.user.email });
  toast(`Admitted ${student.fullName} \u2014 ${admissionNo}`, "success", 4000);

  const smsCfg = db.setting("smsGateway") || {};
  if (smsCfg.autoAdmission && student.parentPhone) {
    const brand = getBranding();
    const sig = cfg.schoolSignatures();
    const contactPhone = sig.contactPhone || brand.phone || "";
    sendSms(student.parentPhone, `Dear Parent,\n\nAdmission has been successfully completed for ${student.fullName}.\n\n${brand.shortName}\n${contactPhone}`);
  }

  if (onAddSibling) {
    onAddSibling();
  } else {
    showInvoice(inv.id, { afterClose: () => ctx.go("students") });
  }
}

// ---- Returning student ----
function returningFlow(host, ctx) {
  host.innerHTML = "";
  const c = card("Returning Student Registration");
  const termUI = enrollmentTermSelector();
  c.appendChild(termUI.wrap);

  c.appendChild(el("p", { class: "muted", text: "Select the student, then choose services for the new session. An invoice is generated automatically." }));
  let picked = null;
  const picker = studentPicker((sel) => { picked = sel; if (sel.studentId) renderServices(sel.studentId); });
  c.appendChild(picker.wrap);
  const svcHost = el("div", { style: "margin-top:14px" });
  c.appendChild(svcHost);
  host.appendChild(c);

  function renderServices(studentId) {
    const student = db.get("students", studentId);
    svcHost.innerHTML = "";
    const serviceIds = [];
    let includeBooks = false;
    const list = el("div");

    // Display enrolled program fees as read-only items
    import("../core/billing.js").then(({ buildProgramFeeLines }) => {
      const pLines = buildProgramFeeLines(student);
      pLines.forEach((p) => {
        const cb = input({ type: "checkbox" });
        cb.checked = true;
        cb.disabled = true;
        list.appendChild(el("div", { class: "svc-row" }, [cb, el("span", { class: "nm", text: p.name }), el("span", { class: "amt", text: naira(p.amount) })]));
      });
    });

    const hasProgramCharge = programFeeTotal(student) > 0;
    cfg.servicesForSection(student.sectionId).filter((s) =>
      s.type === "fee" && (!isTuitionService(s) || !hasProgramCharge)
    ).forEach((s) => {
      const cb = input({ type: "checkbox" });
      cb.onchange = () => { if (cb.checked) serviceIds.push(s.id); else { const i = serviceIds.indexOf(s.id); if (i >= 0) serviceIds.splice(i, 1); } recalc(); };
      list.appendChild(el("div", { class: "svc-row" }, [cb, el("span", { class: "nm", text: s.name }), el("span", { class: "amt", text: naira(cfg.servicePrice(s.id, student.sectionId)) })]));
    });
    let uniformSelection = {};
    const uniformBox = uniformSelector(student.sectionId, student.classId, { onSelectionChange: (sel) => { uniformSelection = sel; try { recalc(); } catch (_) { console.warn("[AUDIT]", _); } } });
    list.appendChild(uniformBox.wrap);

    let selectedBookLines = [];
    const bookWrap = el("div", { style: "margin-top:16px; padding:16px; background:var(--surface); border-radius:8px; border:1px solid var(--border);" });
    const bookSel = bookSelector(student.sectionId, student.classId, {
      onSelectionChange: (lines) => { selectedBookLines = lines; recalc(); }
    });
    if (bookSel) {
      bookWrap.appendChild(el("div", { class: "section-title", style: "margin-bottom:8px" }, [el("h4", { text: "\uD83D\uDCDA Books Catalogue", style: "margin:0" })]));
      bookWrap.appendChild(bookSel.wrap);
    }

    const bcb = input({ type: "checkbox" });
    bcb.onchange = () => {
      includeBooks = bcb.checked;
      if (bookSel) {
        bookWrap.style.display = bcb.checked ? "block" : "none";
        bookSel.selectAll(bcb.checked);
      }
      recalc();
    };
    const booksPrice = cfg.booksPrice(student.sectionId);
    bookWrap.style.display = bookSel ? "block" : "none";
    list.appendChild(el("div", { class: "svc-row" }, [bcb, el("span", { class: "nm", text: "Include Books (Add to Invoice)" }), el("span", { class: "amt", text: bookSel ? "Select items below" : (booksPrice > 0 ? naira(booksPrice) : "") })]));

    svcHost.appendChild(list);
    if (bookSel) svcHost.appendChild(bookWrap);

    const totalEl = el("div", { style: "text-align:right;font-weight:800;font-size:16px;margin-top:8px" });
    svcHost.appendChild(totalEl);
    function recalc() {
      const lines = buildServiceLines(student.sectionId, { serviceIds, uniformSelection, classId: student.classId, includeBooks });
      totalEl.textContent = "Total: " + naira(calculateInvoiceTotal([...lines, ...selectedBookLines]) + programFeeTotal(student));
    }
    recalc();
    const gen = btn("Generate Invoice", {
      variant: "success", onclick: async () => {
        import("../core/billing.js").then(async ({ buildProgramFeeLines }) => {
          const lines = buildServiceLines(student.sectionId, { serviceIds, uniformSelection, classId: student.classId, includeBooks });
          const programLines = buildProgramFeeLines(student);
          const allLines = [...programLines, ...lines, ...selectedBookLines];
          const inv = await createInvoice({ student, services: allLines, type: "Returning Student", session: termUI.getSession(), term: termUI.getTerm() });
          deductBookStock(selectedBookLines);
          toast("Invoice generated for " + student.fullName, "success");
          showInvoice(inv.id);
        });
      }
    });
    svcHost.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [gen]));
  }
}

// ---- Full Program Student (Western + Islamiyya + Tahfiz) ----
function programSections(westernSectionId) {
  const out = [];
  const w = cfg.section(westernSectionId);
  if (w) out.push({ id: w.id, label: w.name });
  const isl = cfg.sections().find((s) => s.type === "islamiyya");
  if (isl) out.push({ id: isl.id, label: isl.name });
  const tah = cfg.sections().find((s) => s.type === "tahfiz");
  if (tah) out.push({ id: tah.id, label: tah.name });
  return out;
}

function fullProgramLines(westernSectionId, { uniformType = "", uniformSelection = null, classId = "", includeBooks = false } = {}) {
  const lines = [];
  programSections(westernSectionId).forEach(({ id, label }) => {
    cfg.servicesForSection(id).filter((s) => s.type === "fee" && !s.optional).forEach((s) => {
      const amt = cfg.servicePrice(s.id, id);
      if (amt > 0) lines.push({ id: s.id + ":" + id, name: `${s.name} (${label})`, amount: amt, type: "fee", optional: false });
    });
  });
  if (uniformSelection) lines.push(...buildUniformLines(westernSectionId, classId, uniformSelection));
  else if (uniformType && cfg.uniformPrice(westernSectionId, uniformType) > 0)
    lines.push({ id: "svc-uniform:" + westernSectionId, name: `Uniform (${uniformType})`, amount: cfg.uniformPrice(westernSectionId, uniformType), type: "uniform" });
  if (includeBooks && cfg.booksPrice(westernSectionId) > 0)
    lines.push({ id: "svc-books:" + westernSectionId, name: "Books", amount: cfg.booksPrice(westernSectionId), type: "book", optional: true, legacyBookCharge: true });
  return lines;
}

function fullProgramFlow(host, ctx) {
  host.innerHTML = "";
  const f = { uniformType: "", uniformSelection: {}, includeBooks: false };
  const termUI = enrollmentTermSelector();
  host.appendChild(termUI.wrap);

  const c = card("Full Program Student Admission");
  c.appendChild(el("p", { class: "muted", text: "A Full Program Student is enrolled in Western Education, Islamiyya and Tahfiz simultaneously. Fees for all three programs are combined into one consolidated invoice." }));

  const westernSections = cfg.sections().filter((s) => (s.type || "western") === "western");
  const secSel = select(() => [{ value: "", label: "Select Western Section" }, ...westernSections.map((s) => ({ value: s.id, label: s.name }))], { style: "min-width:200px" });
  const clsSel = select(() => [{ value: "", label: "Select Class" }], { style: "min-width:180px", disabled: "disabled" });
  secSel.onchange = () => {
    clsSel.innerHTML = ""; clsSel.appendChild(el("option", { value: "", text: "Select Class" }));
    cfg.classes(secSel.value).forEach((cl) => clsSel.appendChild(el("option", { value: cl.id, text: cl.name })));
    clsSel.disabled = !secSel.value; recalc();
  };
  clsSel.onchange = recalc;
  c.appendChild(el("div", { class: "row", style: "margin-bottom:10px" }, [secSel, clsSel]));

  const grid = el("div", { class: "form-grid" });
  const fullName = input({ placeholder: "Full Name" });
  const gender = select(() => ["", "Male", "Female"].map((g) => ({ value: g, label: g || "Select Gender" })));
  const dob = input({ type: "date" });
  const parentName = input({ placeholder: "Parent / Guardian Name" });
  const parentPhone = input({ placeholder: "Parent Phone" });
  const address = input({ placeholder: "Home Address" });
  const admDate = input({ type: "date", value: todayISO() });
  grid.appendChild(field("Full Name", fullName));
  grid.appendChild(field("Gender", gender));
  grid.appendChild(field("Date of Birth", dob));
  grid.appendChild(field("Admission Date", admDate));
  grid.appendChild(field("Parent / Guardian Name", parentName));
  grid.appendChild(field("Parent Phone", parentPhone));
  grid.appendChild(field("Address", address, { full: true }));
  c.appendChild(grid);

  // Health info section (collapsible)
  const healthToggle = btn("+ Add Health Information (optional)", { variant: "ghost", attrs: { style: "margin:10px 0;font-size:13px" } });
  const healthSection = el("div", { style: "display:none" });
  const healthGrid = el("div", { class: "form-grid" });
  const hBloodGroup = select(() => ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(v => ({ value: v, label: v || "Blood Group" })));
  const hGenotype = select(() => ["", "AA", "AS", "SS", "AC", "SC"].map(v => ({ value: v, label: v || "Genotype" })));
  const hAllergies = input({ placeholder: "Known allergies" });
  const hChronicConditions = textarea({ rows: 2, placeholder: "Chronic conditions if any\u2026", style: "width:100%;resize:vertical" });
  const hEmergencyContact = input({ placeholder: "Emergency contact" });
  healthGrid.appendChild(field("Blood Group", hBloodGroup));
  healthGrid.appendChild(field("Genotype", hGenotype));
  healthGrid.appendChild(field("Allergies", hAllergies));
  healthGrid.appendChild(field("Chronic Conditions", hChronicConditions, { full: true }));
  healthGrid.appendChild(field("Emergency Contact", hEmergencyContact, { full: true }));
  healthSection.appendChild(healthGrid);
  let healthVisible = false;
  healthToggle.onclick = () => {
    healthVisible = !healthVisible;
    healthSection.style.display = healthVisible ? "" : "none";
    healthToggle.textContent = (healthVisible ? "- Hide" : "+ Add") + " Health Information (optional)";
  };
  c.appendChild(healthToggle);
  c.appendChild(healthSection);

  const opts = el("div", { class: "row", style: "margin-top:8px;gap:18px" });
  const booksCb = input({ type: "checkbox" });
  opts.appendChild(el("label", { class: "row", style: "gap:6px;align-items:center" }, [booksCb, el("span", { text: "Include Books" })]));
  const uniformWrap = el("div", { style: "margin-top:12px" });

  const bookWrap = el("div", { style: "margin-top:16px; padding:16px; background:var(--surface); border-radius:8px; border:1px solid var(--border); display:none;" });
  let bookSel = null;
  f.selectedBookLines = [];

  function updateUniformSel() {
    uniformWrap.innerHTML = "";
    f.uniformSelection = {};
    if (!secSel.value) return;
    const uniformBox = uniformSelector(secSel.value, clsSel.value, {
      selection: f.uniformSelection,
      onSelectionChange: (sel) => { f.uniformSelection = sel; try { recalc(); } catch (_) { console.warn("[AUDIT]", _); } }
    });
    uniformWrap.appendChild(uniformBox.wrap);
  }
  function updateBookSel() {
    bookWrap.innerHTML = "";
    f.selectedBookLines = [];
    if (!secSel.value) return;
    bookSel = bookSelector(secSel.value, clsSel.value, {
      onSelectionChange: (lines) => { f.selectedBookLines = lines; recalc(); }
    });
    if (bookSel) {
      bookWrap.appendChild(el("div", { class: "section-title", style: "margin-bottom:8px" }, [el("h4", { text: "\uD83D\uDCDA Books Catalogue", style: "margin:0" })]));
      bookWrap.appendChild(bookSel.wrap);
      if (f.includeBooks) {
        bookWrap.style.display = "block";
        bookSel.selectAll(true);
      } else {
        bookWrap.style.display = "none";
      }
    } else {
      bookWrap.style.display = "none";
    }
  }

  c.appendChild(opts);
  c.appendChild(uniformWrap);
  c.appendChild(bookWrap);

  const preview = el("div", { style: "margin-top:12px" });
  c.appendChild(preview);

  secSel.onchange = () => {
    clsSel.innerHTML = ""; clsSel.appendChild(el("option", { value: "", text: "Select Class" }));
    cfg.classes(secSel.value).forEach((cl) => clsSel.appendChild(el("option", { value: cl.id, text: cl.name })));
    clsSel.disabled = !secSel.value; updateUniformSel(); updateBookSel(); recalc();
  };
  clsSel.onchange = () => { updateUniformSel(); updateBookSel(); recalc(); };
  booksCb.onchange = () => {
    f.includeBooks = booksCb.checked;
    if (bookSel) {
      bookWrap.style.display = booksCb.checked ? "block" : "none";
      bookSel.selectAll(booksCb.checked);
    }
    recalc();
  };

  function recalc() {
    const sid = secSel.value;
    preview.innerHTML = "";
    if (!sid) { preview.appendChild(el("p", { class: "muted", text: "Select a section to preview the consolidated fees." })); return; }
    const lines = fullProgramLines(sid, { ...f, classId: clsSel.value, includeBooks: f.includeBooks && !(f.selectedBookLines || []).length });
    const rows = lines.map((l) => el("div", { class: "svc-row" }, [el("span", { class: "nm", text: l.name }), el("span", { class: "amt", text: naira(l.amount) })]));
    (f.selectedBookLines || []).forEach((l) => rows.push(el("div", { class: "svc-row" }, [el("span", { class: "nm", text: l.name }), el("span", { class: "amt", text: naira(l.amount) })])));
    preview.appendChild(el("div", { style: "font-weight:700;margin-bottom:6px", text: "Consolidated Invoice Preview" }));
    rows.forEach((r) => preview.appendChild(r));
    preview.appendChild(el("div", { style: "text-align:right;font-weight:800;font-size:17px;margin-top:8px", text: "Total Charges: " + naira(calculateInvoiceTotal([...lines, ...(f.selectedBookLines || [])])) }));
  }
  recalc();

  const gen = btn("Admit & Generate Consolidated Invoice", { variant: "success", icon: "\u2713", onclick: () => finishFullProgram() });
  c.appendChild(el("div", { class: "row", style: "margin-top:14px" }, [gen]));
  host.appendChild(c);

  async function finishFullProgram() {
    if (!secSel.value) return toast("Select a western section", "error");
    if (!clsSel.value) return toast("Select a class", "error");
    if (!fullName.value.trim()) return toast("Enter full name", "error");

    // Duplicate check
    const existing = db.list("students").filter(s => s.status !== "graduated" &&
      (s.fullName || "").toLowerCase().trim() === fullName.value.toLowerCase().trim());
    if (existing.length > 0) {
      const names = existing.map(s => `${s.fullName} (${s.admissionNo})`).join("; ");
      const proceed = await confirmDialog(`A student with the same name exists: ${names}. Proceed anyway?`, { title: "Duplicate Name Detected", okText: "Admit Anyway" });
      if (!proceed) return;
    }

    const programs = programSections(secSel.value);
    const admissionNo = await nextAdmissionId(new Date(admDate.value || Date.now()).getFullYear());
    const studentId = await nextStudentId();

    const healthRecord = (hBloodGroup.value || hGenotype.value || hAllergies.value.trim() || hChronicConditions.value.trim() || hEmergencyContact.value.trim()) ? {
      bloodGroup: hBloodGroup.value, genotype: hGenotype.value, allergies: hAllergies.value.trim(),
      chronicConditions: hChronicConditions.value.trim(), emergencyContact: hEmergencyContact.value.trim(),
      recordedAt: Date.now(), recordedBy: ctx.user.email
    } : null;

    const student = db.save("students", {
      fullName: fullName.value.trim(), gender: gender.value, dob: dob.value, admissionDate: admDate.value,
      parentName: parentName.value, parentPhone: parentPhone.value, address: address.value,
      admissionNo, studentId, sectionId: secSel.value, classId: clsSel.value,
      programIds: programs.map((p) => p.id),
      admissionType: "Full Program Student", programs: programs.map((p) => p.id), programNames: programs.map((p) => p.label),
      status: "active", session: cfg.currentSession(), createdBy: ctx.user.uid,
      healthConditions: healthRecord,
      history: [{ type: "admission", at: Date.now(), by: ctx.user.email, note: "Full Program admission (Western + Islamiyya + Tahfiz)" }]
    });
    await ensureFamilyForStudent(student);
    const lines = fullProgramLines(secSel.value, { ...f, classId: clsSel.value, includeBooks: f.includeBooks && !(f.selectedBookLines || []).length });
    const allLines = [...lines, ...(f.selectedBookLines || [])];
    const inv = await createInvoice({ student, services: allLines, type: "Full Program Student", session: termUI.getSession(), term: termUI.getTerm() });
    deductBookStock(f.selectedBookLines || []);
    db.save("auditLogs", { id: "adm-" + student.id, type: "admission", uid: ctx.user.uid, at: Date.now(), message: `Full Program admission ${student.fullName} (${admissionNo})` });
    logActivity({ module: "Admission", action: "Full Program Admission", description: `Admitted ${student.fullName} (${admissionNo}) into Western + Islamiyya + Tahfiz \u2014 invoice ${inv.invoiceNo}`, studentId: student.id, staffId: staffForUser(ctx.user)?.id || "", user: ctx.user.email });
    toast(`Admitted ${student.fullName} (Full Program) - ${admissionNo}`, "success", 4000);
    const smsCfg = db.setting("smsGateway") || {};
    if (smsCfg.autoAdmission && student.parentPhone) {
      sendSms(student.parentPhone, `Dear Parent,\n\nAdmission has been successfully completed for ${student.fullName}.\n\nCIC KANO\n08034760436`);
    }
    showInvoice(inv.id, { afterClose: () => ctx.go("students") });
  }
}

// ---- Migration Student ----
function migrationFlow(host, ctx) {
  host.innerHTML = "";
  const f = {};
  const termUI = enrollmentTermSelector();
  host.appendChild(termUI.wrap);

  const c = card("Migration Student Registration");
  c.appendChild(el("p", { class: "muted", text: "Register a student transferring in mid-term. Enter their outstanding balances below to automatically generate a Migration Invoice." }));

  const secSel = select(() => [{ value: "", label: "Select Section" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))]);
  const clsSel = select(() => [{ value: "", label: "Select Class" }], { disabled: "disabled" });
  secSel.onchange = () => {
    clsSel.innerHTML = ""; clsSel.appendChild(el("option", { value: "", text: "Select Class" }));
    cfg.classes(secSel.value).forEach((cl) => clsSel.appendChild(el("option", { value: cl.id, text: cl.name })));
    clsSel.disabled = !secSel.value;
  };

  const grid = el("div", { class: "form-grid" });
  const fullName = input({ placeholder: "Full Name" });
  const gender = select(() => ["", "Male", "Female"].map((g) => ({ value: g, label: g || "Select Gender" })));
  const dob = input({ type: "date" });
  const parentName = input({ placeholder: "Parent / Guardian Name" });
  const parentPhone = input({ placeholder: "Parent Phone" });
  const address = input({ placeholder: "Home Address" });
  const prevSchool = input({ placeholder: "Previous School" });
  const admDate = input({ type: "date", value: todayISO() });

  grid.appendChild(field("Section", secSel));
  grid.appendChild(field("Class", clsSel));
  grid.appendChild(field("Full Name", fullName));
  grid.appendChild(field("Gender", gender));
  grid.appendChild(field("Date of Birth", dob));
  grid.appendChild(field("Admission Date", admDate));
  grid.appendChild(field("Previous School", prevSchool));
  grid.appendChild(field("Parent / Guardian Name", parentName));
  grid.appendChild(field("Parent Phone", parentPhone));
  grid.appendChild(field("Address", address, { full: true }));
  c.appendChild(grid);

  // Outstanding balances
  c.appendChild(el("h3", { text: "Outstanding Balances", style: "margin-top:20px;border-bottom:1px solid var(--border);padding-bottom:8px" }));
  const balGrid = el("div", { class: "form-grid" });
  const balTuition = input({ type: "number", value: "0" });
  const balTransport = input({ type: "number", value: "0" });
  const balFeeding = input({ type: "number", value: "0" });
  const balBooks = input({ type: "number", value: "0" });
  const balOther = input({ type: "number", value: "0" });
  balGrid.appendChild(field("Outstanding Tuition (₦)", balTuition));
  balGrid.appendChild(field("Outstanding Transport (₦)", balTransport));
  balGrid.appendChild(field("Outstanding Feeding (₦)", balFeeding));
  balGrid.appendChild(field("Outstanding Books (₦)", balBooks));
  balGrid.appendChild(field("Other Services (₦)", balOther));
  c.appendChild(balGrid);

  // Books selection for migration
  let selectedBookLines = [];
  const bookWrap = el("div", { style: "margin-top:16px; padding:16px; background:var(--surface); border-radius:8px; border:1px solid var(--border); display:none;" });
  const bookSel = bookSelector(secSel.value, clsSel.value, {
    onSelectionChange: (lines) => { selectedBookLines = lines; recalc(); }
  });
  if (bookSel) {
    bookWrap.appendChild(el("div", { class: "section-title", style: "margin-bottom:8px" }, [el("h4", { text: "\uD83D\uDCDA Books Catalogue", style: "margin:0" })]));
    bookWrap.appendChild(bookSel.wrap);
  }

  const bcb = input({ type: "checkbox" });
  bcb.onchange = () => {
    if (bookSel) {
      bookWrap.style.display = bcb.checked ? "block" : "none";
      bookSel.selectAll(bcb.checked);
    }
    recalc();
  };
  c.appendChild(el("div", { class: "svc-row", style: "margin-top:16px" }, [bcb, el("span", { class: "nm", text: "Include Books (Add to Invoice)" }), el("span", { class: "amt", text: bookSel ? "Select items below" : "" })]));
  if (bookSel) c.appendChild(bookWrap);

  const prevEvidence = input({ type: "file", accept: "image/*,application/pdf" });
  c.appendChild(field("Previous Payment Evidence (optional)", prevEvidence, { style: "margin-top:16px" }));

  const totalEl = el("div", { style: "text-align:right;font-weight:800;font-size:16px;margin-top:8px" });
  c.appendChild(totalEl);

  function recalc() {
    const balTotal = num(balTuition.value) + num(balTransport.value) + num(balFeeding.value) + num(balBooks.value) + num(balOther.value);
    totalEl.textContent = "Total: " + naira(balTotal + calculateInvoiceTotal(selectedBookLines));
  }
  recalc();

  const gen = btn("Register & Generate Migration Invoice", { variant: "success", icon: "✓", onclick: () => finishMigration() });
  c.appendChild(el("div", { class: "row", style: "margin-top:20px" }, [gen]));
  host.appendChild(c);

  async function finishMigration() {
    if (!secSel.value) return toast("Select a section", "error");
    if (!clsSel.value) return toast("Select a class", "error");
    if (!fullName.value.trim()) return toast("Enter full name", "error");

    const admissionNo = await nextAdmissionId(new Date(admDate.value || Date.now()).getFullYear());
    const studentId = await nextStudentId();

    let evidenceData = null;
    if (prevEvidence.files[0]) {
      const file = prevEvidence.files[0];
      if (file.type.startsWith("image/")) {
        evidenceData = await resizeImageAsDataURL(file, 1000);
      } else {
        if (file.size > 250000) return toast("File too large. Please compress PDFs under 250KB or upload a picture instead.", "error");
        evidenceData = await readFileAsDataURL(file);
      }
    }

    const student = db.save("students", {
      fullName: fullName.value.trim(), gender: gender.value, dob: dob.value, admissionDate: admDate.value,
      parentName: parentName.value, parentPhone: parentPhone.value, address: address.value,
      previousSchool: prevSchool.value.trim(), previousPaymentEvidence: evidenceData,
      admissionNo, studentId, sectionId: secSel.value, classId: clsSel.value,
      programIds: cfg.studentProgramIds({ sectionId: secSel.value }),
      programs: cfg.studentProgramIds({ sectionId: secSel.value }),
      programNames: cfg.studentProgramIds({ sectionId: secSel.value }).map(id => cfg.programName(id)),
      admissionType: "Migration Student",
      status: "active", session: cfg.currentSession(), createdBy: ctx.user.uid,
      history: [{ type: "admission", at: Date.now(), by: ctx.user.email, note: "Migration Student admission" }]
    });

    try {
      await ensureFamilyForStudent(student);

      const services = [];
      if (num(balTuition.value) > 0) services.push({ id: "bf-tuition", name: "Outstanding Tuition", amount: num(balTuition.value), type: "fee", optional: false });
      if (num(balTransport.value) > 0) services.push({ id: "bf-transport", name: "Outstanding Transport", amount: num(balTransport.value), type: "fee", optional: false });
      if (num(balFeeding.value) > 0) services.push({ id: "bf-feeding", name: "Outstanding Feeding", amount: num(balFeeding.value), type: "fee", optional: false });
      if (num(balBooks.value) > 0) services.push({ id: "bf-books", name: "Outstanding Books", amount: num(balBooks.value), type: "fee", optional: false });
      if (num(balOther.value) > 0) services.push({ id: "bf-other", name: "Other Outstanding Services", amount: num(balOther.value), type: "fee", optional: false });

      // Add selected books to invoice
      services.push(...selectedBookLines);

      // Ensure we create an invoice even if it's 0 to record the admission
      if (services.length === 0) {
        services.push({ id: "bf-none", name: "No Outstanding Balance", amount: 0, type: "fee", optional: false });
      }

      const inv = await createInvoice({ student, services, type: "Migration Invoice", session: termUI.getSession(), term: termUI.getTerm() });
      deductBookStock(selectedBookLines);
      db.save("auditLogs", { id: "adm-" + student.id, type: "admission", uid: ctx.user.uid, at: Date.now(), message: `Migration admission ${student.fullName} (${admissionNo})` });
      logActivity({ module: "Admission", action: "Migration Admission", description: `Migrated ${student.fullName} (${admissionNo}) \u2014 invoice ${inv.invoiceNo}`, studentId: student.id, staffId: staffForUser(ctx.user)?.id || "", user: ctx.user.email });
      toast(`Migrated ${student.fullName} \u2014 ${admissionNo}`, "success", 4000);
      showInvoice(inv.id, { afterClose: () => ctx.go("students") });
    } catch (e) {
      console.error(e);
      toast("Error creating invoice: " + e.message, "error");
    }
  }
}









