import { db, pendingSyncCount, FIRESTORE_COLLECTIONS } from "../core/db.js";
import { el, toast, num, uuid, confirmDialog, slug, modal, naira } from "../core/utils.js";
import { card, pageHead, table, btn, input, select, field, readFileAsDataURL } from "../core/ui.js";
import { publishGlobalSeedData } from "./seedSync.js";
import { defaultUniformItems, makeUniformRecord, uniformCatalog, uniformManagementPanel } from "./uniforms.js";
import { getBranding, saveBranding } from "../core/branding.js";
import { can, ROLES, MODULES, DEFAULT_ROLE_ACCESS } from "../core/rbac.js";
import * as cfg from "../core/config.js";
import { attendanceSettings } from "../core/staffattendance.js";
import { syncStudentProgramInvoice } from "../core/billing.js";
import { getState, initCloud, setMode, logFirebaseDiagnostics, getSyncLog } from "../core/adapter.js";

export function render(root, ctx) {
  if (!can(ctx.user.role, "manageSettings")) { root.appendChild(pageHead("Settings")); root.appendChild(card("Access", [el("p", { class: "muted", text: "Only Admin / Super Admin can change settings." })])); return; }
  root.appendChild(pageHead("Settings & Configuration", "Everything is configurable here \u2014 no values are hardcoded in the system."));
  const layout = el("div", { class: "grid", style: "grid-template-columns:210px 1fr;align-items:start" });
  const nav = el("div", { class: "card", style: "padding:8px" });
  const panel = el("div");
  layout.appendChild(nav); layout.appendChild(panel);
  root.appendChild(layout);

  const TABS = {
    "School Profile": branding, "Sections": sections, "Classes": classes, "Services": services,
    "Connectivity": connectivity,
    "Firebase Diagnostics": firebaseDiagnostics,
    "Program Management": programs,
    "School Account Details": schoolAccountDetails,
    "School Signatures": schoolSignatures,
    "SMS Gateway": smsGateway,
    "Attendance": attendance,
    "Family Discounts": familyDiscounts,
    "Section Fees": fees, "Uniforms": uniforms, "Books": books, "Bookshop": bookshopCatalogue, "Subjects": subjects,
    "Mathematics Topics": mathematicsSettings,
    "Academic Session": session, "Grading": grading, "Promotion Paths": promotion,
    "User Roles": roles, "Users": users, "Sync Center": syncCenter,
    "Global Seed Data": globalSeedData
  };
  let currentUnsub = null;
  Object.keys(TABS).forEach((k, i) => nav.appendChild(btn(k, {
    variant: i === 0 ? "primary" : "ghost", attrs: { style: "width:100%;justify-content:flex-start;margin-bottom:4px" }, onclick: (e) => {
      nav.querySelectorAll("button").forEach((b) => b.className = "btn btn-ghost"); e.target.className = "btn btn-primary";
      panel.innerHTML = "";
      if (currentUnsub) currentUnsub();
      currentUnsub = TABS[k](panel, ctx);
    }
  })));
  currentUnsub = branding(panel, ctx);
  return () => { if (currentUnsub) currentUnsub(); };
}

function syncCenter(panel) {
  const stats = db.getSyncStats();
  const cloudStudents = Number(stats.cloudCounts?.students || 0);
  const localStudents = Number(stats.localCounts?.students || 0);
  panel.innerHTML = "";
  panel.appendChild(card("Sync Center", [
    el("div", { class: "form-grid" }, [
      field("Pending Queue", el("strong", { text: stats.pending.toLocaleString() })),
      field("Successful Syncs", el("strong", { text: stats.successful.toLocaleString() })),
      field("Failed Syncs", el("strong", { text: stats.failed.toLocaleString() })),
      field("Last Sync", el("span", { text: stats.lastSync })),
      field("Cloud Students", el("strong", { text: cloudStudents.toLocaleString() })),
      field("Local Students", el("strong", { text: localStudents.toLocaleString() }))
    ]),
    el("div", { class: "row", style: "margin-top:12px" }, [
      btn("Open Sync Center", { variant: "primary", onclick: () => { window.location.hash = "#/syncreport"; } })
    ])
  ]));
}

function connectivity(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const current = (db.setting("connectivity")?.mode || localStorage.getItem("CIC KANO:connectivityMode") || "FIREBASE").toUpperCase();
    const modeSel = select(() => ["AUTO", "LOCAL", "FIREBASE"].map((mode) => ({ value: mode, label: mode, selected: mode === current })));
    const c = card("Connectivity", [
      el("p", { class: "muted", text: "FIREBASE mode always initializes Firebase and never silently switches to Local. AUTO uses Firebase when online and Local when offline." }),
      el("div", { class: "form-grid" }, [
        field("Connectivity Mode", modeSel)
      ])
    ]);
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [
      btn("Save Connectivity", {
        variant: "primary", onclick: async () => {
          const mode = modeSel.value;
          db.saveSetting("connectivity", { mode });
          localStorage.setItem("CIC KANO:connectivityMode", mode);
          if (mode === "LOCAL") setMode("local");
          else {
            setMode("cloud");
            await initCloud();
          }
          toast("Connectivity mode saved", "success");
          draw();
        }
      })
    ]));
    panel.appendChild(c);
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

const RULE_REPORT = {
  settings: ["Authenticated read", "Super Admin/Admin write", "System settings"],
  userRoles: ["Authenticated read", "Super Admin write", "Role management"],
  users: ["Own/Admin read", "Super Admin/Admin write", "User accounts"],
  staffLoginMap: ["Super Admin/Admin/Principal read", "Super Admin/Admin write", "Staff login lookup"],
  passwordResetRequests: ["Admin read; staff own read", "Staff create; Admin approve/reject", "Password reset workflow"],
  payslips: ["Admin/Super Admin/Accountant all; staff own", "Admin/Super Admin/Accountant", "Payroll"],
  books: ["Authenticated read", "Admin/Super Admin/Accountant", "Bookshop catalogue"],
  bookSales: ["Admin/Super Admin/Accountant", "Admin/Super Admin/Accountant", "Bookshop sales"],
  examQuestions: ["Admin/Super Admin/Teacher/Exam Officer", "Admin/Super Admin/Teacher/Exam Officer", "CBT questions"],
  cbt: ["Admin/Super Admin/Teacher/Exam Officer/Student", "Admin/Super Admin/Teacher/Exam Officer", "CBT exams"],
  cbtAttempts: ["Admin/Super Admin/Teacher/Exam Officer; student own", "Student submit; Admin/Teacher manage", "CBT attempts"],
  familyInvoices: ["Admin/Super Admin/Accountant; parent own", "Admin/Super Admin/Accountant", "Family invoices"],
  invoices: ["Admin/Super Admin/Accountant; student own", "Admin/Super Admin/Accountant", "Invoices"],
  receipts: ["Admin/Super Admin/Accountant; student own", "Admin/Super Admin/Accountant", "Receipts"],
  payments: ["Admin/Super Admin/Accountant", "Admin/Super Admin/Accountant", "Payments"],
  servicePayments: ["Admin/Super Admin/Accountant", "Admin/Super Admin/Accountant", "Service payments"],
  staffSalaries: ["Admin/Super Admin/Accountant", "Admin/Super Admin/Accountant", "Payroll"],
  salaryComplaints: ["Admin/Super Admin/Accountant; staff own", "Staff create; Admin/Accountant resolve", "Payroll complaints"],
  assignments: ["Admin/Super Admin/Principal/Teacher/Student", "Admin/Super Admin/Teacher", "Class work"],
  lessonPlans: ["Admin/Super Admin/Principal/Teacher", "Admin/Super Admin/Teacher", "Lesson plans"],
  results: ["Admin/Super Admin/Principal/Exam Officer/Teacher/Student own", "Admin/Super Admin/Teacher/Exam Officer", "Results"],
  resultApprovals: ["Admin/Super Admin/Principal/Exam Officer/Teacher", "Admin/Super Admin/Principal/Exam Officer/Teacher", "Result approvals"],
  attendance: ["Admin/Super Admin/Principal/Teacher/Student own", "Admin/Super Admin/Teacher", "Student attendance"],
  staffAttendance: ["Admin/Super Admin/Principal; staff own", "Admin/Super Admin", "Staff attendance"],
  students: ["Admin/Super Admin/Principal/Accountant/Exam Officer/Receptionist/Teacher scoped/Student own", "Admin/Super Admin/Receptionist", "Student records"],
  staff: ["Admin/Super Admin/Principal/Accountant; staff own", "Admin/Super Admin", "Staff records"],
  families: ["Admin/Super Admin/Accountant/Parent own", "Admin/Super Admin/Accountant", "Families"],
  familyLedger: ["Admin/Super Admin/Accountant/Parent own", "Admin/Super Admin/Accountant", "Family ledger"],
  inventory: ["Admin/Super Admin/Accountant/Librarian", "Admin/Super Admin/Accountant/Librarian", "Inventory"],
  inventoryMoves: ["Admin/Super Admin/Accountant/Librarian", "Admin/Super Admin/Accountant/Librarian", "Inventory moves"],
  vouchers: ["Admin/Super Admin/Accountant", "Admin/Super Admin/Accountant", "Vouchers"],
  paymentVouchers: ["Admin/Super Admin/Accountant", "Admin/Super Admin/Accountant", "Payment vouchers"],
  scholarships: ["Admin/Super Admin/Principal/Accountant", "Admin/Super Admin/Principal/Accountant", "Scholarships"],
  discounts: ["Admin/Super Admin/Principal/Accountant", "Admin/Super Admin/Principal/Accountant", "Discounts"],
  studentScholarships: ["Admin/Super Admin/Principal/Accountant", "Admin/Super Admin/Principal/Accountant", "Student scholarships"],
  studentDiscounts: ["Admin/Super Admin/Principal/Accountant", "Admin/Super Admin/Principal/Accountant", "Student discounts"],
  idCards: ["Admin/Super Admin/Receptionist", "Admin/Super Admin/Receptionist", "ID cards"],
  behaviour: ["Admin/Super Admin/Principal/Teacher", "Admin/Super Admin/Teacher", "Behaviour"],
  activities: ["Admin/Super Admin/Principal; user own", "Authenticated scoped", "Activities"],
  auditLogs: ["Admin/Super Admin/Principal", "Admin/Super Admin", "Audit logs"],
  migrationLogs: ["Admin/Super Admin", "Admin/Super Admin", "Migration logs"],
  promotionLogs: ["Admin/Super Admin", "Admin/Super Admin", "Promotion logs"],
  expenses: ["Admin/Super Admin/Accountant", "Admin/Super Admin/Accountant", "Expenses"],
  restorePoints: ["Super Admin", "Super Admin", "Restore points"],
  counters: ["Authenticated read", "Authenticated write", "Number counters"]
};

