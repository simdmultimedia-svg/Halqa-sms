// Qur'an Link Module - Track students' Qur'an memorization progress
import { db } from "../core/db.js";
import { el, toast, todayISO, confirmDialog } from "../core/utils.js";
import { card, pageHead, field, input, select, btn, table, textarea } from "../core/ui.js";
import * as cfg from "../core/config.js";

export function render(root, ctx) {
  root.appendChild(pageHead("Qur'an Link", "Track students' Qur'an memorization progress with teacher supervision and brain tests."));
  
  const tabs = el("div", { class: "row", style: "margin-bottom:16px" }, [
    btn("Progress Dashboard", { variant: "primary", icon: "📊", onclick: () => showDashboard(host, ctx) }),
    btn("Brain Tests", { variant: "ghost", icon: "🧠", onclick: () => showTests(host, ctx) }),
    btn("Create Test", { variant: "ghost", icon: "➕", onclick: () => createTest(host, ctx) }),
    btn("Milestones", { variant: "ghost", icon: "🎯", onclick: () => showMilestones(host, ctx) })
  ]);
  root.appendChild(tabs);
  
  const host = el("div");
  root.appendChild(host);
  showDashboard(host, ctx);
}

function showDashboard(host, ctx) {
  host.innerHTML = "";
  const c = card("Qur'an Memorization Progress Dashboard");
  
  // Statistics
  const stats = el("div", { class: "row", style: "gap:16px;margin-bottom:24px" });
  const totalStudents = db.list("students").filter(s => s.status === "active").length;
  const totalTests = db.list("quranTests").length;
  const completedTests = db.list("quranTestResults").filter(r => r.status === "completed").length;
  
  stats.appendChild(statCard("Total Students", totalStudents, "👨‍🎓"));
  stats.appendChild(statCard("Total Tests", totalTests, "🧠"));
  stats.appendChild(statCard("Completed Tests", completedTests, "✅"));
  stats.appendChild(statCard("In Progress", totalTests - completedTests, "📝"));
  c.appendChild(stats);
  
  // Recent Activity
  c.appendChild(el("h3", { text: "Recent Activity", style: "margin:24px 0 16px" }));
  const activityTable = table(["Date", "Student", "Surah", "Status", "Teacher"], []);
  const recentResults = db.list("quranTestResults").sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  
  recentResults.forEach(r => {
    const student = db.get("students", r.studentId);
    activityTable.appendChild(el("tr", {}, [
      el("td", { text: new Date(r.createdAt).toLocaleDateString() }),
      el("td", { text: student?.fullName || "Unknown" }),
      el("td", { text: r.surahName || "N/A" }),
      el("td", { text: r.status }),
      el("td", { text: r.teacherName || "N/A" })
    ]));
  });
  
  if (recentResults.length === 0) {
    activityTable.appendChild(el("tr", {}, [el("td", { colSpan: 5, text: "No recent activity", style: "text-align:center;color:var(--muted)" })]));
  }
  
  c.appendChild(activityTable);
  host.appendChild(c);
}

function showTests(host, ctx) {
  host.innerHTML = "";
  const c = card("Brain Tests");
  
  const tests = db.list("quranTests").sort((a, b) => b.createdAt - a.createdAt);
  
  if (tests.length === 0) {
    c.appendChild(el("p", { class: "muted", text: "No brain tests created yet. Click 'Create Test' to add one." }));
  } else {
    const testTable = table(["Test Name", "Surah", "Verses", "Created By", "Status", "Actions"], []);
    
    tests.forEach(t => {
      const testRow = el("tr", {}, [
        el("td", { text: t.name }),
        el("td", { text: t.surahName }),
        el("td", { text: `${t.fromVerse} - ${t.toVerse}` }),
        el("td", { text: t.createdBy }),
        el("td", { text: t.status }),
        el("td", {}, [
          btn("View", { variant: "ghost", style: "font-size:12px;padding:4px 8px", onclick: () => viewTest(t.id, host, ctx) }),
          btn("Assign", { variant: "ghost", style: "font-size:12px;padding:4px 8px", onclick: () => assignTest(t.id, host, ctx) })
        ])
      ]);
      testTable.appendChild(testRow);
    });
    
    c.appendChild(testTable);
  }
  
  host.appendChild(c);
}

