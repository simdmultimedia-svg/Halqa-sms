import { db } from "../core/db.js";
import { getState } from "../core/adapter.js";
import { el, toast, uuid, confirmDialog, modal } from "../core/utils.js";
import { card, pageHead, table, btn, input, textarea, select, field, readFileAsDataURL } from "../core/ui.js";
import { can, normaliseRole } from "../core/rbac.js";

const DEFAULT_CLASSES = [
  { id:"noorani", title:"Noorani Qaida", level:"Beginner", duration:"30 min/class", icon:"📖", description:"Build correct Arabic letter recognition and foundational reading skills before advancing to Qur'an recitation." },
  { id:"tajweed", title:"Qur'an Reading with Tajweed", level:"All Levels", duration:"30 min/class", icon:"🕌", description:"Master the rules of proper Qur'anic recitation with certified Qaris. Learn pronunciation, rhythm, and the beauty of reciting." },
  { id:"hifz", title:"Memorizing the Qur'an (Hifz)", level:"All Levels", duration:"30 min/class", icon:"🌙", description:"A personalised Hifz programme with revision strategies and full support on your memorization journey." },
  { id:"islamic", title:"Basic Islamic Education", level:"All Levels", duration:"30 min/class", icon:"☪️", description:"Fiqh, Aqeedah, Seerah, Islamic history, Duas, and more in a comprehensive Islamic education for children and adults." },
  { id:"salah", title:"Complete Namaz (Salah)", level:"All Levels", duration:"30 min/class", icon:"🤲", description:"Learn to perform Salah correctly, including preparation, recitation, movements, and the meanings of the verses." },
  { id:"tafseer", title:"Translation and Tafseer", level:"Advanced", duration:"30 min/class", icon:"✨", description:"Deep dive into the meanings, context, and interpretation of Qur'anic verses to connect with the message of Allah." }
];

function classes() { const saved = db.setting("onlineClasses")?.list; return Array.isArray(saved) && saved.length ? saved : DEFAULT_CLASSES; }
function save(list) { db.saveSetting("onlineClasses", { list }); applyOnlineClasses({ list }); }
function emailKey(value) { return String(value || "").trim().toLowerCase(); }
function approved(registration) { return ["Approved", "Enrolled"].includes(registration?.status); }
function registrationFor(course, email) { return db.query("onlineRegistrations", (item) => item.courseId === course.id && emailKey(item.email) === emailKey(email)).sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))[0]; }

export function applyOnlineClasses(value) {
  const list = Array.isArray(value?.list) && value.list.length ? value.list : DEFAULT_CLASSES;
  const host = document.getElementById("online-classes-list");
  if (!host) return;
  host.innerHTML = "";
  list.filter(c => c.active !== false).forEach((course) => {
    const item = document.createElement("article"); item.className = "online-course-card";
    const visual = document.createElement("div"); visual.className = "online-course-visual";
    if (course.image) { visual.style.backgroundImage = `linear-gradient(rgba(8,25,56,.25), rgba(8,25,56,.45)), url("${course.image}")`; visual.textContent = ""; }
    else visual.textContent = course.icon || "📖";
    const body = document.createElement("div"); body.className = "online-course-body";
    const level = document.createElement("span"); level.className = "online-course-level"; level.textContent = course.level || "All Levels";
    const title = document.createElement("h3"); title.textContent = course.title || "Online Class";
    const text = document.createElement("p"); text.textContent = course.description || "";
    const meta = document.createElement("div"); meta.className = "online-course-meta"; meta.textContent = `${course.level || "All Levels"}  •  ${course.duration || "Schedule to be announced"}`;
    const link = document.createElement("button"); link.className = "online-course-cta"; link.textContent = "Register online →"; link.onclick = () => openPublicRegistration(course);
    body.append(level, title, text, meta, link); item.append(visual, body); host.appendChild(item);
  });
}