function firebaseDiagnostics(panel) {
  const draw = () => {
    const st = getState();
    const user = st.auth?.currentUser || null;
    const roleRec = user?.uid ? db.get("userRoles", user.uid) : null;
    const denied = getSyncLog().filter((entry) => entry.status === "denied");
    const deniedByCollection = denied.reduce((acc, entry) => {
      const col = String(entry.path || "").split("/").filter(Boolean)[0] || "(unknown)";
      acc[col] = (acc[col] || 0) + 1;
      return acc;
    }, {});
    const reportRows = FIRESTORE_COLLECTIONS.map((col) => {
      const rule = RULE_REPORT[col];
      return {
        collection: col,
        exists: rule ? "YES" : "NO",
        read: rule?.[0] || "Missing explicit report entry",
        write: rule?.[1] || "Missing explicit report entry",
        role: rule?.[2] || "Missing",
        sync: deniedByCollection[col] ? `Denied (${deniedByCollection[col]})` : "No denied event"
      };
    });
    const missingRules = reportRows.filter((r) => r.exists === "NO").map((r) => r.collection);
    panel.innerHTML = "";
    panel.appendChild(card("Firebase Diagnostics", [
      el("div", { class: "form-grid" }, [
        field("Firebase Initialized", el("strong", { text: st.ready ? "YES" : "NO" })),
        field("Auth Connected", el("strong", { text: st.authReady ? "YES" : st.authChecking ? "CHECKING" : "NO" })),
        field("Firestore Connected", el("strong", { text: st.fs ? "YES" : "NO" })),
        field("Project ID", el("span", { text: st.app?.options?.projectId || "(not initialized)" })),
        field("Current User", el("span", { text: user?.email || "(signed out)" })),
        field("Current Role", el("span", { text: roleRec?.role || "(not loaded)" })),
        field("Cloud Status", el("span", { text: st.cloudStatus || "" })),
        field("Pending Queue Count", el("strong", { text: String(pendingSyncCount()) }))
      ]),
      el("div", { class: "row", style: "margin-top:12px" }, [
        btn("Initialize Firebase", { variant: "primary", onclick: async () => { setMode("cloud"); await initCloud(); draw(); } }),
        btn("Log Diagnostics", { onclick: () => { logFirebaseDiagnostics("settings-diagnostics"); toast("Firebase diagnostics written to console.", "success"); } })
      ])
    ]));
    panel.appendChild(card("Realtime Database Rules Diagnostic", [
      el("p", { class: missingRules.length ? "muted danger" : "muted", text: missingRules.length ? `Missing diagnostic entries: ${missingRules.join(", ")}` : "All app Firestore collections have explicit diagnostic coverage." }),
      table([
        { label: "Collection", key: "collection" },
        { label: "Rule Exists?", key: "exists" },
        { label: "Read Access", key: "read" },
        { label: "Write Access", key: "write" },
        { label: "Role Restriction", key: "role" },
        { label: "Sync Status", key: "sync" }
      ], reportRows, { empty: "No Firestore collections configured." })
    ]));
  };
  draw();
  const offs = [
    db.on("userRoles", draw),
    db.on("settings", draw),
    () => window.removeEventListener("sync:queue", draw)
  ];
  window.addEventListener("sync:queue", draw);
  window.addEventListener("net:change", draw);
  offs.push(() => window.removeEventListener("net:change", draw));
  return () => offs.forEach((off) => { if (typeof off === "function") off(); });
}

