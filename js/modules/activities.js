import { db } from "../core/db.js";
import { el, fmtDate, modal, toast, confirmDialog, uuid } from "../core/utils.js";
import { card, pageHead, table, input, btn, select, field } from "../core/ui.js";

export function render(root, ctx) {
  root.appendChild(pageHead("Extracurricular Activities", "Manage clubs, sports, and other activities."));
  
  const isManager = ["Super Admin", "Admin", "Principal"].includes(ctx.user.role);

  const headerRow = el("div", { class: "row", style: "margin-bottom:14px; gap:8px" });
  if (isManager) {
    headerRow.appendChild(btn("+ New Activity", { variant: "primary", onclick: () => activityForm(null) }));
  }
  root.appendChild(headerRow);
  
  const host = el("div");
  root.appendChild(host);

  function draw() {
    let rows = db.list("extracurricular").sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    
    // Staff can only view activities they supervise
    if (!isManager) {
      const staffInfo = db.find("staff", s => s.email === ctx.user.email);
      const staffId = staffInfo ? staffInfo.id : ctx.user.uid;
      rows = rows.filter(a => a.supervisorId === staffId);
    }

    host.innerHTML = "";
    host.appendChild(card("Activities & Clubs", [table([
      { label: "Activity Name", key: "name" },
      { label: "Type", key: "type" },
      { label: "Schedule", key: "schedule" },
      { label: "Supervisor", render: a => {
        if (!a.supervisorId) return "—";
        const staff = db.get("staff", a.supervisorId);
        return staff ? staff.name : "—";
      }},
      { label: "Students", align: "center", render: a => {
        const count = db.query("extracurricular_members", m => m.activityId === a.id).length;
        return String(count);
      }},
      { label: "", render: a => el("div", { class: "row", style: "gap:4px" }, [
          btn("Manage", { sm: true, onclick: () => manageActivity(a) }),
          ...(isManager ? [
            btn("Edit", { sm: true, onclick: () => activityForm(a) }),
            btn("Delete", { sm: true, variant: "danger", onclick: () => deleteActivity(a.id) })
          ] : [])
        ])
      }
    ], rows, { empty: isManager ? "No activities found." : "You are not supervising any activities." })]));
  }

  function activityForm(existing) {
    const name = input({ value: existing?.name || "", placeholder: "e.g. Football Club" });
    const type = select(() => ["Sports", "Academic Club", "Arts & Culture", "Other"].map(t => ({ value: t, label: t, selected: existing?.type === t })));
    const schedule = input({ value: existing?.schedule || "", placeholder: "e.g. Fridays 3:00 PM" });
    
    const staffList = db.list("staff").sort((a, b) => a.name.localeCompare(b.name));
    const supervisor = select(() => [{ value: "", label: "Select Supervisor" }, ...staffList.map(s => ({ value: s.id, label: s.name, selected: existing?.supervisorId === s.id }))]);

    const body = el("div", { class: "form-grid" }, [
      field("Activity Name", name),
      field("Type", type),
      field("Schedule", schedule),
      field("Supervisor", supervisor)
    ]);

    const m = modal({ title: existing ? "Edit Activity" : "New Activity", body, footer: [
      btn("Save", { variant: "primary", onclick: () => {
        if (!name.value.trim()) return toast("Name required", "error");
        db.save("extracurricular", {
          id: existing?.id || uuid(),
          name: name.value.trim(),
          type: type.value,
          schedule: schedule.value.trim(),
          supervisorId: supervisor.value,
          createdAt: existing?.createdAt || Date.now()
        });
        toast("Saved successfully", "success");
        m.close();
        draw();
      } }),
      btn("Cancel", { onclick: () => m.close() })
    ]});
  }

  async function deleteActivity(id) {
    if (await confirmDialog("Delete this activity? All student memberships will be removed.")) {
      db.delete("extracurricular", id);
      db.query("extracurricular_members", m => m.activityId === id).forEach(m => db.delete("extracurricular_members", m.id));
      toast("Deleted", "success");
      draw();
    }
  }

  function manageActivity(act) {
    host.innerHTML = "";
    host.appendChild(pageHead(`Manage: ${act.name}`, `${act.type} • ${act.schedule}`, [
      btn("← Back", { onclick: draw })
    ]));

    const membersHost = el("div");
    host.appendChild(membersHost);

    const drawMembers = () => {
      const members = db.query("extracurricular_members", m => m.activityId === act.id);
      
      const c = card("Enrolled Students", [
        ...(isManager ? [
          el("div", { class: "row", style: "margin-bottom:12px; gap:8px" }, [
            btn("+ Add Student", { variant: "primary", sm: true, onclick: () => addStudentModal(act.id, drawMembers) })
          ])
        ] : []),
        table([
          { label: "Student", render: m => { const s = db.get("students", m.studentId); return s ? s.fullName : "Unknown"; } },
          { label: "Class", render: m => { const s = db.get("students", m.studentId); return s ? (db.get("classes", s.classId)?.name || "") : ""; } },
          { label: "Joined", render: m => fmtDate(m.joinedAt) },
          { label: "", render: m => el("div", { class: "row", style: "gap:4px" }, [
            btn("Attendance", { sm: true, onclick: () => markAttendanceModal(act, m) }),
            btn("Remarks", { sm: true, onclick: () => remarksModal(act, m) }),
            ...(isManager ? [
              btn("Remove", { sm: true, variant: "danger", onclick: () => { db.delete("extracurricular_members", m.id); drawMembers(); } })
            ] : [])
          ])}
        ], members, { empty: "No students enrolled." })
      ]);
      membersHost.innerHTML = "";
      membersHost.appendChild(c);
    };
    drawMembers();
  }

  function addStudentModal(actId, onAdded) {
    const enrolled = db.query("extracurricular_members", m => m.activityId === actId).map(m => m.studentId);
    const available = db.list("students").filter(s => s.status === "active" && !enrolled.includes(s.id));
    
    const sel = select(() => [{ value: "", label: "Select Student" }, ...available.map(s => ({ value: s.id, label: `${s.fullName} (${s.admissionNo})` }))], { style: "width:100%" });
    const body = el("div", {}, [field("Student", sel)]);
    
    const m = modal({ title: "Add Student to Activity", body, footer: [
      btn("Add", { variant: "success", onclick: () => {
        if (!sel.value) return toast("Select a student", "error");
        db.save("extracurricular_members", { id: uuid(), activityId: actId, studentId: sel.value, joinedAt: Date.now() });
        toast("Student added", "success");
        m.close();
        onAdded();
      }}),
      btn("Cancel", { onclick: () => m.close() })
    ]});
  }

  function markAttendanceModal(act, member) {
    const student = db.get("students", member.studentId);
    const dateInp = input({ type: "date", value: new Date().toISOString().split('T')[0] });
    const statusSel = select(() => ["Present", "Absent", "Late"].map(s => ({ value: s, label: s })));
    
    const body = el("div", { class: "form-grid" }, [
      field("Date", dateInp), field("Status", statusSel)
    ]);

    const m = modal({ title: `Attendance: ${student?.fullName}`, body, footer: [
      btn("Save", { variant: "primary", onclick: () => {
        db.save("extracurricular_attendance", {
          id: uuid(), activityId: act.id, studentId: member.studentId,
          date: dateInp.value, status: statusSel.value, recordedBy: ctx.user.email, recordedAt: Date.now()
        });
        toast("Attendance recorded", "success");
        m.close();
      }}),
      btn("Cancel", { onclick: () => m.close() })
    ]});
  }

  function remarksModal(act, member) {
    const student = db.get("students", member.studentId);
    const text = el("textarea", { placeholder: "Enter remarks or notes about the student's performance...", style: "width:100%;height:100px;padding:8px" });
    
    const existingRemarks = db.query("extracurricular_remarks", r => r.activityId === act.id && r.studentId === member.studentId);
    const remarksList = el("div", { style: "margin-top:10px; max-height:150px; overflow-y:auto;" }, 
      existingRemarks.map(r => el("div", { style: "padding:8px; border-bottom:1px solid #ccc; font-size:13px;" }, [
        el("div", { style: "font-weight:bold; color:var(--brand);", text: fmtDate(r.at) + " by " + r.by }),
        el("div", { text: r.text })
      ]))
    );

    const body = el("div", {}, [text, remarksList]);
    
    const m = modal({ title: `Remarks: ${student?.fullName}`, body, footer: [
      btn("Add Remark", { variant: "primary", onclick: () => {
        if (!text.value.trim()) return toast("Enter remark text", "error");
        db.save("extracurricular_remarks", {
          id: uuid(), activityId: act.id, studentId: member.studentId,
          text: text.value.trim(), by: ctx.user.email, at: Date.now()
        });
        toast("Remark added", "success");
        m.close();
      }}),
      btn("Close", { onclick: () => m.close() })
    ]});
  }

  draw();
  const offs = ["extracurricular", "extracurricular_members"].map(c => db.on(c, draw));
  return () => offs.forEach(o => o());
}
