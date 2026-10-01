import { db } from "../core/db.js";
import { el, toast, naira, num, modal, debounce, uuid, fmtDate } from "../core/utils.js";
import { card, pageHead, table, btn, input, select, field, readFileAsDataURL, BulkSelection, bulkActionBar } from "../core/ui.js";
import { nextStaffId } from "../core/idgen.js";
import { staffIdCardDoc } from "../core/documents.js";
import { printHtml } from "../core/print.js";
import { can, ROLES } from "../core/rbac.js";
import * as cfg from "../core/config.js";
import { statusLabel } from "../core/staffattendance.js";
import { lazyListen } from "../core/adapter.js";
import { fingerprintServiceAvailable, enrollFingerprint } from "../core/fingerprint.js";

const DEPARTMENTS = ["Pre-Basic", "Basic", "Secondary", "Islamiyya", "Tahfiz", "Administration", "Accounts", "Support"];

export function render(root, ctx) {
  lazyListen("staff");
  const canManage = can(ctx.user.role, "manageStaff");
  root.appendChild(pageHead("Staff", "Register and manage staff records, salary details and login accounts.",
    canManage ? [btn("Register Staff", { variant: "primary", icon: "+", onclick: () => editStaff(null, ctx) })] : []));
  const search = input({ placeholder: "Search staff\u2026", style: "max-width:300px" });
  root.appendChild(el("div", { class: "row", style: "margin-bottom:14px" }, [search]));
  
  const selection = new BulkSelection();
  const bulkBar = bulkActionBar(selection, [
    { label: "🖨️ Print ID Cards", action: (ids) => {
      const selectedStaff = ids.map(id => db.get("staff", id)).filter(Boolean);
      if(!selectedStaff.length) return;
      const html = selectedStaff.map(s => staffIdCardDoc(s)).join("<div style='page-break-after:always'></div>");
      printHtml(html, { title: "Staff ID Cards" });
    }},
    { label: "🗑️ Delete", variant: "danger", action: async (ids) => {
      const { confirmDialog } = await import("../core/utils.js");
      if(await confirmDialog(`Delete ${ids.length} staff members?`, { danger: true })) {
         ids.forEach(id => db.delete("staff", id));
         selection.clear();
      }
    }}
  ]);
  if (canManage) root.appendChild(bulkBar);

  const host = el("div");
  root.appendChild(host);
  const draw = () => {
    selection.clear();
    const q = (search.value || "").toLowerCase();
    let rows = db.list("staff").sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    if (q) rows = rows.filter((s) => `${s.name} ${s.staffNo} ${s.post || ""}`.toLowerCase().includes(q));
    host.innerHTML = "";
    host.appendChild(card("", [table([
      { label: "Staff No", key: "staffNo" }, { label: "Name", key: "name" }, { label: "Post", key: "post" },
      { label: "Department", key: "department" }, { label: "Basic Salary", align: "right", render: (s) => naira(s.basic) },
      { label: "Status", key: "employmentStatus" },
      { label: "Login", render: (s) => s.loginStatus || (db.query("users", u => u.staffId === s.id).length ? "Active" : "Pending Login") },
      { label: "", render: (s) => el("div", { class: "row" }, [
        btn("View", { sm: true, onclick: () => view(s.id, ctx) }),
        ...(canManage ? [btn("Edit", { sm: true, onclick: () => editStaff(s.id, ctx) })] : [])
      ]) }
    ], rows, { empty: "No staff registered yet", selection: canManage ? selection : null })]));
  };
  draw();
  search.oninput = debounce(draw, 200);
  const off = db.on("staff", draw);
  return () => off();
}