function familyDiscounts(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const s = db.setting("familyDiscount") || {};
    const tiers = Array.isArray(s.tiers) && s.tiers.length ? s.tiers : [
      { minChildren: 3, percent: 5 },
      { minChildren: 4, percent: 10 },
      { minChildren: 5, percent: 15 }
    ];
    const minChildren = input({ type: "number", min: 1, value: s.freeTuitionMinChildren || 5 });
    const enabled = el("input", { type: "checkbox", checked: s.freeTuitionEnabled !== false });
    const beneficiaryMode = select(() => [
      { value: "lowest", label: "Lowest Tuition Child", selected: (s.freeTuitionBeneficiaryMode || "lowest") === "lowest" },
      { value: "manual", label: "Manual Per Family", selected: s.freeTuitionBeneficiaryMode === "manual" }
    ]);
    const tierRows = tiers.map((t) => ({
      min: input({ type: "number", min: 1, value: t.minChildren }),
      pct: input({ type: "number", min: 0, max: 100, value: t.percent })
    }));
    const tierBox = el("div", { class: "form-grid" });
    tierRows.forEach((r, idx) => {
      tierBox.append(field(`Tier ${idx + 1} Minimum Children`, r.min));
      tierBox.append(field(`Tier ${idx + 1} Discount %`, r.pct));
    });
    const c = card("Family Discount Policy", [
      el("p", { class: "muted", text: "Controls automatic sibling/family tuition discounts used by invoice calculations. Existing student records are not changed." }),
      el("div", { class: "form-grid" }, [
        field("Enable Tuition Waiver", el("label", { class: "row" }, [enabled, el("span", { text: "Apply free tuition rule" })])),
        field("Minimum Children for Tuition Waiver", minChildren),
        field("Waiver Beneficiary", beneficiaryMode)
      ]),
      el("h4", { text: "Percentage Discount Tiers" }),
      tierBox
    ]);
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("Save Family Discount Policy", {
      variant: "primary", onclick: () => {
        db.saveSetting("familyDiscount", {
          freeTuitionEnabled: enabled.checked,
          freeTuitionMinChildren: num(minChildren.value) || 5,
          freeTuitionBeneficiaryMode: beneficiaryMode.value,
          tiers: tierRows.map((r) => ({ minChildren: num(r.min.value), percent: num(r.pct.value) })).filter((r) => r.minChildren > 0 && r.percent >= 0)
        });
        toast("Family discount policy saved", "success");
      }
    })]));
    panel.appendChild(c);
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function attendance(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const s = attendanceSettings();
    const official = input({ type: "time", value: s.officialResumptionTime });
    const penalty1 = input({ type: "number", min: 0, value: s.latePenalty1 });
    const penalty2 = input({ type: "number", min: 0, value: s.latePenalty2 });
    const method = select(() => [
      { value: "basic", label: "Basic Salary Only", selected: s.dailySalaryMethod === "basic" },
      { value: "gross", label: "Basic + Allowances", selected: s.dailySalaryMethod === "gross" }
    ]);
    const workingDays = input({ type: "number", min: 1, value: s.workingDaysPerMonth });
    const c = card("Attendance Settings", [
      el("div", { class: "form-grid" }, [
        field("Official Resumption Time", official),
        field("Late Penalty 1 (Naira)", penalty1),
        field("Late Penalty 2 (Naira)", penalty2),
        field("Daily Salary Calculation Method", method),
        field("Working Days Per Month", workingDays)
      ])
    ]);
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("Save Attendance Settings", {
      variant: "primary", onclick: () => {
        db.saveSetting("attendanceSettings", {
          officialResumptionTime: official.value || "07:45",
          latePenalty1: num(penalty1.value),
          latePenalty2: num(penalty2.value),
          dailySalaryMethod: method.value,
          workingDaysPerMonth: num(workingDays.value) || 30
        });
        toast("Attendance settings saved", "success");
      }
    })]));
    panel.appendChild(c);
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function branding(panel, ctx) {
  const draw = () => {
    panel.innerHTML = "";
    const b = getBranding();
    const f = {
      schoolName: input({ value: b.schoolName }), arabicName: input({ value: b.arabicName || b.schoolNameArabic || "" }), motto: input({ value: b.motto }), address: input({ value: b.address }),
      phone: input({ value: b.phone }), email: input({ value: b.email }), website: input({ value: b.website || "" }),
      principalName: input({ value: b.principalName || "" }), headTeacherName: input({ value: b.headTeacherName || "" })
    };
    const logoPrev = el("div", { class: "passport-drop", style: "width:120px;height:120px" });
    logoPrev.innerHTML = b.logoBase64 ? `<img src="${b.logoBase64}">` : "Upload Logo";
    const logoInp = input({ type: "file", accept: "image/*", style: "display:none" });
    logoPrev.onclick = () => logoInp.click();
    let newLogo = null;
    logoInp.onchange = async () => { if (logoInp.files[0]) { newLogo = await readFileAsDataURL(logoInp.files[0]); logoPrev.innerHTML = `<img src="${newLogo}">`; } };
    const c = card("School Profile & Branding", [
      el("div", { class: "row", style: "align-items:flex-start;gap:20px" }, [
        el("div", {}, [field("School Logo", logoPrev), logoInp, el("div", { class: "muted", style: "font-size:11px;max-width:120px", text: "Appears on every printed document." })]),
        el("div", { class: "form-grid", style: "flex:1" }, [
          field("School Name", f.schoolName, { full: true }), field("Arabic Name", f.arabicName, { full: true }), field("Motto", f.motto, { full: true }), field("Address", f.address, { full: true }),
          field("Phone", f.phone), field("Email", f.email), field("Website", f.website), field("Principal / Director Name", f.principalName), field("Head Teacher Name", f.headTeacherName)
        ])
      ])
    ]);
    const createImgUpload = (key, label, defaultText) => {
      const prev = el("div", { class: "passport-drop", style: "width:120px;height:120px" });
      prev.innerHTML = b[key] ? `<img src="${b[key]}">` : defaultText;
      const inp = input({ type: "file", accept: "image/*", style: "display:none" });
      prev.onclick = () => inp.click();
      let newImg = null;
      inp.onchange = async () => { if (inp.files[0]) { newImg = await readFileAsDataURL(inp.files[0]); prev.innerHTML = `<img src="${newImg}">`; } };
      return { prev, inp, get: () => newImg };
    };

    const stampUpload = createImgUpload("stamp", "School Stamp", "Upload Stamp");
    const watermarkUpload = createImgUpload("watermarkLogo", "Watermark", "Upload Watermark");
    const prinSigUpload = createImgUpload("principalSignatureImg", "Principal Signature", "Upload Sig");
    const propSigUpload = createImgUpload("proprietorSignatureImg", "Proprietor Signature", "Upload Sig");
    const classSigUpload = createImgUpload("classTeacherSignatureImg", "Teacher Signature", "Upload Sig");

    const certThemes = {
      certificateThemePrimary: input({ type: "color", value: b.certificateThemePrimary || "#003366" }),
      certificateThemeSecondary: input({ type: "color", value: b.certificateThemeSecondary || "#d4af37" }),
      watermarkOpacity: select(() => [
        { value: "5", label: "5%", selected: b.watermarkOpacity == "5" },
        { value: "10", label: "10%", selected: b.watermarkOpacity == "10" },
        { value: "15", label: "15%", selected: b.watermarkOpacity == "15" },
        { value: "20", label: "20%", selected: b.watermarkOpacity == "20" },
        { value: "25", label: "25%", selected: b.watermarkOpacity == "25" }
      ])
    };
    const testTemplate = el("textarea", { class: "inp", style: "height:150px;width:100%" });
    testTemplate.value = b.testimonialTemplate || "";

    const certCard = card("Certificate Engine Settings", [
      el("div", { class: "form-grid" }, [
        field("Theme Primary Color", certThemes.certificateThemePrimary),
        field("Theme Secondary (Gold)", certThemes.certificateThemeSecondary),
        field("Watermark Opacity", certThemes.watermarkOpacity)
      ]),
      el("div", { class: "row", style: "gap: 20px; flex-wrap: wrap; margin-top: 15px;" }, [
        el("div", {}, [field("School Stamp", stampUpload.prev), stampUpload.inp]),
        el("div", {}, [field("Watermark Logo", watermarkUpload.prev), watermarkUpload.inp]),
        el("div", {}, [field("Principal Signature", prinSigUpload.prev), prinSigUpload.inp]),
        el("div", {}, [field("Proprietor Signature", propSigUpload.prev), propSigUpload.inp]),
        el("div", {}, [field("Teacher Signature", classSigUpload.prev), classSigUpload.inp])
      ]),
      el("div", { style: "margin-top: 15px;" }, [
        field("Testimonial Certification Template (Variables: {{student_name}}, {{school_name}}, etc.)", testTemplate)
      ])
    ]);

    const saveBtnContainer = el("div", { class: "row", style: "margin-top:12px; gap:10px" });
    saveBtnContainer.appendChild(btn("Save Settings", {
      variant: "primary", onclick: () => {
        const vals = {}; Object.keys(f).forEach((k) => vals[k] = f[k].value);
        if (newLogo) vals.logoBase64 = newLogo;

        // Certificate fields
        Object.keys(certThemes).forEach(k => vals[k] = certThemes[k].value);
        vals.testimonialTemplate = testTemplate.value;

        if (stampUpload.get()) vals.stamp = stampUpload.get();
        if (watermarkUpload.get()) vals.watermarkLogo = watermarkUpload.get();
        if (prinSigUpload.get()) vals.principalSignatureImg = prinSigUpload.get();
        if (propSigUpload.get()) vals.proprietorSignatureImg = propSigUpload.get();
        if (classSigUpload.get()) vals.classTeacherSignatureImg = classSigUpload.get();

        saveBranding(vals);
        const side = document.getElementById("side-logo"); if (side && (newLogo || b.logoBase64)) side.src = newLogo || b.logoBase64;
        toast("Settings saved", "success");
      }
    }));

    c.appendChild(el("div", { style: "margin-top: 15px;" }, [])); // Spacer
    panel.appendChild(c);
    panel.appendChild(certCard);
    panel.appendChild(saveBtnContainer);
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function listEditor(panel, { title, settingKey, collection, getList, setList, columns, makeForm, blank }) {
  const draw = () => {
    const list = getList();
    panel.innerHTML = "";
    const c = card(title, [table([...columns, {
      label: "", render: (r) => el("div", { class: "row" }, [
        btn("Edit", { sm: true, onclick: () => openForm(r) }),
        btn("\u2715", {
          sm: true, variant: "danger", onclick: async () => {
            if (await confirmDialog("Delete this entry?", { danger: true, okText: "Delete" })) {
              if (collection) {
                db.remove(collection, r.id);
                toast("Deleted", "success");
                draw();
              } else {
                setList(list.filter((x) => x.id !== r.id));
                draw();
              }
            }
          }
        })
      ])
    }], list, { empty: "Nothing configured yet." })], btn("Add", { variant: "primary", sm: true, onclick: () => openForm(null) }));
    panel.appendChild(c);
  };
  function openForm(rec) {
    makeForm(rec, (saved) => {
      if (collection) {
        db.save(collection, saved);
        toast("Saved", "success");
        draw();
      } else {
        const list = getList();
        const i = list.findIndex((x) => x.id === saved.id);
        if (i >= 0) list[i] = saved; else list.push(saved);
        setList(list);
        draw();
      }
    });
  }
  draw();
  const off = collection ? db.on(collection, draw) : db.on("settings", draw);
  return () => off();
}

function sections(panel) {
  listEditor(panel, {
    title: "Sections", collection: "sections",
    getList: () => cfg.sections().slice(),
    columns: [{ label: "Name", key: "name" }, { label: "Type", key: "type" }, { label: "Order", key: "order" }],
    makeForm: (rec, done) => {
      const name = input({ value: rec?.name || "" });
      const type = select(() => ["western", "islamiyya", "tahfiz"].map((t) => ({ value: t, label: t, selected: rec?.type === t })));
      const order = input({ type: "number", value: rec?.order || (cfg.sections().length + 1) });
      const m = modalForm("Section", [field("Name", name), field("Type", type), field("Order", order)], () => {
        if (!name.value.trim()) return toast("Name required", "error");
        done({ id: rec?.id || slug(name.value), name: name.value, type: type.value, order: num(order.value), active: true }); m.close();
      });
    }
  });
}

function classes(panel) {
  listEditor(panel, {
    title: "Classes", collection: "classes",
    getList: () => cfg.classes().slice(),
    columns: [{ label: "Class", key: "name" }, { label: "Section", render: (r) => cfg.sectionName(r.section_id || r.sectionId) }, { label: "Order", key: "order" }],
    makeForm: (rec, done) => {
      const name = input({ value: rec?.name || "" });
      const sec = select(() => cfg.sections().map((s) => ({ value: s.id, label: s.name, selected: (rec?.section_id || rec?.sectionId) === s.id })));
      const order = input({ type: "number", value: rec?.order || 1 });
      const m = modalForm("Class", [field("Class Name", name), field("Section", sec), field("Order", order)], () => {
        if (!name.value.trim()) return toast("Name required", "error");
        done({ id: rec?.id || (sec.value + ":" + slug(name.value)), name: name.value, section_id: sec.value, order: num(order.value), active: true }); m.close();
      });
    }
  });
}

function services(panel) {
  listEditor(panel, {
    title: "Services", getList: () => ((db.setting("services") || {}).list || []).slice(),
    setList: (list) => { db.saveSetting("services", { list }); toast("Services saved", "success"); },
    columns: [{ label: "Service", key: "name" }, { label: "Type", key: "type" }, { label: "Optional", render: (r) => r.optional ? "Yes" : "No" }],
    makeForm: (rec, done) => {
      const name = input({ value: rec?.name || "" });
      const optional = select(() => [{ value: "no", label: "Required", selected: !rec?.optional }, { value: "yes", label: "Optional", selected: rec?.optional }]);
      const inputs = {};
      const priceFields = cfg.sections().map((s) => { inputs[s.id] = input({ type: "number", value: rec?.prices?.[s.id] || 0 }); return field(s.name + " Price", inputs[s.id]); });
      const m = modalForm("Service", [field("Service Name", name), field("Requirement", optional), ...priceFields], () => {
        if (!name.value.trim()) return toast("Name required", "error");
        const prices = {}; Object.keys(inputs).forEach((k) => { if (num(inputs[k].value) > 0) prices[k] = num(inputs[k].value); });
        done({ id: rec?.id || ("svc-" + slug(name.value)), name: name.value, optional: optional.value === "yes", type: rec?.type || "fee", active: true, prices }); m.close();
      }, "lg");
    }
  });
}

function programs(panel) {
  const refreshProgramInvoices = async () => {
    for (const student of db.list("students").filter((s) => s.status !== "graduated" && s.status !== "withdrawn")) {
      await syncStudentProgramInvoice(student, { term: cfg.currentTerm(), session: cfg.currentSession() });
    }
  };
  listEditor(panel, {
    title: "Program Management",
    getList: () => ((db.setting("programs") || {}).list || []).slice(),
    setList: (list) => { db.saveSetting("programs", { list }); refreshProgramInvoices(); toast("Programs saved", "success"); },
    columns: [
      { label: "Program", key: "name" },
      { label: "Fee", align: "right", render: (r) => naira(r.fee) },
      { label: "Session", render: (r) => r.session || "All Sessions" },
      { label: "Term", render: (r) => r.term || "All Terms" },
      { label: "Status", key: "status" }
    ],
    makeForm: (rec, done) => {
      const name = input({ value: rec?.name || "" });
      const fee = input({ type: "number", value: rec?.fee || 0 });
      const section = select(() => [{ value: "", label: "No linked section" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name, selected: rec?.sectionId === s.id || rec?.id === s.id }))]);
      const session = input({ value: rec?.session || "All Sessions" });
      const term = select(() => ["All Terms", ...(cfg.sessions().terms || ["First Term", "Second Term", "Third Term"])].map((t) => ({ value: t, label: t, selected: (rec?.term || "All Terms") === t })));
      const status = select(() => ["Active", "Inactive"].map((s) => ({ value: s, label: s, selected: (rec?.status || "Active") === s })));
      const order = input({ type: "number", value: rec?.order || (((db.setting("programs") || {}).list || []).length + 1) });
      const m = modalForm("Program", [
        field("Program Name", name, { full: true }),
        field("Program Fee (Naira)", fee),
        field("Linked Section", section),
        field("Session", session),
        field("Term", term),
        field("Status", status),
        field("Order", order)
      ], () => {
        if (!name.value.trim()) return toast("Program name required", "error");
        done({
          id: rec?.id || slug(name.value),
          name: name.value.trim(),
          fee: num(fee.value),
          sectionId: section.value,
          session: session.value.trim() || "All Sessions",
          term: term.value || "All Terms",
          status: status.value,
          order: num(order.value),
          active: status.value === "Active"
        });
        m.close();
      }, "md");
    }
  });
}

