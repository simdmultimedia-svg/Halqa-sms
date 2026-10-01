import { db } from "../core/db.js";
import { el, toast, modal, uuid, fmtDate, num } from "../core/utils.js";
import { card, pageHead, table, btn, input, select, field, textarea, readFileAsDataURL } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { getBranding, headerHtml } from "../core/branding.js";
import { printHtml } from "../core/print.js";
import { captureFingerprint, identifyFingerprint } from "../core/fingerprint.js";
import { generateMathQuestions, isMathSubject, mathTopics, mathDifficulties, mathFormulas } from "../core/mathgenerator.js";
import { normaliseRole } from "../core/rbac.js";

const mathPrintCss = `
  .math-frac{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;line-height:1}
  .math-frac span:first-child{border-bottom:1px solid currentColor;padding:0 3px}
  .math-frac span:last-child{padding:0 3px}
  sup{font-size:75%;vertical-align:super}
`;

function richEditor(placeholder = "") {
    const wrap = el("div", { style: "border:1px solid var(--border); border-radius:4px" });
    const tb = el("div", { style: "background:#f5f5f5; padding:4px; border-bottom:1px solid var(--border); display:flex; gap:4px" });
    const b = btn("B", { sm:true, style: "font-weight:bold", onclick:()=>document.execCommand('bold')});
    const i = btn("I", { sm:true, style: "font-style:italic", onclick:()=>document.execCommand('italic')});
    const u = btn("U", { sm:true, style: "text-decoration:underline", onclick:()=>document.execCommand('underline')});
    const imgInp = input({ type: "file", accept:"image/*", style:"display:none" });
    const imgBtn = btn("Img", { sm:true, onclick:()=>imgInp.click() });
    
    const editor = el("div", { contenteditable: "true", style: "padding:8px; min-height:80px; outline:none; background:#fff" });
    editor.setAttribute("placeholder", placeholder);
    
    imgInp.onchange = async () => {
        if(imgInp.files[0]) {
            const dataUrl = await readFileAsDataURL(imgInp.files[0]);
            const img = document.createElement("img");
            img.src = dataUrl;
            img.style.maxWidth = "100%";
            editor.appendChild(img);
        }
    };
    
    tb.appendChild(b); tb.appendChild(i); tb.appendChild(u); tb.appendChild(imgBtn); tb.appendChild(imgInp);
    wrap.appendChild(tb); wrap.appendChild(editor);
    return { wrap, editor, val: () => editor.innerHTML, set: (html) => editor.innerHTML = html || "" };
}