function view(id, ctx) {
  const s = db.get("staff", id);
  const linkedUserRec = db.query("users", u => u.staffId === id || u.email === s.email)[0];
  const body = el("div");
  body.innerHTML = `
    <div style="display:flex;gap:16px">
      <div style="width:96px;height:112px;border:1px solid var(--border);border-radius:8px;overflow:hidden">${s.passport ? `<img src="${s.passport}" style="width:100%;height:100%;object-fit:cover">` : ""}</div>
      <div><h3 style="margin:0">${s.name}</h3>
      <div class="muted">${s.staffNo} \u2022 ${s.post || ""} \u2022 ${s.department || ""}</div>
      <div class="muted">Phone: ${s.phone || "-"} \u2022 ${s.email || "-"}</div>
      <div class="muted">Employment: ${s.employmentStatus || "-"} \u2022 Salary Class: ${s.salaryClass || "-"}</div>
      <div class="muted">Login Status: ${s.loginStatus || (linkedUserRec ? "Active" : "Pending Login")}</div>
      <div class="muted">Bank: ${s.bankName || "-"} \u2022 Acct: ${s.accountNumber || "-"}</div>
      <div class="muted">Basic: ${naira(s.basic)} \u2022 Allowances: ${naira(num(s.officeAllowance) + num(s.specialAllowance))}</div>
      <div class="muted">Latest Attendance: ${s.attendanceProfile ? `${statusLabel(s.attendanceProfile.status)} on ${fmtDate(s.attendanceProfile.date)}${s.attendanceProfile.arrivalTime ? " at " + s.attendanceProfile.arrivalTime : ""} \u2022 Deduction: ${naira(s.attendanceProfile.deduction)}` : "-"}</div>
      </div>
    </div>`;
    
  const isSelf = ctx.user.staffId === id || ctx.user.uid === id || ctx.user.email === s.email;
  if (isSelf) {
    const cpDiv = el("div", { style: "margin-top:20px" });
    const currentInp = input({ type: "password", placeholder: "Current Password", autocomplete: "current-password" });
    const pInp = input({ type: "password", placeholder: "New Password" });
    const cpBtn = btn("Change Password", { variant: "primary", onclick: async () => {
      if (!currentInp.value || !pInp.value) return toast("Enter current and new password", "error");
      cpBtn.disabled = true;
      try {
        const { getState } = await import("../core/adapter.js");
        const st = getState();
        if (st.mode === "cloud" && st.ready && navigator.onLine) {
            const actionName = "staff:self-change-password";
            const firebaseUser = st.auth?.currentUser;
            console.log("Current Firebase User:", firebaseUser?.email);
            console.log("Action:", actionName);
            if (!firebaseUser?.email) throw new Error("No active Firebase user session.");
            const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = st.sdk.auth;
            const credential = EmailAuthProvider.credential(firebaseUser.email, currentInp.value);
            await reauthenticateWithCredential(firebaseUser, credential);
            await updatePassword(firebaseUser, pInp.value);
        }
        
        // Also update local hash for fallback
        const userRec = db.query("users", u => u.staffId === id || u.email === s.email)[0];
        if (userRec) {
          // Using statically imported sha256
          userRec.passwordHash = await sha256(pInp.value);
          userRec.forcePasswordChange = false;
          db.save("users", userRec);
        }
        toast("Password changed successfully", "success");
        ctx.user.forcePasswordChange = false;
        currentInp.value = "";
        pInp.value = "";
      } catch (e) {
        toast("Failed to change password: " + e.message, "error");
      }
      cpBtn.disabled = false;
    } });
    cpDiv.appendChild(card("Security", [
      el("p", { class: "muted", text: "Change your account password below. You will be asked to re-login next time." }),
      el("div", { class: "row" }, [currentInp, pInp, cpBtn]),
      el("div", { class: "row", style: "margin-top:8px" }, [
        btn("Request Password Reset", { onclick: () => {
          db.save("passwordResetRequests", {
            id: uuid(), staffId: s.id, staffNo: s.staffNo, staffName: s.name, email: s.email || ctx.user.email,
            reason: "Staff requested password reset", status: "pending", requestedAt: Date.now(), userId: ctx.user.uid
          });
          toast("Password reset request submitted", "success");
        }})
      ])
    ]));
    body.appendChild(cpDiv);
  }

  if (can(ctx.user.role, "manageStaff") && !isSelf) {
    const adminDiv = el("div", { style: "margin-top:20px" });
    const userRec = linkedUserRec;
    
    // Disable Login
    const toggleBtn = btn(userRec?.loginDisabled ? "Enable Login" : "Disable Login", {
      variant: userRec?.loginDisabled ? "success" : "danger",
      onclick: () => {
        if (!userRec) return toast("No login account found", "error");
        userRec.loginDisabled = !userRec.loginDisabled;
        if (userRec.loginDisabled) userRec.forceLogout = true;
        db.save("users", userRec);
        db.save("auditLogs", { id: uuid(), type: "staff", uid: ctx.user.uid, at: Date.now(), message: `${userRec.loginDisabled ? 'Disabled' : 'Enabled'} login for ${s.name}` });
        toast(`Login ${userRec.loginDisabled ? 'disabled' : 'enabled'}`, "success");
        m.close();
      }
    });

    // Soft Delete / Archive
    const delBtn = btn(s.employmentStatus === "Inactive" ? "Restore Staff" : "Archive / Delete Staff", {
      variant: s.employmentStatus === "Inactive" ? "success" : "danger",
      onclick: async () => {
        const { confirmDialog } = await import("../core/utils.js");
        if (s.employmentStatus === "Inactive") {
            const ok = await confirmDialog("Restore this staff member to active duty?", { okText: "Restore" });
            if (!ok) return;
            s.employmentStatus = "Permanent";
            db.save("staff", s);
            toast("Staff restored", "success");
            m.close();
            return;
        }

        const body = el("div", {}, [
          el("p", { class: "muted", text: "Choose how to handle this staff member and their login account." }),
          el("div", { class: "row", style: "gap:8px;flex-wrap:wrap" }, [
            btn("Set Inactive (Soft Delete)", { variant: "warning", onclick: async () => {
              if (!(await confirmDialog("Mark this staff member as Inactive? This will also disable their login.", { okText: "Set Inactive" }))) return;
              s.employmentStatus = "Inactive";
              s.loginStatus = "Disabled";
              if (userRec) {
                userRec.loginDisabled = true; userRec.forceLogout = true; userRec.status = "disabled";
                db.save("users", userRec);
                const rr = db.get("userRoles", userRec.id); if (rr) { rr.loginDisabled = true; rr.forceLogout = true; db.save("userRoles", rr); }
              }
              db.save("staff", s);
              db.save("auditLogs", { id: uuid(), type: "staff", uid: ctx.user.uid, at: Date.now(), message: `Marked staff ${s.name} as Inactive` });
              toast("Staff marked as Inactive.", "success"); dm.close(); m.close();
            }}),
            btn("Delete Profile Only", { variant: "danger", onclick: async () => {
              const hasRelated = db.query("payslips", p => p.staffId === id).length > 0 || db.query("staffAttendance", a => a.staffId === id).length > 0 || db.query("activities", a => a.staffId === id || a.user === s.email).length > 0;
              if (hasRelated) {
                  toast("Cannot hard-delete staff with existing payslips, attendance, or activities. Use 'Set Inactive' instead.", "error", 6000);
                  return;
              }
              if (!(await confirmDialog("Delete staff profile only? Login account will remain.", { danger: true, okText: "Delete Profile" }))) return;
              db.remove("staff", id);
              db.save("auditLogs", { id: uuid(), type: "staff", uid: ctx.user.uid, at: Date.now(), message: `Deleted staff profile ${s.name}; login retained` });
              toast("Staff profile deleted; login retained.", "success"); dm.close(); m.close();
            }}),
            btn("Disable Login", { variant: "warning", onclick: async () => {
              if (!userRec) return toast("No login account found", "error");
              userRec.loginDisabled = true; userRec.forceLogout = true; userRec.status = userRec.status || "disabled";
              db.save("users", userRec);
              const rr = db.get("userRoles", userRec.id); if (rr) { rr.loginDisabled = true; rr.forceLogout = true; db.save("userRoles", rr); }
              s.loginStatus = "Disabled"; db.save("staff", s);
              db.save("auditLogs", { id: uuid(), type: "staff", uid: ctx.user.uid, at: Date.now(), message: `Disabled login for ${s.name}` });
              toast("Login disabled.", "success"); dm.close(); m.close();
            }}),
            btn("Delete Profile + Login", { variant: "danger", onclick: async () => {
              const hasRelated = db.query("payslips", p => p.staffId === id).length > 0 || db.query("staffAttendance", a => a.staffId === id).length > 0 || db.query("activities", a => a.staffId === id || a.user === s.email).length > 0;
              if (hasRelated) {
                  toast("Cannot hard-delete staff with existing payslips, attendance, or activities. Use 'Set Inactive' instead.", "error", 6000);
                  return;
              }
              if (!(await confirmDialog("Delete staff profile and local login records? Firebase Auth account cannot be hard-deleted from this client; it will be disabled locally.", { danger: true, okText: "Delete Both" }))) return;
              db.remove("staff", id);
              if (userRec) {
                userRec.loginDisabled = true; userRec.forceLogout = true; userRec.status = "deleted"; db.save("users", userRec);
                db.remove("userRoles", userRec.id);
              }
              db.remove("staffLoginMap", id);
              db.save("auditLogs", { id: uuid(), type: "staff", uid: ctx.user.uid, at: Date.now(), message: `Deleted staff profile and login records for ${s.name}` });
              toast("Staff profile and login records removed/disabled.", "success"); dm.close(); m.close();
            }})
          ])
        ]);
        const dm = modal({ title: "Delete Staff Safely", body });
      }
    });

    // Activity History
    const activityBtn = btn("View Activity History", {
      variant: "ghost",
      onclick: () => {
        const logs = db.list("activities").filter(a => a.staffId === id || a.user === s.email).sort((a,b)=>b.at-a.at).slice(0, 50);
        if(!logs.length) return toast("No activity found", "info");
        const logBody = el("div", { style: "max-height:400px;overflow-y:auto" });
        logs.forEach(l => {
          logBody.appendChild(el("div", { style: "padding:8px;border-bottom:1px solid #eee;font-size:13px" }, [
            el("div", { style: "font-weight:600" }, [document.createTextNode(new Date(l.at).toLocaleString() + " — " + l.module)]),
            el("div", {}, [document.createTextNode(l.action + ": " + l.description)])
          ]));
        });
        modal({ title: "Activity History", body: logBody, size: "lg" });
      }
    });

    // Change Role / Transfer Department
    const roleDeptBtn = btn("Change Role / Dept", {
      variant: "secondary",
      onclick: () => {
        const dSel = select(() => DEPARTMENTS.map(d => ({ value: d, label: d, selected: s.department === d })));
        const rSel = select(() => ROLES.filter(r => !["Super Admin"].includes(r)).map(r => ({ value: r, label: r, selected: (userRec?.role || s.role) === r })));
        const rdBody = el("div", { class: "form-grid" }, [
          field("Department", dSel),
          field("Login Role", rSel)
        ]);
        const rdm = modal({ title: "Change Role & Department", body: rdBody, footer: [
          btn("Save Changes", { variant: "primary", onclick: () => {
            s.department = dSel.value;
            s.role = rSel.value;
            db.save("staff", s);
            if (userRec) {
              userRec.role = rSel.value;
              db.save("users", userRec);
              const rr = db.get("userRoles", userRec.id);
              if (rr) { rr.role = rSel.value; db.save("userRoles", rr); }
            }
            db.save("auditLogs", { id: uuid(), type: "staff", uid: ctx.user.uid, at: Date.now(), message: `Changed role/dept for ${s.name} to ${rSel.value} / ${dSel.value}` });
            toast("Role and Department updated.", "success");
            rdm.close();
            m.close();
          }})
        ]});
      }
    });

    adminDiv.appendChild(card("Admin Override Controls", [
      el("div", { class: "row", style: "gap:10px;flex-wrap:wrap;" }, [toggleBtn, delBtn, roleDeptBtn, activityBtn])
    ]));
    body.appendChild(adminDiv);
  }
    
  const m = modal({ title: "Staff Profile", size: "lg", body, footer: [btn("Print ID Card", { onclick: () => printHtml(staffIdCardDoc(s), { title: "Staff ID " + s.staffNo }) })] });
}