function schoolAccountDetails(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const acct = cfg.schoolAccount();
    const bankName = input({ value: acct.bankName || "" });
    const accountName = input({ value: acct.accountName || "" });
    const accountNumber = input({ value: acct.accountNumber || "" });
    const branch = input({ value: acct.branch || "" });
    const referenceInstruction = input({ value: acct.referenceInstruction || "Use Admission Number as Payment Reference" });
    const feePaymentDeadline = input({ type: "date", value: acct.feePaymentDeadline || "" });
    const c = card("School Account Details", [
      el("p", { class: "muted", text: "These payment details appear at the bottom of every invoice and PDF." }),
      el("div", { class: "form-grid" }, [
        field("Bank Name", bankName),
        field("Account Name", accountName),
        field("Account Number", accountNumber),
        field("Branch (Optional)", branch),
        field("Reference Instruction", referenceInstruction, { full: true }),
        field("Fee Payment Deadline", feePaymentDeadline)
      ])
    ]);
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("Save Account Details", {
      variant: "primary", onclick: () => {
        db.saveSetting("schoolAccount", {
          bankName: bankName.value.trim(),
          accountName: accountName.value.trim(),
          accountNumber: accountNumber.value.trim(),
          branch: branch.value.trim(),
          referenceInstruction: referenceInstruction.value.trim(),
          feePaymentDeadline: feePaymentDeadline.value
        });
        toast("School account details saved", "success");
      }
    })]));
    panel.appendChild(c);
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function schoolSignatures(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const sig = cfg.schoolSignatures();
    const proprietorName = input({ value: sig.proprietorName || "" });
    const directorName = input({ value: sig.directorName || "" });
    const contactPhone = input({ value: sig.contactPhone || "" });
    let proprietorSignature = sig.proprietorSignature || "";
    let directorSignature = sig.directorSignature || "";
    let principalSignature = sig.principalSignature || "";
    const proprietorPrev = signatureBox("Proprietor Signature", proprietorSignature);
    const directorPrev = signatureBox("Director Signature", directorSignature);
    const principalPrev = signatureBox("Principal Signature", principalSignature);
    const proprietorInp = input({ type: "file", accept: "image/*", style: "display:none" });
    const directorInp = input({ type: "file", accept: "image/*", style: "display:none" });
    const principalInp = input({ type: "file", accept: "image/*", style: "display:none" });
    proprietorPrev.onclick = () => proprietorInp.click();
    directorPrev.onclick = () => directorInp.click();
    principalPrev.onclick = () => principalInp.click();
    proprietorInp.onchange = async () => {
      if (proprietorInp.files[0]) {
        proprietorSignature = await readFileAsDataURL(proprietorInp.files[0]);
        proprietorPrev.innerHTML = `<img src="${proprietorSignature}" style="max-width:100%;max-height:100%;object-fit:contain">`;
      }
    };
    directorInp.onchange = async () => {
      if (directorInp.files[0]) {
        directorSignature = await readFileAsDataURL(directorInp.files[0]);
        directorPrev.innerHTML = `<img src="${directorSignature}" style="max-width:100%;max-height:100%;object-fit:contain">`;
      }
    };
    principalInp.onchange = async () => {
      if (principalInp.files[0]) {
        principalSignature = await readFileAsDataURL(principalInp.files[0]);
        principalPrev.innerHTML = `<img src="${principalSignature}" style="max-width:100%;max-height:100%;object-fit:contain">`;
      }
    };
    const c = card("School Signatures", [
      el("p", { class: "muted", text: "Uploads are stored as Base64 in local data and synced through the existing settings workflow. Firebase Storage is not used." }),
      el("div", { class: "form-grid" }, [
        field("Proprietor Name", proprietorName),
        field("Proprietor Signature", el("div", {}, [proprietorPrev, proprietorInp])),
        field("Director Name", directorName),
        field("Director Signature", el("div", {}, [directorPrev, directorInp])),
        field("Contact Phone", contactPhone),
        field("Principal Signature", el("div", {}, [principalPrev, principalInp]))
      ])
    ]);
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [
      btn("Save Signatures", {
        variant: "primary", onclick: () => {
          db.saveSetting("schoolSignatures", {
            ...sig,
            proprietorName: proprietorName.value.trim(),
            proprietorSignature,
            directorName: directorName.value.trim(),
            directorSignature,
            contactPhone: contactPhone.value.trim(),
            principalSignature
          });
          toast("School signatures saved", "success");
        }
      }),
      btn("Clear", {
        onclick: () => {
          proprietorSignature = "";
          directorSignature = "";
          principalSignature = "";
          db.saveSetting("schoolSignatures", {
            ...sig,
            proprietorName: proprietorName.value.trim(),
            proprietorSignature,
            directorName: directorName.value.trim(),
            directorSignature,
            contactPhone: contactPhone.value.trim(),
            principalSignature
          });
          toast("School signatures cleared", "success");
          draw();
        }
      })
    ]));
    panel.appendChild(c);
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function signatureBox(label, dataUrl) {
  const box = el("div", {
    class: "passport-drop",
    style: "width:220px;height:90px;display:flex;align-items:center;justify-content:center;cursor:pointer"
  });
  box.innerHTML = dataUrl ? `<img src="${dataUrl}" style="max-width:100%;max-height:100%;object-fit:contain">` : `Upload ${label}`;
  return box;
}