function createTest(host, ctx) {
  host.innerHTML = "";
  const c = card("Create Brain Test");
  
  const grid = el("div", { class: "form-grid" });
  const testName = input({ placeholder: "Test Name (e.g., Juz 30 Assessment)" });
  const surahName = select(() => [
    { value: "", label: "Select Surah" },
    { value: "Al-Fatihah", label: "1. Al-Fatihah" },
    { value: "Al-Baqarah", label: "2. Al-Baqarah" },
    { value: "Al-Imran", label: "3. Al-Imran" },
    { value: "An-Nisa", label: "4. An-Nisa" },
    { value: "Al-Ma'idah", label: "5. Al-Ma'idah" },
    { value: "Al-An'am", label: "6. Al-An'am" },
    { value: "Al-A'raf", label: "7. Al-A'raf" },
    { value: "Al-Anfal", label: "8. Al-Anfal" },
    { value: "At-Tawbah", label: "9. At-Tawbah" },
    { value: "Yunus", label: "10. Yunus" },
    { value: "Hud", label: "11. Hud" },
    { value: "Yusuf", label: "12. Yusuf" },
    { value: "Ar-Ra'd", label: "13. Ar-Ra'd" },
    { value: "Ibrahim", label: "14. Ibrahim" },
    { value: "Al-Hijr", label: "15. Al-Hijr" },
    { value: "An-Nahl", label: "16. An-Nahl" },
    { value: "Al-Isra", label: "17. Al-Isra" },
    { value: "Al-Kahf", label: "18. Al-Kahf" },
    { value: "Maryam", label: "19. Maryam" },
    { value: "Ta-Ha", label: "20. Ta-Ha" },
    { value: "Al-Anbiya", label: "21. Al-Anbiya" },
    { value: "Al-Hajj", label: "22. Al-Hajj" },
    { value: "Al-Mu'minun", label: "23. Al-Mu'minun" },
    { value: "An-Nur", label: "24. An-Nur" },
    { value: "Al-Furqan", label: "25. Al-Furqan" },
    { value: "Ash-Shu'ara", label: "26. Ash-Shu'ara" },
    { value: "An-Naml", label: "27. An-Naml" },
    { value: "Al-Qasas", label: "28. Al-Qasas" },
    { value: "Al-Ankabut", label: "29. Al-Ankabut" },
    { value: "Ar-Rum", label: "30. Ar-Rum" },
    { value: "Luqman", label: "31. Luqman" },
    { value: "As-Sajdah", label: "32. As-Sajdah" },
    { value: "Al-Ahzab", label: "33. Al-Ahzab" },
    { value: "Saba", label: "34. Saba" },
    { value: "Fatir", label: "35. Fatir" },
    { value: "Ya-Sin", label: "36. Ya-Sin" },
    { value: "As-Saffat", label: "37. As-Saffat" },
    { value: "Sad", label: "38. Sad" },
    { value: "Az-Zumar", label: "39. Az-Zumar" },
    { value: "Ghafir", label: "40. Ghafir" },
    { value: "Fussilat", label: "41. Fussilat" },
    { value: "Ash-Shura", label: "42. Ash-Shura" },
    { value: "Az-Zukhruf", label: "43. Az-Zukhruf" },
    { value: "Ad-Dukhan", label: "44. Ad-Dukhan" },
    { value: "Al-Jathiyah", label: "45. Al-Jathiyah" },
    { value: "Al-Ahqaf", label: "46. Al-Ahqaf" },
    { value: "Muhammad", label: "47. Muhammad" },
    { value: "Al-Fath", label: "48. Al-Fath" },
    { value: "Al-Hujurat", label: "49. Al-Hujurat" },
    { value: "Qaf", label: "50. Qaf" },
    { value: "Adh-Dhariyat", label: "51. Adh-Dhariyat" },
    { value: "At-Tur", label: "52. At-Tur" },
    { value: "An-Najm", label: "53. An-Najm" },
    { value: "Al-Qamar", label: "54. Al-Qamar" },
    { value: "Ar-Rahman", label: "55. Ar-Rahman" },
    { value: "Al-Waqi'ah", label: "56. Al-Waqi'ah" },
    { value: "Al-Hadid", label: "57. Al-Hadid" },
    { value: "Al-Mujadila", label: "58. Al-Mujadila" },
    { value: "Al-Hashr", label: "59. Al-Hashr" },
    { value: "Al-Mumtahanah", label: "60. Al-Mumtahanah" },
    { value: "As-Saff", label: "61. As-Saff" },
    { value: "Al-Jumu'ah", label: "62. Al-Jumu'ah" },
    { value: "Al-Munafiqun", label: "63. Al-Munafiqun" },
    { value: "At-Taghabun", label: "64. At-Taghabun" },
    { value: "At-Talaq", label: "65. At-Talaq" },
    { value: "At-Tahrim", label: "66. At-Tahrim" },
    { value: "Al-Mulk", label: "67. Al-Mulk" },
    { value: "Al-Qalam", label: "68. Al-Qalam" },
    { value: "Al-Haqqah", label: "69. Al-Haqqah" },
    { value: "Al-Ma'arij", label: "70. Al-Ma'arij" },
    { value: "Nuh", label: "71. Nuh" },
    { value: "Al-Jinn", label: "72. Al-Jinn" },
    { value: "Al-Muzzammil", label: "73. Al-Muzzammil" },
    { value: "Al-Muddaththir", label: "74. Al-Muddaththir" },
    { value: "Al-Qiyamah", label: "75. Al-Qiyamah" },
    { value: "Al-Insan", label: "76. Al-Insan" },
    { value: "Al-Mursalat", label: "77. Al-Mursalat" },
    { value: "An-Naba", label: "78. An-Naba" },
    { value: "An-Nazi'at", label: "79. An-Nazi'at" },
    { value: "Abasa", label: "80. Abasa" },
    { value: "At-Takwir", label: "81. At-Takwir" },
    { value: "Al-Infitar", label: "82. Al-Infitar" },
    { value: "Al-Mutaffifin", label: "83. Al-Mutaffifin" },
    { value: "Al-Inshiqaq", label: "84. Al-Inshiqaq" },
    { value: "Al-Buruj", label: "85. Al-Buruj" },
    { value: "At-Tariq", label: "86. At-Tariq" },
    { value: "Al-A'la", label: "87. Al-A'la" },
    { value: "Al-Ghashiyah", label: "88. Al-Ghashiyah" },
    { value: "Al-Fajr", label: "89. Al-Fajr" },
    { value: "Al-Balad", label: "90. Al-Balad" },
    { value: "Ash-Shams", label: "91. Ash-Shams" },
    { value: "Al-Layl", label: "92. Al-Layl" },
    { value: "Ad-Duha", label: "93. Ad-Duha" },
    { value: "Ash-Sharh", label: "94. Ash-Sharh" },
    { value: "At-Tin", label: "95. At-Tin" },
    { value: "Al-Alaq", label: "96. Al-Alaq" },
    { value: "Al-Qadr", label: "97. Al-Qadr" },
    { value: "Al-Bayyinah", label: "98. Al-Bayyinah" },
    { value: "Az-Zalzalah", label: "99. Az-Zalzalah" },
    { value: "Al-Adiyat", label: "100. Al-Adiyat" },
    { value: "Al-Qari'ah", label: "101. Al-Qari'ah" },
    { value: "At-Takathur", label: "102. At-Takathur" },
    { value: "Al-Asr", label: "103. Al-Asr" },
    { value: "Al-Humazah", label: "104. Al-Humazah" },
    { value: "Al-Fil", label: "105. Al-Fil" },
    { value: "Quraysh", label: "106. Quraysh" },
    { value: "Al-Ma'un", label: "107. Al-Ma'un" },
    { value: "Al-Kawthar", label: "108. Al-Kawthar" },
    { value: "Al-Kafirun", label: "109. Al-Kafirun" },
    { value: "An-Nasr", label: "110. An-Nasr" },
    { value: "Al-Masad", label: "111. Al-Masad" },
    { value: "Al-Ikhlas", label: "112. Al-Ikhlas" },
    { value: "Al-Falaq", label: "113. Al-Falaq" },
    { value: "An-Nas", label: "114. An-Nas" }
  ]);
  const fromVerse = input({ type: "number", placeholder: "From Verse" });
  const toVerse = input({ type: "number", placeholder: "To Verse" });
  const testType = select(() => [
    { value: "recitation", label: "Recitation Test" },
    { value: "memorization", label: "Memorization Test" },
    { value: "revision", label: "Revision Test" }
  ]);
  const notes = textarea({ rows: 3, placeholder: "Additional notes or instructions..." });
  
  grid.appendChild(field("Test Name", testName));
  grid.appendChild(field("Surah", surahName));
  grid.appendChild(field("From Verse", fromVerse));
  grid.appendChild(field("To Verse", toVerse));
  grid.appendChild(field("Test Type", testType));
  grid.appendChild(field("Notes", notes, { full: true }));
  
  c.appendChild(grid);
  
  c.appendChild(el("div", { class: "row", style: "margin-top:16px" }, [
    btn("Cancel", { variant: "ghost", onclick: () => showTests(host, ctx) }),
    btn("Create Test", { variant: "primary", onclick: () => {
      if (!testName.value.trim()) return toast("Enter test name", "error");
      if (!surahName.value) return toast("Select a surah", "error");
      if (!fromVerse.value || !toVerse.value) return toast("Enter verse range", "error");
      
      const test = db.save("quranTests", {
        id: "qt-" + Date.now(),
        name: testName.value.trim(),
        surahName: surahName.value,
        fromVerse: parseInt(fromVerse.value),
        toVerse: parseInt(toVerse.value),
        testType: testType.value,
        notes: notes.value.trim(),
        status: "active",
        createdBy: ctx.user.email,
        createdAt: Date.now()
      });
      
      toast("Brain test created successfully", "success");
      showTests(host, ctx);
    }})
  ]));
  
  host.appendChild(c);
}