export function openPublicRegistration(course) {
  if (!course?.id) return;
  const fullName = input({ placeholder:"Learner's full name", autocomplete:"name" });
  const email = input({ type:"email", placeholder:"name@example.com", autocomplete:"email" });
  const phone = input({ type:"tel", placeholder:"WhatsApp / phone number", autocomplete:"tel" });
  const guardian = input({ placeholder:"Parent or guardian name (if applicable)" });
  const country = input({ placeholder:"City and country" });
  const schedule = select([
    { value:"", label:"Select a preferred time" },
    { value:"Weekday morning", label:"Weekday morning" }, { value:"Weekday afternoon", label:"Weekday afternoon" },
    { value:"Weekday evening", label:"Weekday evening" }, { value:"Weekend", label:"Weekend" }
  ]);
  const notes = textarea({ rows:3, placeholder:"Learner age, current level, or anything our teacher should know" });
  // A hidden field catches basic automated submissions without affecting real visitors.
  const website = input({ tabindex:"-1", autocomplete:"off" }); website.style.cssText = "position:absolute;left:-10000px;opacity:0;pointer-events:none";
  const body = el("div", { class:"form-grid" }, [
    field("Course", el("div", { class:"input", text:course.title }), { full:true }),
    field("Full name", fullName), field("Email address", email), field("Phone / WhatsApp", phone), field("Parent / guardian", guardian),
    field("Location", country), field("Preferred time", schedule), field("Notes", notes, { full:true }), website
  ]);
  const dialog = modal({ title:"Register for an Online Class", size:"lg", body, footer:[
    btn("Submit registration", { variant:"primary", onclick: async() => {
      if (!fullName.value.trim() || !email.value.trim() || !phone.value.trim()) return toast("Please enter the learner's name, email address, and phone number.", "error");
      if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return toast("Enter a valid email address.", "error");
      const submit = dialog.dialog.querySelector("button.btn-primary"); if (submit) { submit.disabled = true; submit.textContent = "Submitting…"; }
      try {
        const client = getState().client;
        if (!client) throw new Error("The registration service is still loading. Please try again in a moment.");
        const { data, error } = await client.functions.invoke("register-online-class", { body:{
          courseId:course.id, fullName:fullName.value, email:email.value, phone:phone.value, guardianName:guardian.value,
          location:country.value, preferredSchedule:schedule.value, notes:notes.value, website:website.value
        }});
        if (error) {
          let message = error.message;
          if (typeof error.context?.json === "function") { try { message = (await error.context.json())?.error || message; } catch {} }
          throw new Error(message || "Registration could not be submitted.");
        }
        if (data?.error) throw new Error(data.error);
        dialog.close();
        const reference = data?.reference || "submitted";
        const confirmation = modal({ title:"Registration received", body:el("div", {}, [
          el("p", { text:`Thank you, ${fullName.value.trim()}. Your request for ${course.title} has been received.` }),
          el("p", { class:"notice success", text:`Registration reference: ${reference}` }),
          el("p", { class:"muted", text:"Our team will review your request and contact you using the details provided. Keep this reference for your records." })
        ]), footer:[btn("Done", { variant:"primary", onclick:()=>confirmation.close() })] });
      } catch (error) {
        toast(error.message || "Registration could not be submitted.", "error");
        if (submit) { submit.disabled = false; submit.textContent = "Submit registration"; }
      }
    }}), btn("Cancel", { onclick:()=>dialog.close() })
  ]});
}

window.openOnlineClassRegistration = openPublicRegistration;