function fees(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const svcs = cfg.services().filter((s) => s.type === "fee");
    const secs = cfg.sections();
    const table = el("table", { class: "tbl" });
    const head = el("tr", {}, [el("th", { text: "Service" }), ...secs.map((s) => el("th", { text: s.name, style: "text-align:right" }))]);
    table.appendChild(el("thead", {}, [head]));
    const tb = el("tbody");
    const inputs = {};
    svcs.forEach((svc) => {
      const tr = el("tr", {}, [el("td", { text: svc.name })]);
      secs.forEach((s) => { const inp = input({ type: "number", value: svc.prices?.[s.id] || 0, style: "width:100px" }); inputs[svc.id + "|" + s.id] = inp; tr.appendChild(el("td", { style: "text-align:right" }, [inp])); });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    const c = card("Section-Specific Fees", [el("div", { class: "table-wrap" }, [table])]);
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("Save Fees", {
      variant: "primary", onclick: () => {
        const list = (db.setting("services") || {}).list || [];
        list.forEach((svc) => { if (svc.type !== "fee") return; svc.prices = svc.prices || {}; secs.forEach((s) => { const v = num(inputs[svc.id + "|" + s.id]?.value); if (v > 0) svc.prices[s.id] = v; else delete svc.prices[s.id]; }); });
        db.saveSetting("services", { list }); toast("Fees saved", "success");
      }
    })]));
    panel.appendChild(c);
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function uniforms(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const legacy = (db.setting("uniforms") || { bySection: {} }).bySection || {};
    const settings = db.setting("uniformItems") || { list: [], setPriceBySection: {} };
    const setPriceBySection = { ...(settings.setPriceBySection || {}) };
    const priceInputs = {};

    const setRows = cfg.sections().map((s) => {
      priceInputs[s.id] = input({ type: "number", min: 0, value: setPriceBySection[s.id] || legacy[s.id]?.["One Set"] || 0, style: "width:120px" });
      return el("div", { class: "svc-row" }, [el("span", { class: "nm", text: s.name }), priceInputs[s.id]]);
    });

    const header = card("Uniform Management", [
      el("p", { class: "muted", text: "Configure the base price for one uniform set, then add optional uniform items. Registration multiplies the set price by the selected quantity and invoices each additional item separately." }),
      el("div", { style: "font-weight:700;margin:8px 0", text: "One Set Uniform Price" }),
      ...setRows
    ]);
    header.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [
      btn("Save Set Prices", {
        variant: "primary", onclick: () => {
          const nextSetPrices = {};
          const bySection = {};
          cfg.sections().forEach((sec) => {
            const one = num(priceInputs[sec.id].value);
            nextSetPrices[sec.id] = one;
            bySection[sec.id] = { "One Set": one, "Two Sets": one * 2, "Three Sets": one * 3 };
          });
          db.saveSetting("uniformItems", { ...settings, list: settings.list || [], setPriceBySection: nextSetPrices });
          db.saveSetting("uniforms", { bySection });
          toast("Uniform set prices saved", "success");
        }
      }),
      btn("Load Default Items", {
        onclick: async () => {
          if (uniformCatalog().length && !(await confirmDialog("Add default uniform items to the existing catalogue?"))) return;
          const existing = (db.setting("uniformItems") || {}).list || [];
          const seen = new Set(existing.map((i) => i.id));
          const list = [...existing, ...defaultUniformItems().filter((i) => !seen.has(i.id))];
          db.saveSetting("uniformItems", { ...settings, list, setPriceBySection });
          toast("Default uniform items loaded", "success");
        }
      })
    ]));
    panel.appendChild(header);

    const addBtn = btn("+ Add Uniform Item", { variant: "primary", onclick: () => openUniformForm(null, draw) });
    panel.appendChild(card("Additional Uniform Items", [
      uniformManagementPanel({
        onEdit: (item) => openUniformForm(item, draw),
        onDelete: async (item) => {
          if (!(await confirmDialog(`Delete "${item.name}"?`, { danger: true, okText: "Delete" }))) return;
          const cur = db.setting("uniformItems") || { list: [], setPriceBySection };
          db.saveSetting("uniformItems", { ...cur, list: (cur.list || []).filter((i) => i.id !== item.id) });
          toast("Uniform item deleted", "success");
          draw();
        }
      })
    ], addBtn));
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function openUniformForm(existing, onSaved) {
  const nameInp = input({ value: existing?.name || "", placeholder: "e.g. Sports Wear" });
  const categoryInp = input({ value: existing?.category || "Additional Uniform Items", placeholder: "e.g. Wear, Accessories" });
  const priceInp = input({ type: "number", min: 0, value: existing?.price || 0 });
  const statusSel = select(() => [
    { value: "active", label: "Active", selected: (existing?.status || "active") === "active" },
    { value: "inactive", label: "Inactive", selected: existing?.status === "inactive" }
  ]);
  const secBox = el("div", { class: "chip-select" });
  const classBox = el("div", { class: "chip-select" });
  const sectionChecks = {};
  const classChecks = {};

  cfg.sections().forEach((sec) => {
    const cb = input({ type: "checkbox", style: "display:none" });
    cb.checked = (existing?.sectionIds || []).includes(sec.id);
    sectionChecks[sec.id] = cb;
    const chip = el("label", { class: "chip" + (cb.checked ? " sel" : "") }, [cb, document.createTextNode(sec.name)]);
    chip.onclick = (e) => { e.preventDefault(); cb.checked = !cb.checked; chip.classList.toggle("sel", cb.checked); refreshClasses(); };
    secBox.appendChild(chip);
  });

  function refreshClasses() {
    classBox.innerHTML = "";
    const activeSections = Object.keys(sectionChecks).filter((id) => sectionChecks[id].checked);
    const classes = cfg.classes().filter((cl) => !activeSections.length || activeSections.includes(cl.sectionId));
    classes.forEach((cl) => {
      const cb = input({ type: "checkbox", style: "display:none" });
      cb.checked = (existing?.classIds || []).includes(cl.id);
      classChecks[cl.id] = cb;
      const chip = el("label", { class: "chip" + (cb.checked ? " sel" : "") }, [cb, document.createTextNode(`${cfg.className(cl.id)} (${cfg.sectionName(cl.sectionId)})`)]);
      chip.onclick = (e) => { e.preventDefault(); cb.checked = !cb.checked; chip.classList.toggle("sel", cb.checked); };
      classBox.appendChild(chip);
    });
  }
  refreshClasses();

  const body = el("div", { class: "form-grid" }, [
    field("Item Name", nameInp, { full: true }),
    field("Category", categoryInp),
    field("Price (Naira)", priceInp),
    field("Status", statusSel),
    field("Applicable Sections (leave blank for all)", secBox, { full: true }),
    field("Applicable Classes (leave blank for all)", classBox, { full: true })
  ]);
  const saveBtn = btn("Save Uniform Item", {
    variant: "primary", onclick: () => {
      if (!nameInp.value.trim()) return toast("Item name is required", "error");
      const current = db.setting("uniformItems") || { list: [], setPriceBySection: {} };
      const record = makeUniformRecord(existing, {
        name: nameInp.value.trim(), category: categoryInp.value.trim(), price: priceInp.value, status: statusSel.value,
        sectionIds: Object.keys(sectionChecks).filter((id) => sectionChecks[id].checked),
        classIds: Object.keys(classChecks).filter((id) => classChecks[id].checked)
      });
      const list = (current.list || []).slice();
      const idx = list.findIndex((i) => i.id === record.id);
      if (idx >= 0) list[idx] = record; else list.push(record);
      db.saveSetting("uniformItems", { ...current, list });
      toast("Uniform item saved", "success");
      m.close();
      onSaved();
    }
  });
  const cancelBtn = btn("Cancel", { onclick: () => m.close() });
  const m = modal({ title: existing ? "Edit Uniform Item" : "Add Uniform Item", size: "lg", body, footer: [cancelBtn, saveBtn] });
}
function books(panel) {
  const draw = () => {
    panel.innerHTML = "";
    // Legacy per-section book charge (still used as fallback if no individual books configured)
    const data = (db.setting("books") || { bySection: {} }).bySection;
    const inputs = {};
    const rows = cfg.sections().map((s) => { inputs[s.id] = input({ type: "number", value: data[s.id] || 0 }); return field(s.name + " Books Charge (\u20A6)", inputs[s.id]); });
    const note = el("p", { class: "muted", style: "margin-top:8px;font-size:12px", text: "Tip: Use the \'Bookshop\' tab to manage individual books with titles, classes and stock." });
    const c = card("Legacy Book Charges (per Section)", [el("div", { class: "form-grid" }, rows), note]);
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("Save Books", {
      variant: "primary", onclick: () => {
        const bySection = {}; cfg.sections().forEach((s) => bySection[s.id] = num(inputs[s.id].value)); db.saveSetting("books", { bySection }); toast("Books saved", "success");
      }
    })]));
    panel.appendChild(c);
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function bookshopCatalogue(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const header = card("Bookshop Catalogue", [
      el("p", { class: "muted", text: "Manage individual books with titles, prices, and stock. These appear during admission and registration for per-book selection." })
    ]);
    panel.appendChild(header);

    const addBtn = btn("+ Add Book", { variant: "primary", onclick: () => openBookForm(null, draw) });
    const filterSec = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map(s => ({ value: s.id, label: s.name }))]);
    filterSec.onchange = draw;
    panel.appendChild(el("div", { class: "row", style: "margin-bottom:12px;gap:8px" }, [addBtn, filterSec]));

    let books = db.query("books", () => true).sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    if (filterSec.value) books = books.filter(b => b.sectionId === filterSec.value);

    panel.appendChild(card("", [table([
      { label: "Title", key: "title" },
      { label: "Subject", render: b => b.subject || b.category || "-" },
      { label: "Section", render: b => cfg.sectionName(b.sectionId) || "All" },
      { label: "Class", render: b => b.classId ? cfg.className(b.classId) : "All" },
      { label: "Price", align: "right", render: b => naira(b.sellingPrice || b.price) },
      {
        label: "Stock", align: "right", render: b => {
          const s = num(b.stock);
          return el("span", { style: s <= num(b.reorderLevel || 5) ? "color:var(--danger);font-weight:600" : "", text: String(s) });
        }
      },
      {
        label: "", render: b => el("div", { class: "row", style: "gap:4px" }, [
          btn("Edit", { sm: true, variant: "ghost", onclick: () => openBookForm(b, draw) }),
          btn("Del", {
            sm: true, variant: "danger", onclick: () => {
              confirmDialog(`Delete "${b.title}"?`, () => { db.delete("books", b.id); toast("Deleted", "success"); draw(); });
            }
          })
        ])
      }
    ], books, { empty: "No books yet. Click '+ Add Book'." })]));
  };
  draw();
  const off = db.on("books", draw);
  return () => off();
}