function viewTest(testId, host, ctx) {
  host.innerHTML = "";
  const test = db.get("quranTests", testId);
  if (!test) return toast("Test not found", "error");
  
  const c = card("Test Details");
  
  const grid = el("div", { class: "form-grid" });
  grid.appendChild(field("Test Name", el("div", { text: test.name })));
  grid.appendChild(field("Surah", el("div", { text: test.surahName })));
  grid.appendChild(field("Verse Range", el("div", { text: `${test.fromVerse} - ${test.toVerse}` })));
  grid.appendChild(field("Test Type", el("div", { text: test.testType })));
  grid.appendChild(field("Status", el("div", { text: test.status })));
  grid.appendChild(field("Created By", el("div", { text: test.createdBy })));
  grid.appendChild(field("Created At", el("div", { text: new Date(test.createdAt).toLocaleString() })));
  if (test.notes) grid.appendChild(field("Notes", el("div", { text: test.notes }), { full: true }));
  
  c.appendChild(grid);
  
  // Show assigned students
  c.appendChild(el("h3", { text: "Assigned Students", style: "margin:24px 0 16px" }));
  const results = db.list("quranTestResults").filter(r => r.testId === testId);
  
  if (results.length === 0) {
    c.appendChild(el("p", { class: "muted", text: "No students assigned to this test yet." }));
  } else {
    const resultTable = table(["Student", "Score", "Status", "Teacher", "Date"], []);
    results.forEach(r => {
      const student = db.get("students", r.studentId);
      resultTable.appendChild(el("tr", {}, [
        el("td", { text: student?.fullName || "Unknown" }),
        el("td", { text: r.score ? `${r.score}%` : "N/A" }),
        el("td", { text: r.status }),
        el("td", { text: r.teacherName }),
        el("td", { text: new Date(r.createdAt).toLocaleDateString() })
      ]));
    });
    c.appendChild(resultTable);
  }
  
  c.appendChild(el("div", { class: "row", style: "margin-top:16px" }, [
    btn("Back", { variant: "ghost", onclick: () => showTests(host, ctx) }),
    btn("Assign to Students", { variant: "primary", onclick: () => assignTest(testId, host, ctx) })
  ]));
  
  host.appendChild(c);
}

