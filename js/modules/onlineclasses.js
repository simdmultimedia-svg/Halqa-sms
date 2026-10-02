import { db } from "../core/db.js";
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
    const link = document.createElement("button"); link.className = "online-course-cta"; link.textContent = "Enroll through Student Portal →"; link.onclick = () => window.showLogin?.("student");
    body.append(level, title, text, meta, link); item.append(visual, body); host.appendChild(item);
  });
}

export function render(root, ctx) {
  const role = normaliseRole(ctx.user.role);
  const canManage = can(role, "manageSettings");
  const studentView = role === "Student";
  root.appendChild(pageHead(canManage ? "Online Class Manager" : "Online Classes", canManage ? "Create course catalogues, class schedules, images, and secure meeting links." : "Choose a course and join your scheduled online lesson."));
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
    } else {
      host.appendChild(card("Available Courses", [table([
        { label:"Course", key:"title" }, { label:"Level", key:"level" }, { label:"Schedule", render:c=>c.schedule || "To be announced" }, { label:"Duration", key:"duration" },
        { label:"", render:c => c.meetingUrl ? btn("Join Class", { sm:true, variant:"primary", onclick:()=>window.open(c.meetingUrl, "_blank", "noopener") }) : el("span", { class:"muted", text:"Enrollment required" }) }
      ], rows.filter(c=>c.active !== false), { empty:"No online classes are available yet." })]));
      if (studentView) host.appendChild(el("p", { class:"muted", style:"margin-top:12px", text:"Your teacher will provide the class schedule and enrolment details." }));
    }
  };
  const off = db.on("settings", draw); draw(); return () => off();

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
  async function remove(course) { if (await confirmDialog(`Delete "${course.title}"?`, { danger:true, okText:"Delete" })) { save(classes().filter(c=>c.id!==course.id)); toast("Online class deleted.", "success"); draw(); } }
}