function smsGateway(panel) {
  const draw = () => {
    panel.innerHTML = "";
    function renderSmsConfig() {
      panel.innerHTML = "";
      const s = db.setting("smsGateway") || {};

      const apiKeyInput = input({ value: s.apiKey || "", type: "password", placeholder: "Termii API Key (TL....................)" });

      const senderId = input({ value: s.senderId || "CIC KANO", placeholder: "Sender ID (e.g. CIC KANO)" });

      const autoAdmission = el("input", { type: "checkbox", checked: !!s.autoAdmission });
      const autoInvoice = el("input", { type: "checkbox", checked: !!s.autoInvoice });
      const autoPayment = el("input", { type: "checkbox", checked: !!s.autoPayment });
      const autoExam = el("input", { type: "checkbox", checked: !!s.autoExam });

      const testPhone = input({ placeholder: "Test Phone No (234...)" });
      const testBtn = btn("Test Send", {
        onclick: async () => {
          if (!testPhone.value) return toast("Enter test phone", "warning");
          toast("Sending test SMS...", "info");
          try {
            const smsReq = await fetch("/.netlify/functions/sendsms", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ to: testPhone.value, message: "Test SMS from CIC KANO SYSTEM.", senderId: senderId.value, apiKey: apiKeyInput.value })
            });
            const result = await smsReq.json();
            if (smsReq.ok) {
              toast("Test SMS Sent successfully!", "success");
            } else {
              toast("Failed: " + result.error, "error");
            }
          } catch (err) {
            toast("Request failed: " + err.message, "error");
          }
        }
      });

      const balanceBtn = btn("Check SMS Balance", {
        variant: "ghost", onclick: async () => {
          try {
            toast("Checking balance via secure backend...", "info");
            const res = await fetch("/.netlify/functions/termii", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "balance", payload: {}, apiKey: apiKeyInput.value })
            });
            if (res.status === 404) throw new Error("termii function not deployed. Using generic sendSMS.");
            const data = await res.json();
            if (data.balance !== undefined) {
              toast(`Current SMS Balance: ${data.currency || 'NGN'} ${data.balance}`, "success", 6000);
            } else {
              toast("Balance Check Failed: " + (data.error || "Unknown error"), "error");
            }
          } catch (err) {
            toast("Balance Check Failed: " + err.message, "error");
          }
        }
      });

      const c = card("Termii SMS Configuration", [
        el("p", { class: "muted", text: "Configure Termii SMS Gateway API to enable bulk messaging and automatic notifications. (Direct API requests are blocked by CORS, so requests are routed through the secure Netlify backend)." }),
        el("div", { class: "form-grid" }, [
          field("Termii API Key", apiKeyInput, { full: true }),
          field("Sender ID", senderId),
          field("Actions", el("div", { class: "row", style: "gap:8px" }, [testPhone, testBtn, balanceBtn]))
        ]),
        el("h4", { text: "Automation", style: "margin-top: 24px" }),
        el("div", { class: "form-grid" }, [
          field("Admission Created", el("label", { class: "row" }, [autoAdmission, el("span", { text: "Auto SMS to parent when student is admitted" })])),
          field("Invoice Generated", el("label", { class: "row" }, [autoInvoice, el("span", { text: "Auto SMS when an invoice is generated" })])),
          field("Payment Received", el("label", { class: "row" }, [autoPayment, el("span", { text: "Auto SMS when payment is receipted" })])),
          field("Exam Reminder", el("label", { class: "row" }, [autoExam, el("span", { text: "Auto SMS reminder for pending fees before exams" })]))
        ]),
        el("div", { class: "row", style: "margin-top:16px" }, [
          btn("Save SMS Settings", {
            variant: "success", onclick: () => {
              db.saveSetting("smsGateway", {
                apiKey: apiKeyInput.value,
                senderId: senderId.value,
                autoAdmission: autoAdmission.checked,
                autoInvoice: autoInvoice.checked,
                autoPayment: autoPayment.checked,
                autoExam: autoExam.checked
              });
              toast("SMS Settings saved.", "success");
            }
          })
        ])
      ]);
      panel.appendChild(c);
    }
    renderSmsConfig();
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function openBookForm(existing, onSaved) {
  const titleInp = input({ value: existing?.title || "", placeholder: "e.g. Mathematics Textbook SS1" });
  const subjectInp = input({ value: existing?.subject || existing?.category || "", placeholder: "e.g. Mathematics" });
  const isbnInp = input({ value: existing?.isbn || "", placeholder: "ISBN (optional)" });
  const authorInp = input({ value: existing?.author || "", placeholder: "Author" });
  const publisherInp = input({ value: existing?.publisher || "", placeholder: "Publisher" });
  const costInp = input({ type: "number", value: existing?.costPrice || 0, min: 0 });
  const priceInp = input({ type: "number", value: existing?.sellingPrice || existing?.price || 0, min: 0 });
  const stockInp = input({ type: "number", value: existing?.stock || 0, min: 0 });
  const reorderInp = input({ type: "number", value: existing?.reorderLevel || 5, min: 0 });
  const statusSel = select(() => [
    { value: "available", label: "Available", selected: (existing?.status || "available") === "available" },
    { value: "out_of_stock", label: "Out of Stock", selected: existing?.status === "out_of_stock" },
    { value: "inactive", label: "Inactive", selected: existing?.status === "inactive" }
  ]);
  const sectionSel = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map(s => ({
    value: s.id, label: s.name, selected: s.id === existing?.sectionId
  }))]);
  const classSel = select(() => [{ value: "", label: "All Classes" }]);
  const fillClasses = () => {
    classSel.innerHTML = "";
    classSel.appendChild(el("option", { value: "", text: "All Classes" }));
    cfg.classes(sectionSel.value).forEach(c =>
      classSel.appendChild(el("option", { value: c.id, text: c.name, selected: c.id === existing?.classId }))
    );
    if (existing?.classId) classSel.value = existing.classId;
  };
  sectionSel.onchange = fillClasses;
  fillClasses();
  const body = el("div", { class: "form-grid" }, [
    field("Book Title", titleInp, { full: true }),
    field("Subject", subjectInp),
    field("Section", sectionSel),
    field("Class", classSel),
    field("ISBN (Optional)", isbnInp),
    field("Author", authorInp),
    field("Publisher", publisherInp),
    field("Cost Price (Naira)", costInp),
    field("Selling Price (Naira)", priceInp),
    field("Stock Quantity", stockInp),
    field("Reorder Level", reorderInp),
    field("Status", statusSel)
  ]);
  const saveBtn = btn("Save Book", {
    variant: "primary", onclick: () => {
      if (!titleInp.value.trim()) { toast("Book title is required", "error"); return; }
      const sellingPrice = num(priceInp.value);
      db.save("books", {
        id: existing?.id || uuid(),
        title: titleInp.value.trim(), subject: subjectInp.value.trim(), category: subjectInp.value.trim(),
        isbn: isbnInp.value.trim(), author: authorInp.value.trim(), publisher: publisherInp.value.trim(),
        sectionId: sectionSel.value, classId: classSel.value,
        costPrice: num(costInp.value), sellingPrice, price: sellingPrice,
        stock: num(stockInp.value), reorderLevel: num(reorderInp.value),
        status: statusSel.value || "available",
        session: existing?.session || cfg.currentSession(),
        createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now()
      });
      toast("Book saved", "success"); m.close(); onSaved();
    }
  });
  const cancelBtn = btn("Cancel", { onclick: () => m.close() });
  const m = modal({ title: existing ? "Edit Book" : "Add Book", size: "lg", body, footer: [cancelBtn, saveBtn] });
  return m;
}
function subjects(panel) {
  listEditor(panel, {
    title: "Subjects", getList: () => ((db.setting("subjects") || {}).list || []).slice(),
    setList: (list) => { db.saveSetting("subjects", { list }); toast("Subjects saved", "success"); },
    columns: [{ label: "Subject", key: "name" }, { label: "Section", render: (r) => cfg.sectionName(r.sectionId) }],
    makeForm: (rec, done) => {
      const name = input({ value: rec?.name || "" });
      const sec = select(() => cfg.sections().map((s) => ({ value: s.id, label: s.name, selected: rec?.sectionId === s.id })));
      const m = modalForm("Subject", [field("Subject Name", name), field("Section", sec)], () => {
        if (!name.value.trim()) return toast("Name required", "error");
        done({ id: rec?.id || (sec.value + "::" + slug(name.value)), name: name.value, sectionId: sec.value, active: true }); m.close();
      });
    }
  });
}

