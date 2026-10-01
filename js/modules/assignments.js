import { db } from "../core/db.js";
import { el, toast, uuid, debounce, confirmDialog, fmtDate, modal } from "../core/utils.js";
import { card, pageHead, table, btn, input, select, field, readFileAsDataURL } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { normaliseRole } from "../core/rbac.js";

export function render(root, ctx) {
  const role = normaliseRole(ctx.user.role);
  const canManage = ["Super Admin", "Admin", "Principal", "Teacher"].includes(role);
  if (!canManage) {
    root.appendChild(pageHead("Assignments"));
    root.appendChild(card("Access", [el("p", { class: "muted", text: "Your role cannot manage assignments." })]));
    return;
  }

  const teacher = role === "Teacher" ? db.query("staff", s => s.email === ctx.user.email || s.id === ctx.user.staffId)[0] : null;
  const assignedClasses = teacher?.assignedClasses || [];
  const assignedSubjects = teacher?.assignedSubjects || [];
  const staffList = db.list("staff").sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  root.appendChild(pageHead("Assignments", "Create, edit and delete class assignments.", [
    btn("New Assignment", { variant: "primary", icon: "+", onclick: () => openForm(null) })
  ]));

  const filterClass = select(() => [{ value: "", label: "All Classes" }, ...visibleClasses().map(c => ({ value: c.id, label: c.name }))]);
  const filterSubject = input({ placeholder: "Subject" });
  const filterTeacher = select(() => [{ value: "", label: "All Teachers" }, ...staffList.map(s => ({ value: s.id, label: s.name }))]);
  root.appendChild(card("Filters", [el("div", { class: "form-grid" }, [
    field("Class", filterClass), field("Subject", filterSubject), field("Teacher", filterTeacher)
  ])]));

  const host = el("div");
  root.appendChild(host);
  const redraw = debounce(draw, 150);
  [filterClass, filterSubject, filterTeacher].forEach(x => x.oninput = redraw);
  draw();
  const off = db.on("assignments", draw);
  return () => off();

  function visibleClasses() {
    let classes = cfg.classes();
    if (role === "Teacher") classes = classes.filter(c => assignedClasses.includes(c.id));
    return classes;
  }
  function teacherName(id) { return db.get("staff", id)?.name || id || ""; }
  function canEditAssignment(a) {
    if (role !== "Teacher") return true;
    return assignedClasses.includes(a.classId) && (!a.staffId || a.staffId === ctx.user.staffId);
  }

  function draw() {
    let rows = db.list("assignments").sort((a, b) => String(b.dueDate || "").localeCompare(String(a.dueDate || "")));
    if (role === "Teacher") rows = rows.filter(a => assignedClasses.includes(a.classId) || a.staffId === ctx.user.staffId);
    if (filterClass.value) rows = rows.filter(a => a.classId === filterClass.value);
    if (filterSubject.value.trim()) rows = rows.filter(a => String(a.subject || "").toLowerCase().includes(filterSubject.value.trim().toLowerCase()));
    if (filterTeacher.value) rows = rows.filter(a => a.staffId === filterTeacher.value);
    host.innerHTML = "";
    host.appendChild(card("Assignment Records", [table([
      { label: "Title", key: "title" },
      { label: "Class", render: a => cfg.className(a.classId) },
      { label: "Subject", key: "subject" },
      { label: "Due Date", render: a => fmtDate(a.dueDate) },
      { label: "Teacher", render: a => teacherName(a.staffId) },
      { label: "", render: a => el("div", { class: "row" }, [
        btn("View", { sm: true, onclick: () => viewAssignment(a) }),
        btn("Edit", { sm: true, variant: "primary", attrs: canEditAssignment(a) ? {} : { disabled: "disabled" }, onclick: () => openForm(a) }),
        btn("Delete", { sm: true, variant: "danger", attrs: canEditAssignment(a) ? {} : { disabled: "disabled" }, onclick: () => deleteAssignment(a) })
      ])}
    ], rows, { empty: "No assignments found." })]));
  }

  function openForm(existing) {
    if (existing && !canEditAssignment(existing)) return toast("You can only edit your assigned assignments.", "error");
    const rec = existing || {};
    const classes = visibleClasses();
    const title = input({ value: rec.title || "", placeholder: "Assignment title" });
    const description = input({ value: rec.description || "", placeholder: "Description" });
    const sec = select(() => [{ value: "", label: "Section" }, ...cfg.sections().map(s => ({ value: s.id, label: s.name, selected: s.id === rec.sectionId }))]);
    const cls = select(() => [{ value: "", label: "Class" }]);
    const subject = select(() => [{ value: "", label: "Subject" }]);
    const dueDate = input({ type: "date", value: rec.dueDate || new Date().toISOString().slice(0, 10) });
    const file = input({ type: "file", style: "display:none" });
    const attachmentName = el("span", { class: "muted", text: rec.attachmentName || "No attachment" });
    let attachment = rec.attachment || "";
    let attachmentFileName = rec.attachmentName || "";

    const attachBtn = btn("Choose Attachment", { onclick: () => file.click() });
    file.onchange = async () => {
      if (!file.files[0]) return;
      attachment = await readFileAsDataURL(file.files[0]);
      attachmentFileName = file.files[0].name;
      attachmentName.textContent = attachmentFileName;
    };

    function fillClasses() {
      cls.innerHTML = '<option value="">Class</option>';
      classes.filter(c => !sec.value || c.sectionId === sec.value).forEach(c => cls.appendChild(el("option", { value: c.id, text: c.name, selected: c.id === rec.classId })));
      fillSubjects();
    }
    function fillSubjects() {
      subject.innerHTML = '<option value="">Subject</option>';
      const sectionId = sec.value || classes.find(c => c.id === cls.value)?.sectionId || rec.sectionId;
      let subjects = cfg.subjects(sectionId);
      if (role === "Teacher") subjects = subjects.filter(s => assignedSubjects.includes(s.name));
      subjects.forEach(s => subject.appendChild(el("option", { value: s.name, text: s.name, selected: s.name === rec.subject })));
    }
    sec.onchange = fillClasses;
    cls.onchange = fillSubjects;
    fillClasses();
    if (rec.classId) cls.value = rec.classId;
    fillSubjects();
    if (rec.subject) subject.value = rec.subject;

    const body = el("div", { class: "form-grid" }, [
      field("Title", title, { full: true }),
      field("Description", description, { full: true }),
      field("Section", sec), field("Class", cls), field("Subject", subject), field("Due Date", dueDate),
      field("Attachment", el("div", { class: "row" }, [attachBtn, attachmentName, file]), { full: true })
    ]);

    const m = modal({ title: existing ? "Edit Assignment" : "New Assignment", size: "lg", body, footer: [
      btn("Save", { variant: "primary", onclick: () => {
        if (!title.value.trim() || !description.value.trim() || !sec.value || !cls.value || !subject.value) {
          return toast("Title, description, section, class and subject are required.", "error");
        }
        const staffId = role === "Teacher" ? ctx.user.staffId : (rec.staffId || ctx.user.staffId || "");
        db.save("assignments", {
          ...rec,
          id: rec.id || uuid(),
          title: title.value.trim(),
          description: description.value.trim(),
          sectionId: sec.value,
          classId: cls.value,
          subject: subject.value,
          subjectId: subject.value,
          dueDate: dueDate.value,
          attachment,
          attachmentName: attachmentFileName,
          staffId,
          teacherName: teacherName(staffId) || ctx.user.name || ctx.user.email,
          by: ctx.user.email,
          updatedAt: Date.now()
        });
        toast(existing ? "Assignment updated" : "Assignment created", "success");
        m.close();
        draw();
      }})
    ]});
  }

  function viewAssignment(a) {
    const attachment = a.attachment ? el("a", { href: a.attachment, download: a.attachmentName || "attachment", text: a.attachmentName || "Download attachment" }) : el("span", { class: "muted", text: "No attachment" });
    modal({ title: "Assignment", size: "lg", body: el("div", { class: "form-grid" }, [
      field("Title", el("div", { text: a.title || "" }), { full: true }),
      field("Description", el("div", { text: a.description || "" }), { full: true }),
      field("Class", el("div", { text: cfg.className(a.classId) })),
      field("Subject", el("div", { text: a.subject || "" })),
      field("Due Date", el("div", { text: fmtDate(a.dueDate) })),
      field("Teacher", el("div", { text: teacherName(a.staffId) })),
      field("Attachment", attachment, { full: true })
    ])});
  }

  async function deleteAssignment(a) {
    if (!canEditAssignment(a)) return toast("You can only delete your assigned assignments.", "error");
    if (!(await confirmDialog("Delete this assignment?", { danger: true, okText: "Delete" }))) return;
    db.delete("assignments", a.id);
    toast("Assignment deleted", "success");
    draw();
  }
}