function assignTest(testId, host, ctx) {
  host.innerHTML = "";
  const test = db.get("quranTests", testId);
  if (!test) return toast("Test not found", "error");
  
  const c = card(`Assign Test: ${test.name}`);
  
  const students = db.list("students").filter(s => s.status === "active");
  const selectedStudents = new Set();
  
  const studentList = el("div", { style: "max-height:400px;overflow-y:auto" });
  students.forEach(s => {
    const existing = db.list("quranTestResults").find(r => r.testId === testId && r.studentId === s.id);
    if (existing) return; // Skip already assigned
    
    const cb = input({ type: "checkbox" });
    cb.onchange = () => {
      if (cb.checked) selectedStudents.add(s.id);
      else selectedStudents.delete(s.id);
    };
    
    const row = el("div", { class: "row", style: "gap:8px;align-items:center;padding:8px;border-bottom:1px solid var(--border)" }, [
      cb,
      el("span", { text: `${s.fullName} (${s.admissionNo})` })
    ]);
    studentList.appendChild(row);
  });
  
  if (studentList.children.length === 0) {
    c.appendChild(el("p", { class: "muted", text: "All students have already been assigned to this test." }));
  } else {
    c.appendChild(studentList);
    
    c.appendChild(el("div", { class: "row", style: "margin-top:16px" }, [
      btn("Cancel", { variant: "ghost", onclick: () => viewTest(testId, host, ctx) }),
      btn("Assign Selected", { variant: "primary", onclick: () => {
        if (selectedStudents.size === 0) return toast("Select at least one student", "error");
        
        selectedStudents.forEach(studentId => {
          db.save("quranTestResults", {
            id: "qtr-" + Date.now() + Math.random(),
            testId: testId,
            studentId: studentId,
            status: "pending",
            score: null,
            teacherName: ctx.user.email,
            createdAt: Date.now()
          });
        });
        
        toast(`Test assigned to ${selectedStudents.size} students`, "success");
        viewTest(testId, host, ctx);
      }})
    ]));
  }
  
  host.appendChild(c);
}