export function render(root, ctx) {
  const role = normaliseRole(ctx.user.role);
  const canManage = can(role, "manageSettings");
  const studentView = role === "Student";
  root.appendChild(pageHead(canManage ? "Online Class Manager" : "Online Classes", canManage ? "Create courses, review online registrations, and release secure class links to approved learners." : "Your approved class links appear here after registration is confirmed."));
  const host = el("div"); root.appendChild(host);
  const draw = () => {
    const rows = classes(); host.innerHTML = "";
    if (canManage) {
      host.appendChild(el("div", { class:"row", style:"margin-bottom:14px" }, [btn("+ New Online Class", { variant:"primary", onclick: () => openForm(null) })]));
      host.appendChild(card("Online Course Catalogue", [table([
        { label:"Course", key:"title" }, { label:"Level", key:"level" }, { label:"Schedule", key:"schedule" }, { label:"Duration", key:"duration" },
        { label:"Meeting", render:c => c.meetingUrl ? "Configured" : "Not configured" },
        { label:"", render:c => el("div", { class:"row" }, [btn("Edit", { sm:true, variant:"primary", onclick:()=>openForm(c) }), btn("Delete", { sm:true, variant:"danger", onclick:()=>remove(c) })]) }
      ], rows, { empty:"No online classes yet." })]));
      const registrations = db.query("onlineRegistrations", () => true).sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
      host.appendChild(card(`Online Registration Requests (${registrations.length})`, [table([
        { label:"Reference", key:"reference" }, { label:"Learner", render:r=>el("div", {}, [el("strong", { text:r.fullName }), el("small", { class:"muted", text:r.email })]) },
        { label:"Course", key:"courseTitle" }, { label:"Contact", render:r=>r.phone || "—" }, { label:"Preferred time", render:r=>r.preferredSchedule || "—" },
        { label:"Status", render:r=>el("span", { class:`badge ${approved(r) ? "green" : r.status === "Declined" ? "red" : "amber"}`, text:r.status || "Pending" }) },
        { label:"", render:r=>el("div", { class:"row" }, [btn("Review", { sm:true, variant:"primary", onclick:()=>review(r) })]) }
      ], registrations, { empty:"New online class registrations will appear here instantly." })]));
    } else {
      host.appendChild(card("Available Courses", [table([
        { label:"Course", key:"title" }, { label:"Level", key:"level" }, { label:"Schedule", render:c=>c.schedule || "To be announced" }, { label:"Duration", key:"duration" },
        { label:"", render:c => {
          const registration = registrationFor(c, ctx.user.email);
          if (c.meetingUrl && approved(registration)) return btn("Join Class", { sm:true, variant:"primary", onclick:()=>window.open(c.meetingUrl, "_blank", "noopener") });
          if (registration) return el("span", { class:"muted", text:`Registration ${String(registration.status || "Pending").toLowerCase()}` });
          return el("span", { class:"muted", text:"Register on the public website" });
        } }
      ], rows.filter(c=>c.active !== false), { empty:"No online classes are available yet." })]));
      if (studentView) host.appendChild(el("p", { class:"muted", style:"margin-top:12px", text:"After approval, the secure Join Class button becomes available here. Your teacher will contact you with the schedule." }));
    }
  };
  const offSettings = db.on("settings", draw);
  const offRegistrations = db.on("onlineRegistrations", draw);
  draw();
  return () => { offSettings(); offRegistrations(); };

  function openForm(existing) {
    const record = existing ? { ...existing } : { id:uuid(), title:"", level:"All Levels", duration:"30 min/class", schedule:"", icon:"📖", description:"", meetingUrl:"", active:true };
    const title = input({ value:record.title, placeholder:"Course title" });
    const level = select(["Beginner", "Intermediate", "Advanced", "All Levels"].map(x=>({ value:x, label:x, selected:x===record.level })));
    const duration = input({ value:record.duration, placeholder:"e.g. 30 min/class" });
    const schedule = input({ value:record.schedule || "", placeholder:"e.g. Saturdays, 10:00 AM" });
    const icon = input({ value:record.icon || "📖", placeholder:"Emoji icon" });
    const meetingUrl = input({ type:"url", value:record.meetingUrl || "", placeholder:"https://meet.google.com/... or Zoom link" });
    const description = textarea({ value:record.description, rows:4, placeholder:"Course description" });
    const image = input({ type:"file", accept:"image/*" });
    const preview = el("div", { style:"height:95px;border:1px dashed var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden" });
    const showPreview = () => preview.innerHTML = record.image ? `<img src="${record.image}" style="width:100%;height:100%;object-fit:cover">` : "No course image";
    showPreview(); image.onchange = async()=>{ if(image.files?.[0]) { record.image = await readFileAsDataURL(image.files[0]); showPreview(); } };
    const body = el("div", { class:"form-grid" }, [field("Course title", title, { full:true }), field("Level", level), field("Duration", duration), field("Schedule", schedule), field("Icon", icon), field("Secure meeting link", meetingUrl, { full:true }), field("Description", description, { full:true }), field("Course image", el("div", { style:"display:grid;gap:8px" }, [preview,image]), { full:true })]);
    const dialog = modal({ title: existing ? "Edit Online Class" : "New Online Class", size:"lg", body, footer:[btn("Save", { variant:"primary", onclick:()=>{
      if (!title.value.trim()) return toast("Course title is required.", "error");
      const url = meetingUrl.value.trim(); if (url && !/^https:\/\//i.test(url)) return toast("Meeting link must start with https://", "error");
      Object.assign(record, { title:title.value.trim(), level:level.value, duration:duration.value.trim(), schedule:schedule.value.trim(), icon:icon.value.trim(), meetingUrl:url, description:description.value.trim() });
      const list = classes().filter(c=>c.id!==record.id); list.push(record); save(list); dialog.close(); toast("Online class saved and synced.", "success"); draw();
    }}), btn("Cancel", { onclick:()=>dialog.close() })]});
  }
  function review(registration) {
    const status = select(["Pending", "Approved", "Enrolled", "Waitlisted", "Declined"].map(value=>({ value, label:value, selected:value === (registration.status || "Pending") })));
    const adminNotes = textarea({ rows:3, value:registration.adminNotes || "", placeholder:"Internal follow-up note (optional)" });
    const detail = el("div", { class:"form-grid" }, [
      field("Learner", el("div", { class:"input", text:registration.fullName || "" }), { full:true }), field("Email", el("div", { class:"input", text:registration.email || "" }), { full:true }),
      field("Phone", el("div", { class:"input", text:registration.phone || "" })), field("Course", el("div", { class:"input", text:registration.courseTitle || "" })),
      field("Status", status), field("Preferred time", el("div", { class:"input", text:registration.preferredSchedule || "Not provided" })),
      field("Learner notes", el("div", { class:"input", text:registration.notes || "No notes" }), { full:true }), field("Admin notes", adminNotes, { full:true })
    ]);
    const dialog = modal({ title:`Review ${registration.reference || "registration"}`, size:"lg", body:detail, footer:[btn("Save decision", { variant:"primary", onclick:()=>{
      const next = { ...registration, status:status.value, adminNotes:adminNotes.value.trim(), reviewedAt:Date.now(), reviewedBy:ctx.user.email, updatedAt:Date.now() };
      db.save("onlineRegistrations", next); dialog.close(); toast("Registration status updated and synced.", "success"); draw();
    }}), btn("Cancel", { onclick:()=>dialog.close() })] });
  }
  async function remove(course) { if (await confirmDialog(`Delete "${course.title}"?`, { danger:true, okText:"Delete" })) { save(classes().filter(c=>c.id!==course.id)); toast("Online class deleted.", "success"); draw(); } }
}