function mathematicsSettings(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const settings = cfg.mathSettings();
    const topics = settings.topics || [];
    const formulas = settings.formulas || [];
    const templates = settings.templates || [];
    const difficulties = input({ value: (settings.difficulties || ["Easy", "Medium", "Hard"]).join(", ") });

    const topicCard = card("Mathematics Topics", [
      table([
        { label: "Topic", key: "name" },
        { label: "Class Band", key: "band" },
        { label: "Status", key: "status" },
        {
          label: "", render: (r) => el("div", { class: "row" }, [
            btn("Edit", { sm: true, onclick: () => editTopic(r) }),
            btn("Delete", {
              sm: true, variant: "danger", onclick: async () => {
                if (!await confirmDialog("Delete this topic?", { danger: true, okText: "Delete" })) return;
                saveMathSettings({ topics: topics.filter((t) => t.id !== r.id) });
              }
            })
          ])
        }
      ], topics, { empty: "No mathematics topics configured." })
    ], btn("Add Topic", { sm: true, variant: "primary", onclick: () => editTopic(null) }));

    const formulaCard = card("Formula Library", [
      table([
        { label: "Formula", key: "name" },
        { label: "Category", key: "category" },
        { label: "Expression", key: "formula" },
        {
          label: "", render: (r) => el("div", { class: "row" }, [
            btn("Edit", { sm: true, onclick: () => editFormula(r) }),
            btn("Delete", {
              sm: true, variant: "danger", onclick: async () => {
                if (!await confirmDialog("Delete this formula?", { danger: true, okText: "Delete" })) return;
                saveMathSettings({ formulas: formulas.filter((f) => f.id !== r.id) });
              }
            })
          ])
        }
      ], formulas, { empty: "No formulas configured." })
    ], btn("Add Formula", { sm: true, variant: "primary", onclick: () => editFormula(null) }));

    const templateCard = card("Question Templates", [
      table([
        { label: "Topic", key: "topic" },
        { label: "Template", key: "template" },
        { label: "Answer Rule", key: "answerRule" },
        { label: "", render: (r) => btn("Delete", { sm: true, variant: "danger", onclick: () => saveMathSettings({ templates: templates.filter((t) => t.id !== r.id) }) }) }
      ], templates, { empty: "No custom templates yet. The built-in generator still works." })
    ], btn("Add Template", { sm: true, variant: "primary", onclick: () => editTemplate(null) }));

    const difficultyCard = card("Difficulty Levels", [
      field("Levels (comma separated)", difficulties, { full: true }),
      btn("Save Difficulty Levels", { variant: "primary", onclick: () => saveMathSettings({ difficulties: difficulties.value.split(",").map((x) => x.trim()).filter(Boolean) }) })
    ]);

    panel.appendChild(topicCard);
    panel.appendChild(formulaCard);
    panel.appendChild(templateCard);
    panel.appendChild(difficultyCard);
  };

  function saveMathSettings(patch) {
    db.saveSetting("mathSettings", { ...cfg.mathSettings(), ...patch });
    toast("Mathematics settings saved", "success");
    draw();
  }
  function editTopic(rec) {
    const name = input({ value: rec?.name || "" });
    const band = select(() => ["prebasic", "primary", "junior", "senior"].map((b) => ({ value: b, label: b, selected: rec?.band === b })));
    const status = select(() => ["Active", "Inactive"].map((s) => ({ value: s, label: s, selected: (rec?.status || "Active") === s })));
    const m = modalForm("Mathematics Topic", [field("Topic", name), field("Class Band", band), field("Status", status)], () => {
      if (!name.value.trim()) return toast("Topic required", "error");
      const list = (cfg.mathSettings().topics || []).slice();
      const saved = { id: rec?.id || slug(name.value), name: name.value.trim(), band: band.value, status: status.value };
      const idx = list.findIndex((t) => t.id === saved.id);
      if (idx >= 0) list[idx] = saved; else list.push(saved);
      saveMathSettings({ topics: list }); m.close();
    });
  }
  function editFormula(rec) {
    const name = input({ value: rec?.name || "" });
    const category = input({ value: rec?.category || "" });
    const formula = input({ value: rec?.formula || "" });
    const m = modalForm("Formula", [field("Name", name), field("Category", category), field("Formula", formula, { full: true })], () => {
      if (!name.value.trim() || !formula.value.trim()) return toast("Name and formula required", "error");
      const list = (cfg.mathSettings().formulas || []).slice();
      const saved = { id: rec?.id || slug(name.value), name: name.value.trim(), category: category.value.trim(), formula: formula.value.trim() };
      const idx = list.findIndex((f) => f.id === saved.id);
      if (idx >= 0) list[idx] = saved; else list.push(saved);
      saveMathSettings({ formulas: list }); m.close();
    });
  }
  function editTemplate(rec) {
    const topic = input({ value: rec?.topic || "" });
    const template = input({ value: rec?.template || "", placeholder: "e.g. {a} + {b} = ?" });
    const answerRule = input({ value: rec?.answerRule || "", placeholder: "e.g. a+b" });
    const m = modalForm("Question Template", [field("Topic", topic), field("Template", template, { full: true }), field("Answer Rule", answerRule, { full: true })], () => {
      if (!topic.value.trim() || !template.value.trim()) return toast("Topic and template required", "error");
      const list = (cfg.mathSettings().templates || []).slice();
      list.push({ id: rec?.id || uuid(), topic: topic.value.trim(), template: template.value.trim(), answerRule: answerRule.value.trim() });
      saveMathSettings({ templates: list }); m.close();
    }, "md");
  }

  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function session(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const s = cfg.sessions();
    const current = input({ value: s.current || "" });
    const list = input({ value: (s.list || []).join(", ") });
    const term = select(() => (s.terms || ["First Term", "Second Term", "Third Term"]).map((t) => ({ value: t, label: t, selected: s.currentTerm === t })));
    const next = input({ value: s.nextTermBegins || "" });
    const c = card("Academic Session", [el("div", { class: "form-grid" }, [
      field("Current Session", current), field("Current Term", term),
      field("All Sessions (comma separated)", list, { full: true }), field("Next Term Begins", next, { full: true })
    ])]);
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("Save Session", {
      variant: "primary", onclick: () => {
        db.saveSetting("sessions", { current: current.value, currentTerm: term.value, terms: s.terms || ["First Term", "Second Term", "Third Term"], list: list.value.split(",").map((x) => x.trim()).filter(Boolean), nextTermBegins: next.value });
        toast("Session saved", "success");
      }
    })]));
    panel.appendChild(c);
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function grading(panel) {
  listEditor(panel, {
    title: "Grading Scale", getList: () => ((db.setting("grading") || {}).scale || []).map((g, i) => ({ id: g.grade + i, ...g })),
    setList: (list) => { db.saveSetting("grading", { scale: list.map(({ id, ...g }) => g) }); toast("Grading saved", "success"); },
    columns: [{ label: "Grade", key: "grade" }, { label: "Min", key: "min" }, { label: "Max", key: "max" }, { label: "Remark", key: "remark" }],
    makeForm: (rec, done) => {
      const grade = input({ value: rec?.grade || "" }); const min = input({ type: "number", value: rec?.min || 0 });
      const max = input({ type: "number", value: rec?.max || 0 }); const remark = input({ value: rec?.remark || "" });
      const m = modalForm("Grade", [field("Grade", grade), field("Min", min), field("Max", max), field("Remark", remark)], () => {
        done({ id: rec?.id || uuid(), grade: grade.value, min: num(min.value), max: num(max.value), remark: remark.value }); m.close();
      });
    }
  });
}