function showMilestones(host, ctx) {
  host.innerHTML = "";
  const c = card("Memorization Milestones");
  
  // Create milestone form
  const grid = el("div", { class: "form-grid" });
  const studentSelect = select(() => [{ value: "", label: "Select Student" }, ...db.list("students").filter(s => s.status === "active").map(s => ({ value: s.id, label: `${s.fullName} (${s.admissionNo})` }))]);
  const milestoneType = select(() => [
    { value: "juz", label: "Juz Completed" },
    { value: "surah", label: "Surah Completed" },
    { value: "page", label: "Pages Completed" }
  ]);
  const milestoneName = input({ placeholder: "e.g., Juz 30, Surah Al-Fatihah, Pages 1-10" });
  const notes = textarea({ rows: 2, placeholder: "Teacher's notes..." });
  
  grid.appendChild(field("Student", studentSelect));
  grid.appendChild(field("Milestone Type", milestoneType));
  grid.appendChild(field("Milestone Name", milestoneName));
  grid.appendChild(field("Notes", notes, { full: true }));
  
  c.appendChild(grid);
  
  c.appendChild(btn("Record Milestone", { variant: "primary", onclick: () => {
    if (!studentSelect.value) return toast("Select a student", "error");
    if (!milestoneName.value.trim()) return toast("Enter milestone name", "error");
    
    const student = db.get("students", studentSelect.value);
    db.save("quranMilestones", {
      id: "qm-" + Date.now(),
      studentId: studentSelect.value,
      studentName: student.fullName,
      milestoneType: milestoneType.value,
      milestoneName: milestoneName.value.trim(),
      notes: notes.value.trim(),
      recordedBy: ctx.user.email,
      recordedAt: Date.now()
    });
    
    toast("Milestone recorded successfully", "success");
    showMilestones(host, ctx);
  }}));
  
  // Show milestones list
  c.appendChild(el("h3", { text: "Recent Milestones", style: "margin:24px 0 16px" }));
  const milestones = db.list("quranMilestones").sort((a, b) => b.recordedAt - a.recordedAt);
  
  if (milestones.length === 0) {
    c.appendChild(el("p", { class: "muted", text: "No milestones recorded yet." }));
  } else {
    const milestoneTable = table(["Student", "Milestone", "Type", "Recorded By", "Date"], []);
    milestones.forEach(m => {
      milestoneTable.appendChild(el("tr", {}, [
        el("td", { text: m.studentName }),
        el("td", { text: m.milestoneName }),
        el("td", { text: m.milestoneType }),
        el("td", { text: m.recordedBy }),
        el("td", { text: new Date(m.recordedAt).toLocaleDateString() })
      ]));
    });
    c.appendChild(milestoneTable);
  }
  
  host.appendChild(c);
}

function statCard(label, value, icon) {
  return el("div", { style: "flex:1;padding:16px;background:var(--surface);border-radius:8px;border:1px solid var(--border)" }, [
    el("div", { style: "font-size:24px;margin-bottom:8px", text: icon }),
    el("div", { style: "font-size:32px;font-weight:800", text: value }),
    el("div", { style: "font-size:14px;color:var(--muted)", text: label })
  ]);
}
