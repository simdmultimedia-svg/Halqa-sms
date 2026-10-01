const fs = require('fs');
let code = fs.readFileSync('js/modules/students.js', 'utf8');

const target = `function manageIslamiyyaTahfizPlacements(ctx) {`;
const idx = code.indexOf(target);
if (idx !== -1) {
    const replacement = `function manageIslamiyyaTahfizPlacements(ctx) {
  const islSecs = cfg.sections().filter(s => s.type === "islamiyya");
  const tahSecs = cfg.sections().filter(s => s.type === "tahfiz");

  let islClasses = [];
  islSecs.forEach(s => islClasses.push(...cfg.classes(s.id)));
  
  let tahClasses = [];
  tahSecs.forEach(s => tahClasses.push(...cfg.classes(s.id)));

  let students = [];
  function refreshStudentData() {
    students = db.list("students").filter(s => s.status !== "graduated" && s.status !== "suspended");
    students = students.filter(s => {
      let hasIsl = false;
      let hasTah = false;
      const progs = (s.programIds || []).map(pid => cfg.program(pid) || { id: pid, sectionId: pid }).filter(Boolean);
      progs.forEach(p => {
        const sec = cfg.section(p.sectionId) || cfg.section(p.id);
        if (sec && sec.type === "islamiyya") hasIsl = true;
        if (sec && sec.type === "tahfiz") hasTah = true;
      });
      const mainSec = cfg.section(s.sectionId);
      if (mainSec && mainSec.type === "islamiyya") hasIsl = true;
      if (mainSec && mainSec.type === "tahfiz") hasTah = true;
      
      s._hasIsl = hasIsl;
      s._hasTah = hasTah;
      return hasIsl || hasTah;
    });
  }
  refreshStudentData();

  const localSel = new BulkSelection();
  
  const m = modal({
    title: "Islamiyya & Tahfiz Placements",
    full: true,
    body: el("div", {}, [
      el("p", { class: "muted", text: "Select students below to assign them to specific Islamiyya or Tahfiz classes without changing their main Western class." }),
      bulkActionBar(localSel, [
        { label: "Set Islamiyya Class", action: (ids) => {
            const cSel = select([{value: "", label: "-- Clear Class --"}, ...islClasses.map(c => ({value: c.id, label: c.name}))]);
            const m2 = modal({
              title: "Set Islamiyya Class",
              body: el("div", {}, [el("p", {text: "Select class:"}), cSel]),
              footer: [
                btn("Apply", { variant: "primary", onclick: () => {
                  ids.forEach(id => {
                    const st = db.get("students", id);
                    if (st) {
                      st.islamiyyaClassId = cSel.value;
                      db.save("students", st);
                    }
                  });
                  toast("Islamiyya class updated for " + ids.length + " students", "success");
                  m2.close();
                  refreshStudentData();
                  renderTable();
                  localSel.clear();
                }})
              ]
            });
        }},
        { label: "Set Tahfiz Class", action: (ids) => {
            const cSel = select([{value: "", label: "-- Clear Class --"}, ...tahClasses.map(c => ({value: c.id, label: c.name}))]);
            const m2 = modal({
              title: "Set Tahfiz Class",
              body: el("div", {}, [el("p", {text: "Select class:"}), cSel]),
              footer: [
                btn("Apply", { variant: "primary", onclick: () => {
                  ids.forEach(id => {
                    const st = db.get("students", id);
                    if (st) {
                      st.tahfizClassId = cSel.value;
                      db.save("students", st);
                    }
                  });
                  toast("Tahfiz class updated for " + ids.length + " students", "success");
                  m2.close();
                  refreshStudentData();
                  renderTable();
                  localSel.clear();
                }})
              ]
            });
        }},
        { label: "❌ Remove Islamiyya", action: (ids) => {
            ids.forEach(id => {
              const st = db.get("students", id);
              if (st) {
                const islProgIds = cfg.programs().filter(p => cfg.section(p.sectionId)?.type === "islamiyya" || p.id === "islamiyya" || p.sectionId === "islamiyya").map(p => p.id);
                islProgIds.push("islamiyya");
                st.programIds = (st.programIds || []).filter(pid => !islProgIds.includes(pid));
                st.programs = (st.programs || []).filter(pid => !islProgIds.includes(pid));
                st.programNames = (st.programNames || []).filter(pn => !pn.toLowerCase().includes("islamiyya"));
                st.islamiyyaClassId = "";
                db.save("students", st);
              }
            });
            toast("Removed " + ids.length + " students from Islamiyya", "success");
            refreshStudentData();
            renderTable();
            localSel.clear();
        }},
        { label: "❌ Remove Tahfiz", action: (ids) => {
            ids.forEach(id => {
              const st = db.get("students", id);
              if (st) {
                const tahProgIds = cfg.programs().filter(p => cfg.section(p.sectionId)?.type === "tahfiz" || p.id === "tahfiz" || p.sectionId === "tahfiz").map(p => p.id);
                tahProgIds.push("tahfiz");
                st.programIds = (st.programIds || []).filter(pid => !tahProgIds.includes(pid));
                st.programs = (st.programs || []).filter(pid => !tahProgIds.includes(pid));
                st.programNames = (st.programNames || []).filter(pn => !pn.toLowerCase().includes("tahfiz"));
                st.tahfizClassId = "";
                db.save("students", st);
              }
            });
            toast("Removed " + ids.length + " students from Tahfiz", "success");
            refreshStudentData();
            renderTable();
            localSel.clear();
        }}
      ]),
      el("div", { id: "islTahTableWrap", style: "margin-top:14px;" })
    ])
  });
  
  function renderTable() {
    const wrap = m.body.querySelector("#islTahTableWrap");
    wrap.innerHTML = "";
    const tbl = table([
      { label: "", type: "checkbox" },
      { label: "Admission No", key: "admissionNo" },
      { label: "Name", key: "fullName" },
      { label: "Main Class", render: s => cfg.className(s.classId) },
      { label: "Islamiyya Class", render: s => s._hasIsl ? (s.islamiyyaClassId ? cfg.className(s.islamiyyaClassId) : el("span", { class: "muted", text: "Not Assigned" })) : "N/A" },
      { label: "Tahfiz Class", render: s => s._hasTah ? (s.tahfizClassId ? cfg.className(s.tahfizClassId) : el("span", { class: "muted", text: "Not Assigned" })) : "N/A" }
    ], students, { selection: localSel });
    wrap.appendChild(tbl);
  }
  
  renderTable();
}
`;
    fs.writeFileSync('js/modules/students.js', code.substring(0, idx) + replacement);
    console.log("Success");
} else {
    console.log("Target not found");
}