function promotion(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const map = cfg.promotionPaths();
    const cls = cfg.classes();
    const inputs = {};
    const rows = cls.map((k) => {
      const sel = select(() => [{ value: "", label: "\u2014 Graduate \u2014" }, ...cls.filter((x) => x.sectionId === k.sectionId && x.id !== k.id).map((x) => ({ value: x.id, label: x.name, selected: map[k.id] === x.id }))]);
      inputs[k.id] = sel;
      return el("div", { class: "svc-row" }, [el("span", { class: "nm", text: cfg.sectionName(k.sectionId) + " / " + k.name }), el("span", { text: "\u2192" }), sel]);
    });
    const c = card("Promotion Paths", rows);
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("Save Paths", {
      variant: "primary", onclick: () => {
        const newMap = {}; Object.keys(inputs).forEach((k) => { if (inputs[k].value) newMap[k] = inputs[k].value; }); db.saveSetting("promotionPaths", { map: newMap }); toast("Promotion paths saved", "success");
      }
    })]));
    panel.appendChild(c);
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function roles(panel) {
  const draw = () => {
    panel.innerHTML = "";
    const access = (db.setting("roles") || { access: DEFAULT_ROLE_ACCESS }).access;
    const c = card("Role Module Access", [el("p", { class: "muted", text: "Tick the modules each role can access." })]);
    const checks = {};
    ROLES.forEach((role) => {
      const allowed = access[role] || [];
      const grid = el("div", { class: "chip-select" }, MODULES.map((mod) => {
        const sel = (allowed.includes("*") || allowed.includes(mod));
        const chip = el("label", { class: "chip" + (sel ? " sel" : "") }, [el("input", { type: "checkbox", style: "display:none" }), document.createTextNode(mod)]);
        const cb = chip.querySelector("input"); cb.checked = sel;
        checks[role + "|" + mod] = cb;
        chip.onclick = (e) => { e.preventDefault(); cb.checked = !cb.checked; chip.classList.toggle("sel", cb.checked); };
        return chip;
      }));
      c.appendChild(el("div", { style: "margin:10px 0" }, [el("b", { text: role }), grid]));
    });
    c.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [btn("Save Roles", {
      variant: "primary", onclick: () => {
        const newAccess = {}; ROLES.forEach((role) => { if (role === "Super Admin") { newAccess[role] = ["*"]; return; } newAccess[role] = MODULES.filter((m) => checks[role + "|" + m].checked); });
        db.saveSetting("roles", { access: newAccess }); window.__CICKANORoleAccess = newAccess; toast("Roles saved (re-login to refresh nav)", "success");
      }
    })]));
    panel.appendChild(c);
  };
  draw();
  const off = db.on("settings", draw);
  return () => off();
}

function users(panel, ctx) {
  panel.innerHTML = "";
  const note = card("User Management", [
    el("p", { style: "margin-bottom:12px", text: "User accounts are now managed in the dedicated Secure User Management module, which includes full audit logging, login history, device tracking, temporary password generation, account suspension, force logout, and more." }),
    el("div", { class: "row" }, [
      btn("Go to User Management →", {
        variant: "primary",
        onclick: () => { window.location.hash = "#/usermanagement"; }
      })
    ])
  ]);
  panel.appendChild(note);
}
// small modal-form helper
function modalForm(title, fields, onSave, size = "sm") {
  const body = el("div", { class: "form-grid" }, fields);
  return modal({ title, size, body, footer: [btn("Save", { variant: "primary", onclick: onSave })] });
}

function globalSeedData(panel, ctx) {
  panel.innerHTML = "";

  const description = el("p", {
    text: "Global Seed Data serves as the reference database structure (Classes, Sections, Subjects, Settings, Roles, Staff, Students). When you publish, the current master configurations are bundled into an immutable artifact. New devices logging into the platform for the first time will automatically download this reference data. This does NOT overwrite populated databases.",
    class: "muted"
  });

  const statusEl = el("div", { class: "form-grid", style: "margin: 16px 0;" }, [
    field("Status", el("strong", { text: "Ready to publish current Master Data" }))
  ]);

  const publishBtn = btn("Publish Global Seed Data", {
    variant: "primary",
    onclick: async () => {
      confirmDialog(
        "Publish Global Seed Data?",
        "Are you sure you want to publish the current database configuration as the new Master Seed? Existing devices with populated databases will not be overwritten.",
        async () => {
          publishBtn.disabled = true;
          publishBtn.textContent = "Publishing... Please wait";

          try {
            const result = await publishGlobalSeedData();
            toast(`Seed Published Successfully! Version: ${result.version}`);
            statusEl.innerHTML = "";
            statusEl.appendChild(field("Last Publish", el("strong", { text: "Success" })));
            statusEl.appendChild(field("Checksum", el("span", { text: result.checksum || "N/A" })));
          } catch (e) {
            console.error("Publish Seed Error:", e);
            toast("Publish Failed: " + e.message, "error");
          } finally {
            publishBtn.disabled = false;
            publishBtn.textContent = "Publish Global Seed Data";
          }
        }
      );
    }
  });

  panel.appendChild(card("Global Seed Data Management", [
    description,
    statusEl,
    el("div", { class: "row", style: "margin-top: 16px;" }, [publishBtn])
  ]));
}