function editStaff(id, ctx) {
  const s = id ? { ...db.get("staff", id) } : {};
  const f = {};
  const def = (k, attrs = {}) => (f[k] = input({ value: s[k] != null ? s[k] : "", ...attrs }));
  def("name"); def("phone"); def("email", { type: "email" }); def("fingerprintId", { placeholder: "ZKTeco ID" });
  f.gender = select(() => ["", "Male", "Female"].map((g) => ({ value: g, label: g || "Gender", selected: s.gender === g })));
  def("post"); f.department = select(() => DEPARTMENTS.map((d) => ({ value: d, label: d, selected: s.department === d })));
  f.employmentStatus = select(() => ["", "Permanent", "Contract", "Part-time", "Volunteer"].map((e) => ({ value: e, label: e || "Employment Status", selected: s.employmentStatus === e })));
  def("salaryClass"); def("basic", { type: "number" }); def("officeAllowance", { type: "number" }); def("specialAllowance", { type: "number" });
  def("bankName"); def("accountNumber");
  const passport = el("div", { class: "passport-drop" }); passport.innerHTML = s.passport ? `<img src="${s.passport}">` : "Photo";
  const fileInp = input({ type: "file", accept: "image/*", style: "display:none" });
  passport.onclick = () => fileInp.click();
  let newPhoto = null;
  fileInp.onchange = async () => { if (fileInp.files[0]) { newPhoto = await readFileAsDataURL(fileInp.files[0]); passport.innerHTML = `<img src="${newPhoto}">`; } };

  let _pendingFingerprint = null;
  const enrollBtn = btn("Enroll Fingerprint", { variant: "secondary", onclick: async () => {
    if (!confirm(`Are you ready to enroll ${f.name.value || 'this staff'}'s fingerprint? They will need to scan their finger 4 times.`)) return;
    
    toast("Connecting to DigitalPersona service...", "info");
    const isAvail = await fingerprintServiceAvailable();
    if (!isAvail) return toast("Hardware scanner service not available.", "error");
    
    enrollBtn.disabled = true;
    enrollBtn.textContent = "Scanning...";
    try {
        toast("Please place finger on the scanner 4 times...", "warning");
        const res = await enrollFingerprint();
        if (!res.success) throw new Error(res.error || "Capture failed");
        _pendingFingerprint = res.template;
        enrollBtn.textContent = "Fingerprint Enrolled \u2713";
        enrollBtn.style.backgroundColor = "var(--success)";
        enrollBtn.style.color = "white";
    } catch (err) {
      toast(err.message, "error");
      enrollBtn.textContent = "Enroll Fingerprint";
    }
    enrollBtn.disabled = false;
  }});

  // Staff Assignments (Classes and Subjects)
  s.assignedClasses = s.assignedClasses || [];
  s.assignedSubjects = s.assignedSubjects || [];
  
  const allCls = cfg.classes();
  const allSub = cfg.subjects();
  
  const classOpts = el("div", { style: "max-height:150px;overflow-y:auto;border:1px solid var(--border);padding:8px;border-radius:4px" }, 
    allCls.map(c => el("label", { style: "display:block;margin-bottom:4px" }, [
      el("input", { type: "checkbox", value: c.id, checked: s.assignedClasses.includes(c.id), onchange: (e) => {
        if(e.target.checked) s.assignedClasses.push(c.id);
        else s.assignedClasses = s.assignedClasses.filter(x => x !== c.id);
      } }), document.createTextNode(" " + c.name)
    ]))
  );
  
  const uniqueSubs = [...new Set(allSub.map(sub => sub.name))];
  const subjOpts = el("div", { style: "max-height:150px;overflow-y:auto;border:1px solid var(--border);padding:8px;border-radius:4px" }, 
    uniqueSubs.map(sub => el("label", { style: "display:block;margin-bottom:4px" }, [
      el("input", { type: "checkbox", value: sub, checked: s.assignedSubjects.includes(sub), onchange: (e) => {
        if(e.target.checked) s.assignedSubjects.push(sub);
        else s.assignedSubjects = s.assignedSubjects.filter(x => x !== sub);
      } }), document.createTextNode(" " + sub)
    ]))
  );

  const body = el("div", {}, [
    el("div", { class: "row", style: "align-items:flex-start;gap:16px" }, [
      el("div", {}, [field("Passport", passport), fileInp, el("div", { style: "margin-top:16px" }, [enrollBtn])]),
      el("div", { class: "form-grid", style: "flex:1" }, [
        field("Full Name", f.name), field("Gender", f.gender), field("Phone", f.phone), field("Email", f.email),
        field("ZKTeco Fingerprint ID", f.fingerprintId), field("Post", f.post), field("Department", f.department), field("Employment Status", f.employmentStatus), field("Salary Class", f.salaryClass),
        field("Basic Salary (\u20A6)", f.basic), field("Office Allowance (\u20A6)", f.officeAllowance), field("Special Duty Allowance (\u20A6)", f.specialAllowance),
        field("Bank Name", f.bankName), field("Account Number", f.accountNumber)
      ])
    ]),
    card("Teaching Assignments", [
      el("div", { class: "form-grid" }, [
        field("Assigned Classes", classOpts),
        field("Assigned Subjects", subjOpts)
      ])
    ], { style: "margin-top:16px" })
  ]);
  
  // Login account role selection
  const loginRole = select(() => ROLES.filter((r) => !["Super Admin"].includes(r)).map((r) => ({ value: r, label: r, selected: s.role ? s.role === r : r === "Teacher" })));
  if (!id) body.appendChild(card("Pending Login Creation", [
      el("div", { class: "form-grid", style: "margin-top:8px" }, [field("Role", loginRole)]),
      el("p", { class: "muted", text: "The staff profile will be saved first. Create the login later from User Management > Pending User Creation." })
  ]));

  const m = modal({ title: id ? "Edit Staff" : "Register Staff", size: "lg", body, footer: [btn("Save", { variant: "primary", onclick: async (e) => {
    if (!f.name.value.trim()) return toast("Name is required", "error");
    
    // Disable save button to prevent double click
    const saveBtn = e.currentTarget;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      const rec = id ? db.get("staff", id) : { id: uuid(), staffNo: await nextStaffId(), createdAt: Date.now() };
      Object.keys(f).forEach((k) => rec[k] = ["basic", "officeAllowance", "specialAllowance"].includes(k) ? num(f[k].value) : f[k].value);
      if (newPhoto) rec.passport = newPhoto;
      
      rec.assignedClasses = s.assignedClasses;
      rec.assignedSubjects = s.assignedSubjects;

      if (_pendingFingerprint) {
        db.save("fingerprints", { id: uuid(), ownerId: rec.id, role: "staff", template: _pendingFingerprint, createdAt: Date.now() });
      }

      if (!id) {
        const duplicateNo = db.list("staff").some((s) => s.id !== rec.id && s.staffNo && s.staffNo.toLowerCase() === rec.staffNo.toLowerCase());
        if (duplicateNo) throw new Error("Duplicate staff ID detected.");
        const wantedEmail = (f.email.value || `${rec.staffNo.replace(/[^a-z0-9]/gi, "").toLowerCase()}@cic-kano.local`).toLowerCase();
        const duplicateEmail = db.list("staff").some((s) => s.id !== rec.id && s.email && s.email.toLowerCase() === wantedEmail)
          || db.list("users").some((u) => u.email && u.email.toLowerCase() === wantedEmail);
        if (duplicateEmail) throw new Error("Duplicate email detected.");
        rec.email = wantedEmail;
        rec.role = loginRole.value;
        rec.loginStatus = "Pending Login";
        db.save("staff", rec);
        db.save("auditLogs", { id: uuid(), type: "staff", uid: ctx.user.uid, at: Date.now(), message: `Registered staff ${rec.name}` });
        
        m.close();
        
        modal({ title: "Staff Profile Saved", body: el("div", {}, [
          el("p", { text: `Staff record saved. Login creation is pending in User Management.` }),
          el("p", { html: `<b>Email:</b> ${rec.email}` }),
          el("p", { html: `<b>Role:</b> ${rec.role}` }),
          el("p", { class: "muted", text: "Open User Management and click Create Login under Pending User Creation." })
        ])});
      } else {
        if (f.email.value) {
          const duplicateEmail = db.list("staff").some((x) => x.id !== rec.id && x.email && x.email.toLowerCase() === f.email.value.toLowerCase())
            || db.list("users").some((u) => u.staffId !== rec.id && u.email && u.email.toLowerCase() === f.email.value.toLowerCase());
          if (duplicateEmail) throw new Error("Duplicate email detected.");
        }
        db.save("staff", rec);
        db.save("auditLogs", { id: uuid(), type: "staff", uid: ctx.user.uid, at: Date.now(), message: `Updated staff ${rec.name}` });
        toast("Staff updated", "success");
        m.close();
      }
    } catch (e) {
      toast("Error: " + e.message, "error", 10000);
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  } })] });
}



