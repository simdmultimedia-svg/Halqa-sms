import { db } from "../core/db.js";
import { lazyListen } from "../core/adapter.js";
import { el, toast, modal, num } from "../core/utils.js";
import { card, pageHead, table, btn, select, studentPicker, field } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { reportCardDoc } from "../core/documents.js";
import { printHtml, downloadPdf, PRINT_CSS } from "../core/print.js";

export function render(root, ctx) {
  lazyListen("reportCards");
  root.appendChild(pageHead("Report Cards", "Generate branded report cards. The template switches automatically by section (Western / Islamiyya / Tahfiz)."));
  const c = card("Find Student", null, { style: "margin-bottom: 20px" });
  let sel = {};
  const picker = studentPicker((s) => { sel = s; if (s.studentId) load(s.studentId); else host.innerHTML = ""; });
  c.appendChild(picker.wrap);
  root.appendChild(c);
  const host = el("div");
  root.appendChild(host);

  // Batch Export UI
  const batchCard = card("Batch Print by Class (High Quality JPG)");
  
  const sessions = cfg.sessions();
  const terms = sessions.terms || ["First Term", "Second Term", "Third Term"];
  const sessionOptions = Array.from(new Set([cfg.currentSession(), ...(sessions.list || [])])).filter(Boolean);
  
  const state = {
    session: cfg.currentSession(),
    term: cfg.currentTerm(),
    sectionId: "",
    classId: ""
  };

  const sessionSel = select(() => sessionOptions.map((s) => ({ value: s, label: s, selected: s === state.session })));
  const termSel = select(() => terms.map((t) => ({ value: t, label: t, selected: t === state.term })));
  const sectionSel = select(() => [{ value: "", label: "Select Section..." }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))]);
  const classSel = select(() => [{ value: "", label: "Select Class..." }]);

  function fillClasses() {
    classSel.innerHTML = "";
    classSel.appendChild(el("option", { value: "", text: "Select Class..." }));
    if (state.sectionId) {
      cfg.classes(state.sectionId).forEach((c) => classSel.appendChild(el("option", { value: c.id, text: c.name })));
    }
  }

  [sessionSel, termSel].forEach(node => {
    node.onchange = () => {
      state.session = sessionSel.value;
      state.term = termSel.value;
    };
  });
  
  sectionSel.onchange = () => { state.sectionId = sectionSel.value; fillClasses(); };
  classSel.onchange = () => { state.classId = classSel.value; };

  const btnExport = btn("Export All to JPG", { variant: "primary", onclick: batchExport });
  const btnPrint = btn("Print All Report Cards", { variant: "success", onclick: batchPrint });
  
  batchCard.appendChild(el("div", { class: "form-grid" }, [
    field("Session", sessionSel),
    field("Term", termSel),
    field("Section", sectionSel),
    field("Class", classSel)
  ]));
  batchCard.appendChild(el("div", { style: "margin-top:15px; display:flex; gap:10px;" }, [btnPrint, btnExport]));
  root.appendChild(batchCard);

  async function loadHtml2Canvas() {
    if (!window.html2canvas) {
      await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "/vendor/html2canvas.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
      });
    }
  }

  async function batchPrint() {
    if (!state.session || !state.term || !state.sectionId || !state.classId) {
      return toast("Please select Session, Term, Section, and Class.", "error");
    }

    const students = db.list("students").filter(s => s.classId === state.classId && !["graduated", "withdrawn"].includes(String(s.status || "").toLowerCase()));
    if (!students.length) return toast("No active students found in this class.", "error");

    students.sort((a,b) => (a.fullName || "").localeCompare(b.fullName || ""));

    let combinedHtml = "";
    let count = 0;

    for (const student of students) {
      const results = db.query("results", (r) => r.studentId === student.id && r.session === state.session && r.term === state.term);
      if (results.length === 0) continue; 
      
      const html = reportCardDoc(student, results[0]);
      // Each report card wraps in a page-breaking div
      combinedHtml += `<div style="page-break-after: always; break-after: page; position: relative; width: 100%;">${html}</div>`;
      count++;
    }

    if (count > 0) {
      // By wrapping them in a div, the first `.a4-one-page` will be found and scaled correctly for all pages.
      printHtml(combinedHtml, { title: `Bulk Report Cards - ${cfg.className(state.classId)}` });
      toast(`Sent ${count} report cards to printer!`, "success");
    } else {
      toast("No results found for any active students in this class.", "error");
    }
  }

  async function batchExport() {
    if (!state.session || !state.term || !state.sectionId || !state.classId) {
      return toast("Please select Session, Term, Section, and Class.", "error");
    }

    const students = db.list("students").filter(s => s.classId === state.classId && !["graduated", "withdrawn"].includes(String(s.status || "").toLowerCase()));
    if (!students.length) return toast("No active students found in this class.", "error");

    toast(`Preparing to export ${students.length} report cards. Please wait...`, "info");
    
    await loadHtml2Canvas();

    const exportContainer = el("div", { id: "report-export-target", style: "position:absolute; top:-9999px; left:-9999px; width:210mm; background:white;" });
    document.body.appendChild(exportContainer);

    let count = 0;
    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      const results = db.query("results", (r) => r.studentId === student.id && r.session === state.session && r.term === state.term);
      if (results.length === 0) continue; 
      
      const r = results[0];
      const html = reportCardDoc(student, r);
      
      exportContainer.innerHTML = `<style>${PRINT_CSS}</style><div class="doc" style="font-family:'Times New Roman', Times, serif; color:#000;">${html}</div>`;
      
      await document.fonts.ready;
      
      const canvas = await window.html2canvas(exportContainer, { 
          scale: 4, 
          useCORS: true, 
          logging: false,
          scrollY: 0,
          windowWidth: exportContainer.scrollWidth,
          windowHeight: exportContainer.scrollHeight
      });
      
      const imgData = canvas.toDataURL("image/jpeg", 1.0);
      const link = document.createElement("a");
      const safeName = student.fullName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      link.download = `ReportCard_${student.admissionNo.split('/').join('_')}_${safeName}.jpg`;
      link.href = imgData;
      link.click();
      
      count++;
      toast(`Exported ${count} of ${students.length}...`, "info");
      
      // Delay to allow browser to breathe and download
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    document.body.removeChild(exportContainer);
    if (count > 0) {
      toast(`Successfully exported ${count} report cards!`, "success");
    } else {
      toast("No results found for any students in this class.", "error");
    }
  }

  function load(studentId) {
    const student = db.get("students", studentId);
    const results = db.query("results", (r) => r.studentId === studentId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    host.innerHTML = "";
    host.appendChild(card(`${student.fullName} \u2014 ${cfg.className(student.classId)}`, [table([
      { label: "Session", key: "session" }, { label: "Term", key: "term" },
      { label: "Average", render: (r) => r.average != null ? num(r.average).toFixed(2) : (r.tahfiz ? "\u2014" : "0.00") },
      { label: "Position", render: (r) => r.position || "\u2014" },
      { label: "", render: (r) => el("div", { class: "row" }, [
        btn("Preview", { sm: true, onclick: () => preview(student, r) }),
        btn("Print", { sm: true, variant: "primary", onclick: () => printHtml(reportCardDoc(student, r), { title: "Report " + student.admissionNo }) })
      ]) }
    ], results, { empty: "No results recorded for this student. Enter results first." })]));
  }

  function preview(student, r) {
    const html = reportCardDoc(student, r);
    const prev = el("div", { class: "doc-preview" });
    prev.innerHTML = `<div style="font-family:Arial">${html}</div>`;
    modal({ title: "Report Card", size: "lg", body: prev, footer: [
      btn("Print", { onclick: () => printHtml(html, { title: "Report " + student.admissionNo }) }),
      btn("Download PDF", { variant: "primary", onclick: () => downloadPdf(html, { title: "Report Card", filename: `Report_${student.admissionNo}.pdf` }) })
    ] });
  }
}
