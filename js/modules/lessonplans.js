import { db } from "../core/db.js";
import { el, toast, uuid, debounce, confirmDialog, fmtDate, modal } from "../core/utils.js";
import { card, pageHead, table, btn, input, select, field } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { normaliseRole } from "../core/rbac.js";

export function render(root, ctx) {
  const role = normaliseRole(ctx.user.role);
  const canManage = ["Super Admin", "Admin", "Principal", "Teacher"].includes(role);
  if (!canManage) {
    root.appendChild(pageHead("Lesson Plans"));
    root.appendChild(card("Access", [el("p", { class: "muted", text: "Your role cannot manage lesson plans." })]));
    return;
  }

  const teacher = role === "Teacher" ? db.query("staff", s => s.email === ctx.user.email || s.id === ctx.user.staffId)[0] : null;
  const assignedClasses = teacher?.assignedClasses || [];
  const assignedSubjects = teacher?.assignedSubjects || [];
  const staffList = db.list("staff").sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  root.appendChild(pageHead("Lesson Plans", "Create, edit, delete and filter lesson plans.", [
    btn("New Lesson Plan", { variant: "primary", icon: "+", onclick: () => openForm(null) })
  ]));

  const filterClass = select(() => [{ value: "", label: "All Classes" }, ...visibleClasses().map(c => ({ value: c.id, label: c.name }))]);
  const filterSubject = input({ placeholder: "Subject" });
  const filterTeacher = select(() => [{ value: "", label: "All Teachers" }, ...staffList.map(s => ({ value: s.id, label: s.name, selected: s.id === ctx.user.staffId }))]);
  const filterTerm = select(() => [{ value: "", label: "All Terms" }, ...(cfg.sessions().terms || ["First Term", "Second Term", "Third Term"]).map(t => ({ value: t, label: t }))]);
  const filterSession = select(() => [{ value: "", label: "All Sessions" }, ...(cfg.sessions().list || [cfg.currentSession()]).filter(Boolean).map(s => ({ value: s, label: s }))]);

  root.appendChild(card("Filters", [el("div", { class: "form-grid" }, [
    field("Class", filterClass),
    field("Subject", filterSubject),
    field("Teacher", filterTeacher),
    field("Term", filterTerm),
    field("Session", filterSession)
  ])]));

  const host = el("div");
  root.appendChild(host);
  const redraw = debounce(draw, 150);
  [filterClass, filterSubject, filterTeacher, filterTerm, filterSession].forEach(x => x.oninput = redraw);
  draw();
  const offPlans = db.on("lessonPlans", draw);
  const offStaff = db.on("staff", draw);
  return () => { offPlans(); offStaff(); };

  function visibleClasses() {
    let classes = cfg.classes();
    if (role === "Teacher") classes = classes.filter(c => assignedClasses.includes(c.id));
    return classes;
  }

  function teacherName(id) {
    return db.get("staff", id)?.name || id || "";
  }

  function canEditPlan(plan) {
    if (role !== "Teacher") return true;
    return assignedClasses.includes(plan.classId) && (!plan.staffId || plan.staffId === ctx.user.staffId);
  }

  function draw() {
    let rows = db.list("lessonPlans").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (role === "Teacher") rows = rows.filter(p => assignedClasses.includes(p.classId) || p.staffId === ctx.user.staffId);
    if (filterClass.value) rows = rows.filter(p => p.classId === filterClass.value);
    if (filterSubject.value.trim()) rows = rows.filter(p => String(p.subject || "").toLowerCase().includes(filterSubject.value.trim().toLowerCase()));
    if (filterTeacher.value) rows = rows.filter(p => p.staffId === filterTeacher.value);
    if (filterTerm.value) rows = rows.filter(p => p.term === filterTerm.value);
    if (filterSession.value) rows = rows.filter(p => p.session === filterSession.value);

    host.innerHTML = "";
    host.appendChild(card("Lesson Plan Records", [table([
      { label: "Date", render: p => fmtDate(p.date) },
      { label: "Title", key: "title" },
      { label: "Class", render: p => cfg.className(p.classId) },
      { label: "Subject", key: "subject" },
      { label: "Week", key: "week" },
      { label: "Teacher", render: p => teacherName(p.staffId) },
      { label: "", render: p => el("div", { class: "row" }, [
        btn("View", { sm: true, onclick: () => viewPlan(p) }),
        btn("Edit", { sm: true, variant: "primary", attrs: canEditPlan(p) ? {} : { disabled: "disabled" }, onclick: () => openForm(p) }),
        btn("Delete", { sm: true, variant: "danger", attrs: canEditPlan(p) ? {} : { disabled: "disabled" }, onclick: () => deletePlan(p) })
      ])}
    ], rows, { empty: "No lesson plans found." })]));
  }

  function classSubjectOptions(sectionId) {
    let subjects = cfg.subjects(sectionId);
    if (role === "Teacher") subjects = subjects.filter(s => assignedSubjects.includes(s.name));
    return subjects;
  }

  function openForm(existing) {
    if (existing && !canEditPlan(existing)) return toast("You can only edit your assigned lesson plans.", "error");
    const plan = existing || {};
    const classes = visibleClasses();
    const title = input({ value: plan.title || "", placeholder: "Lesson title" });
    const sec = select(() => [{ value: "", label: "Section" }, ...cfg.sections().map(s => ({ value: s.id, label: s.name, selected: s.id === plan.sectionId }))]);
    const cls = select(() => [{ value: "", label: "Class" }]);
    const subject = select(() => [{ value: "", label: "Subject" }]);
    const week = input({ value: plan.week || "", placeholder: "e.g. Week 4" });
    const date = input({ type: "date", value: plan.date || new Date().toISOString().slice(0, 10) });
    const term = select(() => (cfg.sessions().terms || ["First Term", "Second Term", "Third Term"]).map(t => ({ value: t, label: t, selected: (plan.term || cfg.currentTerm()) === t })));
    const session = select(() => (cfg.sessions().list || [cfg.currentSession()]).filter(Boolean).map(s => ({ value: s, label: s, selected: (plan.session || cfg.currentSession()) === s })));
    const objectives = input({ value: plan.objectives || "", placeholder: "Objectives" });
    const materials = input({ value: plan.materials || "", placeholder: "Materials" });
    const methods = input({ value: plan.methods || plan.teachingMethods || "", placeholder: "Teaching methods" });
    const activities = input({ value: plan.activities || "", placeholder: "Activities" });
    const assessment = input({ value: plan.assessment || "", placeholder: "Assessment" });
    const remarks = input({ value: plan.remarks || "", placeholder: "Remarks" });

    function fillClasses() {
      cls.innerHTML = '<option value="">Class</option>';
      classes.filter(c => !sec.value || c.sectionId === sec.value).forEach(c => cls.appendChild(el("option", { value: c.id, text: c.name, selected: c.id === plan.classId })));
      fillSubjects();
    }
    function fillSubjects() {
      subject.innerHTML = '<option value="">Subject</option>';
      const sectionId = sec.value || classes.find(c => c.id === cls.value)?.sectionId || plan.sectionId;
      classSubjectOptions(sectionId).forEach(s => subject.appendChild(el("option", { value: s.name, text: s.name, selected: s.name === plan.subject })));
    }
    sec.onchange = fillClasses;
    cls.onchange = fillSubjects;
    fillClasses();
    if (plan.classId) cls.value = plan.classId;
    fillSubjects();
    if (plan.subject) subject.value = plan.subject;

    const body = el("div", { class: "form-grid" }, [
      field("Lesson Title", title, { full: true }),
      field("Section", sec), field("Class", cls), field("Subject", subject), field("Week", week),
      field("Date", date), field("Term", term), field("Session", session),
      field("Objectives", objectives, { full: true }),
      field("Materials", materials, { full: true }),
      field("Teaching Methods", methods, { full: true }),
      field("Activities", activities, { full: true }),
      field("Assessment", assessment, { full: true }),
      field("Remarks", remarks, { full: true })
    ]);

    const m = modal({ title: existing ? "Edit Lesson Plan" : "New Lesson Plan", size: "lg", body, footer: [
      btn("Save", { variant: "primary", onclick: () => {
        if (!title.value.trim() || !sec.value || !cls.value || !subject.value) return toast("Title, section, class and subject are required.", "error");
        const staffId = role === "Teacher" ? ctx.user.staffId : (plan.staffId || ctx.user.staffId || "");
        db.save("lessonPlans", {
          ...plan,
          id: plan.id || uuid(),
          title: title.value.trim(),
          sectionId: sec.value,
          classId: cls.value,
          subject: subject.value,
          subjectId: subject.value,
          week: week.value.trim(),
          date: date.value,
          term: term.value,
          session: session.value,
          objectives: objectives.value.trim(),
          materials: materials.value.trim(),
          methods: methods.value.trim(),
          teachingMethods: methods.value.trim(),
          activities: activities.value.trim(),
          assessment: assessment.value.trim(),
          remarks: remarks.value.trim(),
          staffId,
          teacherName: teacherName(staffId) || ctx.user.name || ctx.user.email,
          by: ctx.user.email,
          updatedAt: Date.now()
        });
        toast(existing ? "Lesson plan updated" : "Lesson plan created", "success");
        m.close();
        draw();
      }})
    ]});
  }

  function viewPlan(plan) {
    const body = el("div", { class: "form-grid" }, [
      field("Title", el("div", { text: plan.title || "" }), { full: true }),
      field("Class", el("div", { text: cfg.className(plan.classId) })),
      field("Subject", el("div", { text: plan.subject || "" })),
      field("Week", el("div", { text: plan.week || "" })),
      field("Date", el("div", { text: fmtDate(plan.date) })),
      field("Objectives", el("div", { text: plan.objectives || "" }), { full: true }),
      field("Materials", el("div", { text: plan.materials || "" }), { full: true }),
      field("Teaching Methods", el("div", { text: plan.methods || plan.teachingMethods || "" }), { full: true }),
      field("Activities", el("div", { text: plan.activities || "" }), { full: true }),
      field("Assessment", el("div", { text: plan.assessment || "" }), { full: true }),
      field("Remarks", el("div", { text: plan.remarks || "" }), { full: true })
    ]);
    modal({ title: "Lesson Plan", size: "lg", body });
  }

  async function deletePlan(plan) {
    if (!canEditPlan(plan)) return toast("You can only delete your assigned lesson plans.", "error");
    if (!(await confirmDialog("Delete this lesson plan?", { danger: true, okText: "Delete" }))) return;
    db.delete("lessonPlans", plan.id);
    toast("Lesson plan deleted", "success");
    draw();
  }
}