export function render(root, ctx) {
  root.innerHTML = "";
  const role = normaliseRole(ctx?.user?.role || "");
  if (role === "Student" || ctx?.param) {
    root.appendChild(pageHead("My CBT", "Take published examinations assigned to your class."));
    const host = el("div");
    root.appendChild(host);
    drawStudentCbt(host, ctx);
    return;
  }

  root.appendChild(pageHead("Examinations / CBT", "Manage CBT, Question Banks, and generate PDF Exam Papers."));
  
  const canSetup = ["Super Admin", "Admin", "Exam Officer"].includes(role);
  const canViewCbt = canSetup || role === "Principal";
  const canCreateQuestions = canSetup || role === "Teacher";
  const tabBtns = [];
  if (canViewCbt) tabBtns.push(btn("CBT Tests", { variant: "primary", onclick: () => drawCbt() }));
  if (canCreateQuestions) {
    tabBtns.push(btn("Question Bank", { variant: canViewCbt ? "secondary" : "primary", onclick: () => drawQBank() }));
    tabBtns.push(btn("Mathematics Bank", { variant: "secondary", onclick: () => drawMathBank() }));
    tabBtns.push(btn("🤖 AI Editor", { variant: "secondary", onclick: () => drawAIEditor() }));
  }
  if (canViewCbt) tabBtns.push(btn("Generate Papers", { variant: "secondary", onclick: () => drawPapers() }));
  if (canViewCbt) tabBtns.push(btn("Exam Attendance", { variant: "secondary", onclick: () => drawAttendance() }));
  const tabs = el("div", { class: "row", style: "margin-bottom:16px; gap:8px" }, tabBtns);
  root.appendChild(tabs);
  
  const host = el("div");
  root.appendChild(host);

  function drawCbt() {
    const draw = () => {
      const rows = db.list("cbt").sort((a, b) => b.createdAt - a.createdAt);
      const attempts = db.list("cbtAttempts");
      host.innerHTML = "";
      host.appendChild(cbtDashboard(rows, attempts));
      host.appendChild(card("CBT Setup", [
        ...(canSetup ? [btn("New Exam", { variant: "primary", icon: "+", style:"margin-bottom:12px", onclick: () => setup(ctx, null, draw) })] : []),
        table([
        { label: "Title", key: "title" }, { label: "Section", render: (e) => cfg.sectionName(e.sectionId) },
        { label: "Class", render: (e) => cfg.className(e.classId) }, { label: "Subject", key: "subject" },
        { label: "Available", render: (e) => availableQuestions(e).length },
        { label: "To Take", render: (e) => num(e.questionsToTake) || (e.questions || []).length },
        { label: "Status", render: (e) => e.status || "Draft" },
        { label: "Term", key: "term" },
        { label: "", render: (e) => el("div", { class: "row" }, [
          ...(canSetup ? [
            btn("Edit", { sm: true, onclick: () => setup(ctx, e, draw) }),
            btn("Questions", { sm: true, onclick: () => questions(e.id, draw) }),
            btn("Preview", { sm: true, onclick: () => previewSelectedQuestions(e) }),
            btn("Printable Copy", { sm: true, onclick: () => printableCbtCopy(e) })
          ] : [btn("Preview", { sm: true, onclick: () => previewSelectedQuestions(e) })])
        ]) }
      ], rows, { empty: "No exams set up yet" })]));
    };
    draw();
  }

  function drawAttendance() {
    host.innerHTML = "";
    
    // Select Exam
    const rows = db.list("cbt").sort((a, b) => b.createdAt - a.createdAt);
    const examSelect = select(() => [{value: "", label: "Select Examination"}].concat(rows.map(r => ({value: r.id, label: `${r.title} - ${cfg.className(r.classId)}`}))));
    
    const wrapper = el("div");

    examSelect.onchange = () => {
        wrapper.innerHTML = "";
        const examId = examSelect.value;
        if (!examId) return;

        const exam = db.get("cbt", examId);
        if (!exam) return;

        const students = db.list("students").filter(s => s.classId === exam.classId);
        const attendance = db.list("exam_attendance").filter(a => a.examId === examId);

        const tableContainer = el("div", { style: "margin-top: 20px;" });
        
        const renderTable = () => {
            const attMap = {};
            attendance.forEach(a => attMap[a.studentId] = a);

            tableContainer.innerHTML = "";
            tableContainer.appendChild(table([
                { label: "Adm No", key: "admissionNo" },
                { label: "Name", key: "fullName" },
                { label: "Status", render: s => el("span", {
                    class: `badge ${attMap[s.id] ? "badge-success" : "badge-muted"}`,
                    text: attMap[s.id] ? "Present" : "Pending"
                })},
                { label: "Time", render: s => attMap[s.id] ? fmtDate(attMap[s.id].timestamp) + " " + new Date(attMap[s.id].timestamp).toLocaleTimeString() : "-" }
            ], students, { empty: "No students in this class." }));
        };

        const scanBtn = btn("Scan Student \uD83D\uDD90\uFE0F", { variant: "primary", style: "margin-top: 10px;", onclick: async () => {
            scanBtn.textContent = "Scanning...";
            scanBtn.disabled = true;

            const cap = await captureFingerprint();
            if (!cap.success) {
                toast(cap.error, "error");
                scanBtn.textContent = "Scan Student \uD83D\uDD90\uFE0F";
                scanBtn.disabled = false;
                return;
            }

            const allPrints = db.list("fingerprints").filter(f => f.role === "student");
            const match = await identifyFingerprint(cap.template, allPrints.map(f => f.template));
            
            scanBtn.textContent = "Scan Student \uD83D\uDD90\uFE0F";
            scanBtn.disabled = false;

            if (!match.success) {
                return toast("Unrecognized Fingerprint.", "error");
            }

            const print = allPrints[match.matchIndex];
            const student = students.find(s => s.id === print.ownerId);

            if (!student) {
                return toast("Fingerprint matches a student not in this class.", "error");
            }

            if (attendance.find(a => a.studentId === student.id)) {
                return toast(`${student.fullName} is already marked present.`, "warning");
            }

            const attRecord = {
                id: uuid(),
                examId: examId,
                studentId: student.id,
                timestamp: Date.now()
            };

            db.save("exam_attendance", attRecord);
            attendance.push(attRecord);
            toast(`${student.fullName} marked present!`, "success");
            renderTable();
        }});

        wrapper.appendChild(scanBtn);
        wrapper.appendChild(tableContainer);
        renderTable();
    };

    host.appendChild(card("Examination Biometric Attendance", [
        field("Select Examination", examSelect),
        wrapper
    ]));
  }


  function bulkImportExamQuestionsModal(exam, after) {
    const textInp = el("textarea", { rows: 15, style: "width:100%; resize:vertical; font-family:monospace;", placeholder: "Paste your questions here...\n\nExample:\n1. What is the capital of Kano?\nA) Abuja\nB) Lagos\nC) Kano\nD) Kaduna\nAnswer: C\n\n2. Explain the water cycle.\nType: Theory\n\n3. The primary organ of the circulatory system is the _____.\nAnswer: Heart\nType: Fill in the blank" });
    
    const body = el("div", { class: "form-grid" }, [
      field("Paste Questions (Raw Text)", textInp, { full: true })
    ]);
    
    const m = modal({ title: "Bulk Import to: " + exam.title, size: "lg", body, footer: [btn("Parse & Save", { variant: "success", onclick: () => {
      if(!textInp.value) return toast("Paste text first", "error");
      
      const raw = textInp.value;
      const blocks = raw.split(/\n\s*\n/).filter(b => b.trim());
      let savedCount = 0;
      
      exam.questions = exam.questions || [];
      blocks.forEach(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(l => l);
        if (!lines.length) return;
        
        let qText = lines[0].replace(/^\d+\.\s*/, '');
        let options = [];
        let answer = -1;
        let type = "Objective";
        let diff = "Medium";
        
        for(let i=1; i<lines.length; i++) {
          const l = lines[i];
          if (l.match(/^[A-D][\)\.]\s/i)) {
            options.push(l.substring(3).trim());
          } else if (l.toLowerCase().startsWith("answer:")) {
            const ansStr = l.substring(7).trim().toUpperCase();
            answer = ansStr.charCodeAt(0) - 65;
          } else if (l.toLowerCase().startsWith("type:")) {
            type = l.substring(5).trim();
            if (type.toLowerCase() === "fill in the blank") type = "Fill in the blank";
          } else if (l.toLowerCase().startsWith("difficulty:")) {
            diff = l.substring(11).trim();
          }
        }
        
        if (type.toLowerCase() !== "objective" && type !== "Fill in the blank") {
          options = [];
          answer = -1;
        }
        
        const q = {
          id: uuid(), text: qText,
          type: type, difficulty: diff,
          options: options.length ? options : null,
          answer: answer >= 0 ? answer : null
        };
        exam.questions.push(q);
        savedCount++;
      });
      
      db.save("cbt", exam);
      toast(`${savedCount} questions imported`, "success");
      m.close();
      if(after) after();
    } })] });
  }

  function importQuestionsModal() {
    const secSel = select(() => [{ value: "", label: "Section" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))]);
    const clsSel = select(() => [{ value: "", label: "Class" }]);
    const subSel = select(() => [{ value: "", label: "Subject" }]);
    secSel.onchange = () => {
      clsSel.innerHTML = '<option value="">Class</option>'; cfg.classes(secSel.value).forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name })));
      subSel.innerHTML = '<option value="">Subject</option>'; cfg.subjects(secSel.value).forEach((s) => subSel.appendChild(el("option", { value: s.name, text: s.name })));
    };
    secSel.onchange();
    
    const textInp = el("textarea", { rows: 15, style: "width:100%; resize:vertical; font-family:monospace;", placeholder: "Paste your questions here...\n\nExample:\n1. What is the capital of Kano?\nA) Abuja\nB) Lagos\nC) Kano\nD) Kaduna\nAnswer: C\n\n2. Explain the water cycle.\nType: Theory\n\n3. The primary organ of the circulatory system is the _____.\nAnswer: Heart\nType: Fill in the blank" });
    
    const body = el("div", { class: "form-grid" }, [
      field("Section", secSel), field("Class", clsSel), field("Subject", subSel),
      field("Paste Questions (Raw Text)", textInp, { full: true })
    ]);
    
    const m = modal({ title: "Import Questions", size: "lg", body, footer: [btn("Parse & Save", { variant: "success", onclick: () => {
      if(!subSel.value || !clsSel.value || !textInp.value) return toast("Fill subject, class, and paste text", "error");
      
      const raw = textInp.value;
      const blocks = raw.split(/\n\s*\n/).filter(b => b.trim());
      let savedCount = 0;
      
      blocks.forEach(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(l => l);
        if (!lines.length) return;
        
        let qText = lines[0].replace(/^\d+[\.\)]\s*/, '');
        let type = "Objective";
        let answerText = "";
        let answerIdx = null;
        const options = [];
        let isFib = false;
        
        lines.slice(1).forEach(l => {
          const lLow = l.toLowerCase();
          if (lLow.startsWith("type:")) {
            const t = l.substring(5).trim();
            if (t.toLowerCase().includes("theory")) type = "Theory";
            else if (t.toLowerCase().includes("essay")) type = "Essay";
            else if (t.toLowerCase().includes("practical")) type = "Practical";
            else if (t.toLowerCase().includes("fill")) { type = "Fill in the blank"; isFib = true; }
          } else if (lLow.startsWith("answer:") || lLow.startsWith("ans:")) {
            answerText = l.substring(l.indexOf(':') + 1).trim();
          } else if (/^[a-d][\.\)]/.test(lLow)) {
            options.push(l.substring(2).trim());
          }
        });
        
        if (options.length === 0 && !isFib && type === "Objective") {
           type = "Theory";
        }
        
        if (type === "Objective" && answerText) {
          const idx = ["A", "B", "C", "D"].indexOf(answerText.toUpperCase());
          if (idx !== -1) answerIdx = idx;
        }
        
        const q = {
          id: uuid(), sectionId: secSel.value, classId: clsSel.value, subject: subSel.value,
          type: type, difficulty: "Medium", topic: "", marks: 1,
          text: qText,
          options: type === "Objective" ? options : [],
          answer: type === "Objective" ? answerIdx : (type === "Fill in the blank" ? answerText : null),
          answerText: answerText,
          isMathematics: isMathSubject(subSel.value),
          createdAt: Date.now()
        };
        db.save("examQuestions", q);
        savedCount++;
      });
      
      toast(`Imported ${savedCount} questions!`, "success");
      m.close();
      drawQBank();
    } })] });
  }

  function drawQBank() {
    const qList = db.list("examQuestions").sort((a,b) => b.createdAt - a.createdAt);
    host.innerHTML = "";
    
    const c = card("Question Bank", [
      btn("Add Question", { variant: "primary", icon: "+", style:"margin-bottom:12px", onclick: () => addQuestionModal() }),
      btn("Import Questions", { variant: "secondary", style:"margin-bottom:12px;margin-left:8px", onclick: () => importQuestionsModal() }),
      btn("Generate Mathematics Questions", { variant: "success", style:"margin-bottom:12px;margin-left:8px", onclick: () => mathGeneratorModal({ mode: "bank", after: drawQBank }) }),
      table([
        { label: "Subject", key: "subject" },
        { label: "Class", render: q => cfg.className(q.classId) },
        { label: "Type", key: "type" },
        { label: "Difficulty", key: "difficulty" },
        { label: "Marks", key: "marks" },
        { label: "Question", render: q => el("div", { html: q.text, style: "max-height:40px; overflow:hidden" }) }
      ], qList, { empty: "No questions in the bank." })
    ]);
    host.appendChild(c);
  }

  function drawMathBank() {
    const qList = db.list("examQuestions")
      .filter((q) => q.isMathematics || isMathSubject(q.subject))
      .sort((a,b) => b.createdAt - a.createdAt);
    host.innerHTML = "";
    host.appendChild(card("Mathematics Question Bank", [
      el("div", { class: "row", style: "margin-bottom:12px;gap:8px;flex-wrap:wrap" }, [
        btn("Generate Mathematics Questions", { variant: "primary", icon: "+", onclick: () => mathGeneratorModal({ mode: "bank", after: drawMathBank }) }),
        btn("Add Mathematics Question", { onclick: () => addQuestionModal({ forceMath: true }) })
      ]),
      table([
        { label: "Class", render: q => cfg.className(q.classId) },
        { label: "Topic", key: "topic" },
        { label: "Type", key: "type" },
        { label: "Difficulty", key: "difficulty" },
        { label: "Correct Answer", render: answerLabel },
        { label: "Question", render: q => el("div", { html: q.text, style: "max-height:48px; overflow:hidden" }) }
      ], qList, { empty: "No mathematics questions generated yet." })
    ]));
  }

  function mathGeneratorModal({ mode = "bank", exam = null, after = null } = {}) {
    const secSel = select(() => [{ value: "", label: "Section" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name, selected: exam?.sectionId === s.id }))]);
    const clsSel = select(() => [{ value: "", label: "Class" }]);
    const subSel = select(() => [{ value: "Mathematics", label: "Mathematics" }]);
    const topicSel = select(() => [{ value: "", label: "Topic" }]);
    const diffSel = select(() => mathDifficulties().map((d) => ({ value: d, label: d })));
    const countInp = input({ type: "number", min: 1, max: 100, value: "10" });
    const typeSel = select(() => ["Objective", "Theory"].map((t) => ({ value: t, label: t })));

    function loadClassSubjectTopic() {
      clsSel.innerHTML = '<option value="">Class</option>';
      cfg.classes(secSel.value).forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name, selected: exam?.classId === k.id })));
      subSel.innerHTML = '<option value="Mathematics">Mathematics</option>';
      cfg.subjects(secSel.value).filter((s) => isMathSubject(s.name)).forEach((s) => subSel.appendChild(el("option", { value: s.name, text: s.name })));
      refreshTopics();
    }
    function refreshTopics() {
      topicSel.innerHTML = '<option value="">Topic</option>';
      mathTopics(secSel.value, clsSel.value).forEach((t) => topicSel.appendChild(el("option", { value: t.name, text: t.name })));
    }
    secSel.onchange = loadClassSubjectTopic;
    clsSel.onchange = refreshTopics;
    if (exam) {
      secSel.value = exam.sectionId;
      loadClassSubjectTopic();
      clsSel.value = exam.classId;
      subSel.value = exam.subject || "Mathematics";
      refreshTopics();
    }

    const body = el("div", { class: "form-grid" }, [
      field("Section", secSel), field("Class", clsSel), field("Subject", subSel),
      field("Topic", topicSel), field("Difficulty", diffSel), field("Question Type", typeSel),
      field("Number of Questions", countInp)
    ]);
    const m = modal({ title: "Generate Mathematics Questions", size: "md", body, footer: [btn("Generate", { variant: "success", onclick: () => {
      if (!secSel.value || !clsSel.value || !topicSel.value) return toast("Select section, class and topic", "error");
      const questions = generateMathQuestions({
        sectionId: secSel.value,
        classId: clsSel.value,
        subject: subSel.value || "Mathematics",
        topic: topicSel.value,
        difficulty: diffSel.value,
        count: num(countInp.value),
        type: typeSel.value
      });
      if (mode === "exam" && exam) {
        exam.questions = [...(exam.questions || []), ...questions];
        db.save("cbt", exam);
      } else {
        questions.forEach((q) => db.save("examQuestions", q));
      }
      toast(`${questions.length} mathematics question(s) generated`, "success");
      m.close();
      if (after) after();
    } })] });
  }

  function answerLabel(q) {
    if ((q.type === "Objective" || (q.options || []).length) && (q.options || []).length) {
      const idx = num(q.answer);
      return `${["A", "B", "C", "D"][idx] || ""}${q.options?.[idx] ? " - " + stripHtml(q.options[idx]) : ""}`;
    }
    return q.answerText || q.solution || "Theory";
  }

  function stripHtml(html = "") {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }

  function availableQuestions(exam) {
    if (!exam) return [];
    const bank = db.query("examQuestions", (q) =>
      (!exam.sectionId || q.sectionId === exam.sectionId) &&
      (!exam.classId || q.classId === exam.classId) &&
      (!exam.subject || q.subject === exam.subject)
    );
    const manual = exam.questions || [];
    const seen = new Set();
    return [...manual, ...bank].filter((q) => {
      if (!q?.id || seen.has(q.id)) return false;
      seen.add(q.id);
      return true;
    });
  }

  function selectQuestionsForExam(exam, { random = true } = {}) {
    const all = availableQuestions(exam);
    const target = Math.min(num(exam.questionsToTake) || all.length, all.length);
    if (!target) return [];
    const topicDist = exam.topicDistribution || {};
    const difficultyDist = exam.difficultyDistribution || {};
    const hasDifficultyRules = Object.values(difficultyDist).some((v) => num(v) > 0);
    let selected = [];
    const used = new Set();
    const pickFrom = (pool, count) => {
      const ordered = random ? shuffle(pool) : pool.slice();
      const out = [];
      for (const q of ordered) {
        if (out.length >= count) break;
        if (used.has(q.id)) continue;
        used.add(q.id); out.push(q);
      }
      return out;
    };
    const pickByDifficulty = (pool, count) => {
      if (!hasDifficultyRules) return pickFrom(pool, count);
      const quotas = difficultyQuotas(count, difficultyDist);
      let out = [];
      Object.entries(quotas).forEach(([difficulty, qCount]) => {
        out.push(...pickFrom(pool.filter((q) => String(q.difficulty || "").toLowerCase() === difficulty.toLowerCase()), qCount));
      });
      if (out.length < count) out.push(...pickFrom(pool, count - out.length));
      return out;
    };

    Object.entries(topicDist).filter(([, count]) => num(count) > 0).forEach(([topic, count]) => {
      const pool = all.filter((q) => String(q.topic || "").toLowerCase() === topic.toLowerCase());
      selected.push(...pickByDifficulty(pool, Math.min(num(count), target - selected.length)));
    });

    const remainingAfterTopics = target - selected.length;
    if (remainingAfterTopics > 0 && hasDifficultyRules) {
      const quotas = difficultyQuotas(remainingAfterTopics, difficultyDist);
      Object.entries(quotas).forEach(([difficulty, count]) => {
        const pool = all.filter((q) => String(q.difficulty || "").toLowerCase() === difficulty.toLowerCase());
        selected.push(...pickFrom(pool, Math.min(count, target - selected.length)));
      });
    }

    if (selected.length < target) selected.push(...pickFrom(all, target - selected.length));
    return (random ? shuffle(selected) : selected).slice(0, target);
  }

  function difficultyQuotas(total, dist) {
    const entries = Object.entries(dist).map(([k, v]) => [k, num(v)]).filter(([, v]) => v > 0);
    const sum = entries.reduce((a, [, v]) => a + v, 0) || 100;
    const quotas = {};
    let used = 0;
    entries.forEach(([k, v], i) => {
      const q = i === entries.length - 1 ? total - used : Math.round((v / sum) * total);
      quotas[k] = Math.max(0, q);
      used += quotas[k];
    });
    return quotas;
  }

  function parseDistribution(text = "") {
    const out = {};
    String(text || "").split(/\r?\n|,/).forEach((line) => {
      const m = line.match(/^\s*(.+?)\s*(?:=|:|-)\s*(\d+)\s*$/);
      if (m) out[m[1].trim()] = num(m[2]);
    });
    return out;
  }

  function distributionToText(dist = {}) {
    return Object.entries(dist || {}).map(([k, v]) => `${k} = ${v}`).join("\n");
  }

  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function cbtDashboard(exams, attempts) {
    const totalQuestions = exams.reduce((a, e) => a + availableQuestions(e).length, 0);
    const totalToTake = exams.reduce((a, e) => a + (num(e.questionsToTake) || (e.questions || []).length), 0);
    const registered = new Set();
    exams.forEach((exam) => db.list("students").filter((s) => isExamAssignedToStudent({ ...exam, status: "Published" }, s)).forEach((s) => registered.add(exam.id + ":" + s.id)));
    const completed = attempts.length;
    const scores = attempts.map((a) => num(a.percentage)).filter((n) => Number.isFinite(n));
    const avg = scores.length ? Math.round(scores.reduce((a, v) => a + v, 0) / scores.length) : 0;
    const high = scores.length ? Math.max(...scores) : 0;
    const low = scores.length ? Math.min(...scores) : 0;
    return el("div", { class: "grid grid-4", style: "margin-bottom:14px" }, [
      statMini("Total Questions", totalQuestions),
      statMini("Questions To Take", totalToTake),
      statMini("Students Registered", registered.size),
      statMini("Students Completed", completed),
      statMini("Average Score", `${avg}%`),
      statMini("Highest Score", `${high}%`),
      statMini("Lowest Score", `${low}%`)
    ]);
  }

  function statMini(label, value) {
    return el("div", { class: "card stat" }, [
      el("div", { class: "v", text: String(value) }),
      el("div", { class: "l", text: label })
    ]);
  }

  function previewSelectedQuestions(exam) {
    const qs = selectQuestionsForExam(exam, { random: false });
    const body = el("div");
    body.appendChild(el("p", { class: "muted", text: `${qs.length} question(s) selected from ${availableQuestions(exam).length} available.` }));
    body.appendChild(table([
      { label: "#", key: "sn" },
      { label: "Topic", key: "topic" },
      { label: "Difficulty", key: "difficulty" },
      { label: "Question", render: (q) => el("div", { html: q.text, style: "max-height:48px;overflow:hidden" }) }
    ], qs.map((q, i) => ({ ...q, sn: i + 1 })), { empty: "No questions match this setup." }));
    modal({ title: "Preview Selected Questions", size: "lg", body });
  }

  function printableCbtCopy(exam) {
    const qs = selectQuestionsForExam(exam, { random: false });
    const letters = ["A", "B", "C", "D"];
    const qHtml = qs.map((q, i) => `
      <div style="margin-bottom:18px;page-break-inside:avoid">
        <b>${i + 1}.</b> ${q.text}
        ${q.type === "Objective" && (q.options || []).length ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">${q.options.map((o, idx) => `<div><b>${letters[idx]}.</b> ${o}</div>`).join("")}</div>` : (q.type === "Fill in the blank" ? `<div style="height:30px;border-bottom:1px solid #333;margin-top:8px;width:300px"></div>` : `<div style="height:70px;border-bottom:1px dotted #999;margin-top:8px"></div>`)}
      </div>`).join("");
    const ansRows = qs.map((q, i) => `<tr><td>${i + 1}</td><td>${answerLabel(q)}</td></tr>`).join("");
    const sheetRows = qs.map((_, i) => `<tr><td>${i + 1}</td><td>A B C D</td><td style="height:24px"></td></tr>`).join("");
    printHtml(`<style>${mathPrintCss}.page{page-break-before:always;break-before:page} .doc-header .doc-logo { max-width: 60px !important; max-height: 60px !important; width: auto !important; height: auto !important; }</style><section class="cbt-print-doc">
      ${headerHtml()}<h2>${exam.title}</h2><p><b>Subject:</b> ${exam.subject} &nbsp; <b>Class:</b> ${cfg.className(exam.classId)} &nbsp; <b>Duration:</b> ${exam.duration || ""} mins</p>
      ${qHtml}
      <div class="page"><h2>Answer Sheet</h2><table class="doc-table"><tr><th>Q</th><th>Objective Choice</th><th>Theory Answer / Workings</th></tr>${sheetRows}</table></div>
      <div class="page"><h2>Marking Scheme</h2><table class="doc-table"><tr><th>Q</th><th>Answer</th></tr>${ansRows}</table></div>
      </section>`, { title: exam.title });
  }

  function drawStudentCbt(host, ctx) {
    const student = db.get("students", ctx.param || ctx.user.studentId);
    if (!student) {
      host.appendChild(card("Access", [el("p", { class: "muted", text: "No student record is linked to this account." })]));
      return;
    }
    const rows = db.list("cbt").filter((exam) => isExamAssignedToStudent(exam, student));
    host.innerHTML = "";
    host.appendChild(card("Assigned CBT Exams", [table([
      { label: "Exam", key: "title" },
      { label: "Subject", key: "subject" },
      { label: "Date", render: (e) => e.examDate || "" },
      { label: "Duration", render: (e) => `${e.duration || 0} mins` },
      { label: "Questions", render: (e) => num(e.questionsToTake) || availableQuestions(e).length },
      { label: "", render: (e) => btn("Take CBT", { sm: true, variant: "primary", onclick: () => takeCbt(e.id, { ...ctx, param: student.id }) }) }
    ], rows, { empty: "No published CBT exams are assigned to your class." })]));
  }

  function isExamAssignedToStudent(exam, student) {
    if ((exam.status || "Draft") !== "Published") return false;
    if (exam.sectionId && exam.sectionId !== student.sectionId) return false;
    if (exam.classId && exam.classId !== student.classId) return false;
    const programs = cfg.studentProgramIds(student);
    if (exam.programIds?.length && !exam.programIds.some((id) => programs.includes(id))) return false;
    return true;
  }

  function addQuestionModal({ forceMath = false } = {}) {
    const secSel = select(() => [{ value: "", label: "Section" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))]);
    const clsSel = select(() => [{ value: "", label: "Class" }]);
    const subSel = select(() => [{ value: "", label: "Subject" }]);
    secSel.onchange = () => {
      clsSel.innerHTML = '<option value="">Class</option>';
      subSel.innerHTML = '<option value="">Subject</option>';
      if (secSel.value) {
        cfg.classes(secSel.value).forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name })));
        cfg.subjects(secSel.value).forEach((s) => subSel.appendChild(el("option", { value: s.name, text: s.name })));
        if (forceMath) {
          const math = cfg.subjects(secSel.value).find((s) => isMathSubject(s.name));
          if (math) subSel.value = math.name;
        }
      }
    };
    secSel.onchange();
    
    const typeSel = select(() => ["Objective", "Theory", "Essay", "Practical", "Fill in the blank"].map(t => ({ value: t, label: t })));
    const diffSel = select(() => ["Easy", "Medium", "Hard"].map(t => ({ value: t, label: t })));
    const topicInp = input({ placeholder: "Topic" });
    const marksInp = input({ type: "number", value: "1" });
    
    const qEditor = richEditor("Type question here...");
    const formulaSel = select(() => [{ value: "", label: "Insert formula..." }, ...mathFormulas().map((f) => ({ value: f.formula, label: `${f.name} - ${f.formula}` }))]);
    const insertFormula = btn("Insert Formula", { sm: true, onclick: () => {
      if (!formulaSel.value) return;
      qEditor.editor.innerHTML += ` <b>${formulaSel.value}</b> `;
    } });
    
    const objDiv = el("div", { style: "margin-top:12px" });
    const optA = richEditor("Option A"); const optB = richEditor("Option B"); 
    const optC = richEditor("Option C"); const optD = richEditor("Option D");
    const ansSel = select(() => [{value:0, label:"A"}, {value:1, label:"B"}, {value:2, label:"C"}, {value:3, label:"D"}]);
    
    objDiv.appendChild(field("Option A", optA.wrap)); objDiv.appendChild(field("Option B", optB.wrap));
    objDiv.appendChild(field("Option C", optC.wrap)); objDiv.appendChild(field("Option D", optD.wrap));
    objDiv.appendChild(field("Correct Answer", ansSel));

    const fibDiv = el("div", { style: "margin-top:12px; display:none" });
    const fibAns = input({ placeholder: "Exact correct answer text" });
    fibDiv.appendChild(field("Correct Answer", fibAns));
    
    typeSel.onchange = () => { 
      objDiv.style.display = typeSel.value === "Objective" ? "block" : "none"; 
      fibDiv.style.display = typeSel.value === "Fill in the blank" ? "block" : "none";
    };
    
    const body = el("div", { class: "form-grid" }, [
      field("Section", secSel), field("Class", clsSel), field("Subject", subSel),
      field("Type", typeSel), field("Difficulty", diffSel), field("Topic", topicInp), field("Marks", marksInp),
      el("div", { style:"grid-column:1 / -1" }, [el("div", { class: "row" }, [formulaSel, insertFormula])]),
      field("Question Content", qEditor.wrap, { full:true }),
      el("div", { style:"grid-column: 1 / -1" }, [objDiv, fibDiv])
    ]);
    
    const saveFn = (closeAfter) => {
      if(!subSel.value || !clsSel.value || !qEditor.val()) return toast("Fill subject, class, and question", "error");
      const q = {
        id: uuid(), sectionId: secSel.value, classId: clsSel.value, subject: subSel.value,
        type: typeSel.value, difficulty: diffSel.value, topic: topicInp.value, marks: num(marksInp.value),
        text: qEditor.val(),
        options: typeSel.value === "Objective" ? [optA.val(), optB.val(), optC.val(), optD.val()] : [],
        answer: typeSel.value === "Objective" ? num(ansSel.value) : (typeSel.value === "Fill in the blank" ? fibAns.value : null),
        answerText: typeSel.value === "Objective" ? ["A", "B", "C", "D"][num(ansSel.value)] : (typeSel.value === "Fill in the blank" ? fibAns.value : ""),
        isMathematics: isMathSubject(subSel.value),
        createdAt: Date.now()
      };
      db.save("examQuestions", q);
      toast("Question added", "success");
      drawQBank();
      if(closeAfter) {
        m.close();
      } else {
        qEditor.editor.innerHTML = "";
        if (typeSel.value === "Objective") {
          optA.editor.innerHTML = ""; optB.editor.innerHTML = ""; optC.editor.innerHTML = ""; optD.editor.innerHTML = ""; ansSel.value = 0;
        } else if (typeSel.value === "Fill in the blank") {
          fibAns.value = "";
        }
      }
    };

    const m = modal({ title: "Add to Question Bank", size: "lg", body, footer: [
      btn("Save & Add Another", { variant: "outline", onclick: () => saveFn(false) }),
      btn("Save Question", { variant: "success", onclick: () => saveFn(true) })
    ] });
  }

  function drawPapers() {
    const secSel = select(() => [{ value: "", label: "Section" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))]);
    const clsSel = select(() => [{ value: "", label: "Class" }]);
    const subSel = select(() => [{ value: "", label: "Subject" }]);
    secSel.onchange = () => {
      clsSel.innerHTML = '<option value="">Class</option>'; cfg.classes(secSel.value).forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name })));
      subSel.innerHTML = '<option value="">Subject</option>'; cfg.subjects(secSel.value).forEach((s) => subSel.appendChild(el("option", { value: s.name, text: s.name })));
    };
    
    const countInp = input({ type: "number", value: "20" });
    const timeInp = input({ placeholder: "e.g. 2 Hours" });
    
    host.innerHTML = "";
    host.appendChild(card("Generate Exam Paper", [
      el("div", { class: "form-grid" }, [
        field("Section", secSel), field("Class", clsSel), field("Subject", subSel),
        field("Number of Questions", countInp), field("Duration", timeInp)
      ]),
      el("div", { style: "margin-top:16px" }, [
        btn("Generate Version A", { variant: "primary", onclick: () => generatePDF(clsSel.value, subSel.value, num(countInp.value), timeInp.value, "A") }),
        btn("Generate Version B", { style: "margin-left:8px", onclick: () => generatePDF(clsSel.value, subSel.value, num(countInp.value), timeInp.value, "B") })
      ])
    ]));
  }

  function generatePDF(classId, subject, count, duration, version) {
    if(!classId || !subject) return toast("Select Class and Subject", "error");
    let qs = db.query("examQuestions", q => q.classId === classId && q.subject === subject);
    if(qs.length < count) {
      toast(`Only found ${qs.length} questions for this subject/class.`, "error");
      count = qs.length;
    }
    
    // Shuffle logic (version B gets a different shuffle)
    let shuffled = qs.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor((version === "A" ? Math.random() : (i * 7) % (i + 1))); // pseudo-random for B
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled = shuffled.slice(0, count);
    
    const totalMarks = shuffled.reduce((sum, q) => sum + num(q.marks), 0);
    const b = getBranding();
    
    let qHtml = "";
    let ansHtml = `<h3>Answer Key - Version ${version}</h3><table border="1" cellspacing="0" cellpadding="4"><tr><th>Q</th><th>Ans</th></tr>`;
    
    shuffled.forEach((q, i) => {
      qHtml += `<div style="margin-bottom:20px; page-break-inside:avoid;">`;
      qHtml += `<b>${i+1}.</b> ${q.text} <span style="float:right">(${q.marks} marks)</span>`;
      if(q.type === "Objective" && (q.options || []).length) {
        const letters = ["A", "B", "C", "D"];
        qHtml += `<div style="margin-top:8px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">`;
        (q.options || []).forEach((opt, oi) => {
           qHtml += `<div><b>${letters[oi]}.</b> ${opt}</div>`;
        });
        qHtml += `</div>`;
        ansHtml += `<tr><td>${i+1}</td><td>${letters[q.answer]}</td></tr>`;
      } else {
        qHtml += `<div style="margin-top:8px; border-bottom:1px dotted #ccc; height:60px;"></div>`;
        ansHtml += `<tr><td>${i+1}</td><td>${q.answerText || q.solution || "Theory"}</td></tr>`;
      }
      qHtml += `</div>`;
    });
    ansHtml += "</table>";

    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
      <html>
      <head>
        <title>${subject} - ${cfg.className(classId)} (Version ${version})</title>
        <style>
          ${mathPrintCss}
          body { font-family: Arial, sans-serif; padding: 20px; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
          .meta { display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 20px; }
          .candidate-box { border: 1px solid #000; padding: 10px; margin-bottom: 20px; }
          .candidate-box input { border: none; border-bottom: 1px dotted #000; outline: none; width: 250px; }
          .doc-header .doc-logo { max-width: 60px !important; max-height: 60px !important; width: auto !important; height: auto !important; }
          @media print { .no-print { display: none; } .page-break { page-break-before: always; } }
        </style>
      </head>
      <body>
        <div class="header">
          ${headerHtml()}
          <h2>TERMINAL EXAMINATION</h2>
        </div>
        
        <div class="meta">
          <div>Subject: ${subject}</div>
          <div>Class: ${cfg.className(classId)}</div>
          <div>Term: ${cfg.currentTerm()}</div>
          <div>Version: ${version}</div>
        </div>
        
        <div class="candidate-box">
          Candidate Name: <input type="text"> &nbsp;&nbsp;&nbsp; Admission No: <input type="text">
          <br><br>
          Time Allowed: ${duration} &nbsp;&nbsp;&nbsp; Total Marks: ${totalMarks}
        </div>
        
        <div class="questions">
          ${qHtml}
        </div>
        
        <div class="page-break"></div>
        <div class="no-print" style="color:red; font-weight:bold; margin-bottom:10px;">THIS ANSWER KEY IS NOT PRINTED UNLESS YOU CHOOSE TO.</div>
        ${ansHtml}
        
        <script>
           // printWindow.print();
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  function setup(ctx, existing = null, redraw = drawCbt) {
    const title = input({ placeholder: "e.g. First Term Mathematics Exam", value: existing?.title || "" });
    const secSel = select(() => [{ value: "", label: "Section" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))]);
    const clsSel = select(() => [{ value: "", label: "Class" }]);
    const subSel = select(() => [{ value: "", label: "Subject" }]);
    const sessionInp = input({ value: existing?.session || cfg.currentSession() });
    const termSel = select(() => (cfg.sessions().terms || ["First Term", "Second Term", "Third Term"]).map((t) => ({ value: t, label: t, selected: (existing?.term || cfg.currentTerm()) === t })));
    const examDate = input({ type: "date", value: existing?.examDate || "" });
    const duration = input({ type: "number", min: 1, value: existing?.duration || "30" });
    const passMark = input({ type: "number", min: 0, max: 100, value: existing?.passMark || 50 });
    const statusSel = select(() => ["Draft", "Published"].map((s) => ({ value: s, label: s, selected: (existing?.status || "Draft") === s })));
    const questionsToTake = input({ type: "number", min: 1, value: existing?.questionsToTake || existing?.questions?.length || 50 });
    const randomSelection = input({ type: "checkbox" });
    randomSelection.checked = existing?.randomSelection !== false;
    const topicDist = textarea({ rows: 4, placeholder: "Algebra = 20\nGeometry = 10\nStatistics = 10", style: "width:100%;resize:vertical" });
    topicDist.value = distributionToText(existing?.topicDistribution || {});
    const easyPct = input({ type: "number", min: 0, max: 100, value: existing?.difficultyDistribution?.Easy ?? 40 });
    const mediumPct = input({ type: "number", min: 0, max: 100, value: existing?.difficultyDistribution?.Medium ?? 40 });
    const hardPct = input({ type: "number", min: 0, max: 100, value: existing?.difficultyDistribution?.Hard ?? 20 });
    const available = el("div", { class: "note", text: "Questions Available: 0" });
    const programChecks = [];
    const programBox = el("div", { class: "chip-select" });
    cfg.programs({ activeOnly: true, session: "", term: "" }).forEach((p) => {
      const cb = input({ type: "checkbox" });
      cb.checked = (existing?.programIds || []).includes(p.id);
      programChecks.push({ p, cb });
      programBox.appendChild(el("label", { class: "chip", style: "display:flex;align-items:center;gap:6px" }, [cb, el("span", { text: p.name })]));
    });

    function loadClassSubject() {
      clsSel.innerHTML = '<option value="">Class</option>';
      subSel.innerHTML = '<option value="">Subject</option>';
      if (secSel.value) {
        cfg.classes(secSel.value).forEach((k) => clsSel.appendChild(el("option", { value: k.id, text: k.name, selected: existing?.classId === k.id })));
        cfg.subjects(secSel.value).forEach((s) => subSel.appendChild(el("option", { value: s.name, text: s.name, selected: existing?.subject === s.name })));
      }
      refreshAvailable();
    }
    function refreshAvailable() {
      const draft = readExamConfig();
      available.textContent = `Questions Available: ${availableQuestions(draft).length}`;
    }
    function readExamConfig() {
      return {
        ...(existing || {}),
        title: title.value.trim(),
        sectionId: secSel.value,
        classId: clsSel.value,
        subject: subSel.value,
        session: sessionInp.value.trim() || cfg.currentSession(),
        term: termSel.value,
        examDate: examDate.value,
        duration: num(duration.value),
        passMark: num(passMark.value),
        status: statusSel.value,
        questionsToTake: num(questionsToTake.value),
        randomSelection: randomSelection.checked,
        topicDistribution: parseDistribution(topicDist.value),
        difficultyDistribution: { Easy: num(easyPct.value), Medium: num(mediumPct.value), Hard: num(hardPct.value) },
        programIds: programChecks.filter(({ cb }) => cb.checked).map(({ p }) => p.id),
        questions: existing?.questions || []
      };
    }
    secSel.onchange = loadClassSubject;
    clsSel.onchange = refreshAvailable;
    subSel.onchange = refreshAvailable;
    [questionsToTake, topicDist, easyPct, mediumPct, hardPct].forEach((n) => n.oninput = refreshAvailable);
    if (existing) {
      secSel.value = existing.sectionId || "";
      loadClassSubject();
      clsSel.value = existing.classId || "";
      subSel.value = existing.subject || "";
      refreshAvailable();
    }

    const body = el("div", { class: "form-grid" }, [
      field("Exam Title", title, { full: true }),
      field("Section", secSel), field("Class", clsSel), field("Subject", subSel),
      field("Session", sessionInp), field("Term", termSel), field("Exam Date", examDate),
      field("Duration (Minutes)", duration), field("Pass Mark (%)", passMark), field("Status", statusSel),
      field("Questions To Take", questionsToTake), field("Random Selection", el("label", { class: "row" }, [randomSelection, el("span", { text: "Enable random selection/order per student" })])),
      el("div", { class: "full" }, [available]),
      field("Topic Distribution", topicDist, { full: true }),
      field("Easy %", easyPct), field("Medium %", mediumPct), field("Hard %", hardPct)
      , field("Assigned Programs (optional)", programBox, { full: true })
    ]);
    const m = modal({ title: existing ? "Edit CBT Setup" : "CBT Setup Wizard", size: "lg", body, footer: [
      btn("Preview Selected Questions", { onclick: () => previewSelectedQuestions(readExamConfig()) }),
      btn(existing ? "Save Exam" : "Create Exam", { variant: "primary", onclick: () => {
        const exam = readExamConfig();
        if (!exam.title || !exam.sectionId || !exam.classId || !exam.subject) return toast("Fill title, section, class and subject", "error");
        db.save("cbt", { ...exam, id: existing?.id || uuid(), createdAt: existing?.createdAt || Date.now(), createdBy: existing?.createdBy || ctx.user.uid, updatedAt: Date.now() });
        toast(existing ? "Exam updated" : "Exam created", "success");
        m.close();
        redraw();
      } })
    ] });
  }

  function questions(examId, redraw) {
    const exam = db.get("cbt", examId);
    const body = el("div");
    const list = el("div");
    const draw = () => {
      list.innerHTML = "";
      (exam.questions || []).forEach((q, i) => list.appendChild(el("div", { class: "svc-row" }, [
        el("span", { class: "nm", html: `<b>Q${i + 1}.</b> ${q.text} <span class="muted">(Ans: ${answerLabel(q)})</span>` }),
        btn("\u2715", { sm: true, variant: "danger", onclick: () => { exam.questions.splice(i, 1); db.save("cbt", exam); draw(); redraw(); } })
      ])));
      if (!exam.questions.length) list.appendChild(el("p", { class: "muted", text: "No questions yet." }));
    };
    draw();
    const qtext = input({ placeholder: "Question text" });
    const opts = [0, 1, 2, 3].map((i) => input({ placeholder: "Option " + (i + 1) }));
    const ansSel = select(() => [0, 1, 2, 3].map((i) => ({ value: i, label: "Option " + (i + 1) })));
    const add = btn("Add Question", { variant: "success", onclick: () => {
      if (!qtext.value || opts.some((o) => !o.value)) return toast("Fill question and all options", "error");
      exam.questions = exam.questions || [];
      exam.questions.push({ id: uuid(), text: qtext.value, options: opts.map((o) => o.value), answer: num(ansSel.value) });
      db.save("cbt", exam); qtext.value = ""; opts.forEach((o) => o.value = ""); draw(); redraw();
    } });
    body.appendChild(card("Questions", [list]));
    body.appendChild(card("Question Bank Tools", [
      el("div", { class: "row", style: "justify-content:space-between;margin-bottom:12px" }, [
        el("div", { class: "row", style: "gap:8px;flex-wrap:wrap" }, [
          btn("Import from Question Bank", { variant: "primary", onclick: () => importFromBankModal(exam, () => { draw(); redraw(); }) }),
          btn("Bulk Import Raw Text", { variant: "primary", onclick: () => bulkImportExamQuestionsModal(exam, () => { draw(); redraw(); }) }),
          btn("Generate Mathematics Questions", { variant: "success", onclick: () => mathGeneratorModal({ mode: "exam", exam, after: () => { draw(); redraw(); } }) })
        ])
      ])
    ]));
    body.appendChild(card("Add Question", [field("Question", qtext, { full: true }), el("div", { class: "form-grid" }, opts.map((o, i) => field("Option " + (i + 1), o))), field("Correct Answer", ansSel), el("div", { class: "row", style: "margin-top:10px" }, [add])]));
    modal({ title: exam.title + " \u2014 Questions", size: "lg", body });
  }

  function importFromBankModal(exam, after) {
    const picked = new Set();
    const qs = db.query("examQuestions", (q) => q.classId === exam.classId && (!exam.subject || q.subject === exam.subject));
    const body = el("div");
    body.appendChild(table([
      { label: "", render: (q) => {
        const cb = input({ type: "checkbox" });
        cb.onchange = () => cb.checked ? picked.add(q.id) : picked.delete(q.id);
        return cb;
      } },
      { label: "Topic", key: "topic" },
      { label: "Type", key: "type" },
      { label: "Question", render: (q) => el("div", { html: q.text, style: "max-height:42px;overflow:hidden" }) }
    ], qs, { empty: "No matching questions in the bank." }));
    const m = modal({ title: "Import Questions", size: "lg", body, footer: [btn("Import Selected", { variant: "primary", onclick: () => {
      const selected = qs.filter((q) => picked.has(q.id)).map((q) => ({ ...q, id: uuid() }));
      exam.questions = [...(exam.questions || []), ...selected];
      db.save("cbt", exam);
      toast(`${selected.length} question(s) imported`, "success");
      m.close();
      after();
    } })] });
  }

  function takeCbt(examId, ctx) {
    const exam = db.get("cbt", examId);
    const student = db.get("students", ctx.param || ctx.user.studentId || "");
    if (student && !isExamAssignedToStudent(exam, student)) return toast("This exam is not assigned to you.", "error");
    const questionSet = selectQuestionsForExam(exam, { random: exam.randomSelection !== false });
    if (!questionSet.length) return toast("No questions are available for this CBT setup.", "error");
    const answers = {};
    const theoryAnswers = {};
    const body = el("div");
    questionSet.forEach((q, i) => {
      if (q.type === "Fill in the blank") {
        const ans = el("input", { type: "text", style: "width:100%", placeholder: "Enter your answer..." });
        ans.oninput = () => { answers[q.id] = ans.value; };
        body.appendChild(card(`Q${i + 1}.`, [el("div", { html: q.text, style: "margin-bottom:8px" }), ans]));
        return;
      }
      if ((q.type && q.type !== "Objective") || !(q.options || []).length) {
        const ans = el("textarea", { rows: 4, style: "width:100%;resize:vertical", placeholder: "Enter theory answer..." });
        ans.oninput = () => { theoryAnswers[q.id] = ans.value; };
        body.appendChild(card(`Q${i + 1}.`, [el("div", { html: q.text, style: "margin-bottom:8px" }), ans]));
        return;
      }
      const opts = el("div", {}, (q.options || []).map((o, oi) => {
        const id = "q" + i + "o" + oi;
        const r = el("label", { class: "chip", style: "display:block;margin:4px 0;text-align:left" }, [
          el("input", { type: "radio", name: "q" + i, value: oi, onchange: () => answers[q.id] = oi, style: "margin-right:8px" }),
          el("span", { html: o })
        ]);
        return r;
      }));
      body.appendChild(card(`Q${i + 1}.`, [el("div", { html: q.text, style: "margin-bottom:8px" }), opts]));
    });
    const m = modal({ title: exam.title + " (CBT)", size: "lg", body, footer: [btn("Submit", { variant: "primary", onclick: () => {
      const objective = questionSet.filter((q) => q.type === "Fill in the blank" || ((!q.type || q.type === "Objective") && (q.options || []).length));
      let score = 0;
      objective.forEach((q) => {
        if (q.type === "Fill in the blank") {
           if (answers[q.id] && answers[q.id].toLowerCase().trim() === (q.answerText || q.answer || "").toLowerCase().trim()) score++;
        } else {
           if (answers[q.id] === q.answer) score++;
        }
      });
      const total = objective.length;
      const pct = total ? Math.round((score / total) * 100) : 0;
      const studentId = ctx.param || ctx.user.studentId || "";
      db.save("cbtAttempts", { id: uuid(), examId, title: exam.title, subject: exam.subject, classId: exam.classId, studentId, score, total, percentage: pct, answers, theoryAnswers, selectedQuestionIds: questionSet.map((q) => q.id), at: Date.now(), by: ctx.user.email });
      if (studentId && total) saveCbtResult(exam, studentId, pct);
      m.close(); toast(total ? `Score: ${score}/${total} (${pct}%)` : "Theory answers submitted for marking", "success", 4000);
    } })] });
  }

  function saveCbtResult(exam, studentId, pct) {
    const student = db.get("students", studentId);
    if (!student) return;
    const term = exam.term || cfg.currentTerm();
    const session = exam.session || cfg.currentSession();
    let rec = db.find("results", (r) => r.studentId === studentId && r.classId === exam.classId && r.term === term && r.session === session)
      || { id: uuid(), studentId, sectionId: student.sectionId, classId: exam.classId, term, session, subjects: [], createdAt: Date.now() };
    const examScore = Math.round((pct / 100) * 60);
    const existing = (rec.subjects || []).find((s) => s.name === exam.subject) || {};
    const ca = num(existing.ca);
    const total = ca + examScore;
    const grading = cfg.gradeFor(total);
    const subjectResult = { ...existing, name: exam.subject, exam: examScore, total, grade: grading.grade, remark: grading.remark };
    const idx = (rec.subjects || []).findIndex((s) => s.name === exam.subject);
    if (idx >= 0) rec.subjects[idx] = subjectResult; else rec.subjects = [...(rec.subjects || []), subjectResult];
    rec.total = rec.subjects.reduce((a, s) => a + num(s.total), 0);
    rec.average = rec.subjects.length ? rec.total / rec.subjects.length : 0;
    rec.updatedAt = Date.now();
    db.save("results", rec);
  }
  
  function drawAIEditor() {
    const qList = db.list("examQuestions").sort((a,b) => b.createdAt - a.createdAt);
    host.innerHTML = "";
    
    const container = el("div", { style: "display:flex; gap:16px; height: calc(100vh - 160px); min-height: 500px;" });
    
    const leftPanel = el("div", { style: "width: 350px; background: #fff; border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden;" });
    const rightPanel = el("div", { style: "flex: 1; background: #fff; border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; padding: 20px; overflow-y: auto;" });
    
    const leftHeader = el("div", { style: "padding: 16px; border-bottom: 1px solid var(--border); background: #f8fafc; font-weight: bold;" }, [document.createTextNode("Select Question")]);
    const listScroll = el("div", { style: "flex: 1; overflow-y: auto;" });
    leftPanel.appendChild(leftHeader);
    leftPanel.appendChild(listScroll);
    
    let activeQuestion = null;
    let selectedItemDiv = null;

    function renderRightPanel() {
      rightPanel.innerHTML = "";
      if (!activeQuestion) {
         rightPanel.appendChild(el("div", { class: "muted", style: "margin:auto", text: "Select a question from the left panel to improve." }));
         return;
      }
      
      const header = el("h3", { text: "Original Question", style: "margin-top:0" });
      const origText = el("div", { html: activeQuestion.text, style: "padding: 16px; background: #f1f5f9; border-radius: 4px; margin-bottom: 20px; font-size: 16px;" });
      
      const controls = el("div", { class: "row", style: "margin-bottom: 20px;" });
      const aiBtn = btn("✨ AI Improve Question", { variant: "primary", onclick: handleAIImprove });
      controls.appendChild(aiBtn);
      
      const diffContainer = el("div", { style: "display:none; flex-direction: column; gap: 16px;" });
      
      rightPanel.appendChild(header);
      rightPanel.appendChild(origText);
      rightPanel.appendChild(controls);
      rightPanel.appendChild(diffContainer);
      
      async function handleAIImprove() {
        aiBtn.disabled = true;
        aiBtn.textContent = "⏳ Thinking...";
        
        try {
           const improvedText = await callAIImprovement(activeQuestion.text);
           if(!improvedText) throw new Error("No response from AI");
           
           controls.style.display = "none";
           diffContainer.style.display = "flex";
           diffContainer.innerHTML = "";
           
           diffContainer.appendChild(el("h3", { text: "AI Improved Version", style: "margin:0" }));
           const newText = el("div", { html: improvedText, style: "padding: 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; font-size: 16px; color: #166534;" });
           diffContainer.appendChild(newText);
           
           const actions = el("div", { class: "row", style: "gap: 8px; margin-top: 10px;" });
           actions.appendChild(btn("Accept Changes", { variant: "success", onclick: () => {
             activeQuestion.text = improvedText;
             db.save("examQuestions", activeQuestion);
             toast("Question updated successfully!", "success");
             
             // Sync exams if this question exists in any CBT exam's manual list
             const exams = db.list("cbt");
             exams.forEach(ex => {
               if(ex.questions) {
                 const idx = ex.questions.findIndex(q => q.id === activeQuestion.id);
                 if(idx >= 0) {
                   ex.questions[idx].text = improvedText;
                   db.save("cbt", ex);
                 }
               }
             });
             
             renderRightPanel();
             drawLeftList(); // update left text
           }}));
           actions.appendChild(btn("Reject", { variant: "danger", onclick: () => {
             renderRightPanel();
           }}));
           
           diffContainer.appendChild(actions);
        } catch(e) {
           console.error(e);
           toast("Failed to improve question. " + e.message, "error");
        } finally {
           aiBtn.disabled = false;
           aiBtn.textContent = "✨ AI Improve Question";
        }
      }
    }
    
    function drawLeftList() {
      listScroll.innerHTML = "";
      if(!qList.length) {
         listScroll.appendChild(el("div", { class: "muted", style: "padding: 16px", text: "No questions available." }));
         return;
      }
      qList.forEach(q => {
        const stripHtml = (html) => { const tmp = document.createElement("div"); tmp.innerHTML = html; return tmp.textContent || tmp.innerText || ""; };
        const plainText = stripHtml(q.text || "Untitled Question");

        const row = el("div", { 
          style: "padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.2s;",
          html: `<div style="font-weight: 600; font-size: 12px; color: var(--primary); margin-bottom: 4px;">${q.subject} - ${cfg.className(q.classId)}</div>
                 <div style="font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${plainText}</div>`
        });
        
        if (activeQuestion && activeQuestion.id === q.id) {
           row.style.background = "var(--primary-light, #eef2ff)";
           selectedItemDiv = row;
        }
        
        row.onmouseover = () => { if (row !== selectedItemDiv) row.style.background = "#f8fafc"; };
        row.onmouseout = () => { if (row !== selectedItemDiv) row.style.background = "transparent"; };
        
        row.onclick = () => {
           if(selectedItemDiv) {
              selectedItemDiv.style.background = "transparent";
           }
           row.style.background = "var(--primary-light, #eef2ff)";
           selectedItemDiv = row;
           activeQuestion = q;
           renderRightPanel();
        };
        listScroll.appendChild(row);
      });
    }

    drawLeftList();
    renderRightPanel();
    
    container.appendChild(leftPanel);
    container.appendChild(rightPanel);
    host.appendChild(container);
  }

  async function callAIImprovement(originalText) {
    const apiKey = window.AI_API_KEY || localStorage.getItem("AI_API_KEY"); 
    
    if (!apiKey) {
      return new Promise(resolve => {
        setTimeout(() => {
          let improved = originalText.trim();
          if (!improved.includes("?") && !improved.toLowerCase().startsWith("calculate") && !improved.includes("<")) {
            improved += " ?";
          }
          improved = improved.replace(/\bi\b/g, "I");
          if(improved.charAt(0)) improved = improved.charAt(0).toUpperCase() + improved.slice(1);
          resolve(`[AI Enhanced]: ${improved}`);
        }, 1500);
      });
    }
    
    const prompt = `You are an exam assistant. Improve clarity of the question only. Do not change meaning, answer, or marks. Preserve any HTML formatting exactly. Return ONLY the improved question HTML/text.\n\nOriginal Question: ${originalText}`;
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    
    if(!response.ok) throw new Error("AI Request Failed");
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || originalText;
  }
  
  // Default launch tab
  if (canViewCbt) drawCbt();
  else drawQBank();
}
