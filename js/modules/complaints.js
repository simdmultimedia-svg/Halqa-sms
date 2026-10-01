import { db } from "../core/db.js";
import { el, toast, uuid, fmtDateTime } from "../core/utils.js";
import { btn, card, pageHead, table, textarea } from "../core/ui.js";
import { can } from "../core/rbac.js";

export function render(root, ctx) {
  root.appendChild(pageHead("Complaints", "Submit and track salary or account complaints."));
  const seeAll = can(ctx.user.role, "manageSalary") || ctx.user.role === "Admin" || ctx.user.role === "Super Admin";
  const note = textarea({ placeholder: "Describe the complaint clearly..." });
  const submit = btn("Submit Complaint", { variant: "primary", onclick: () => {
    const message = note.value.trim();
    if (!message) return toast("Enter complaint details.", "error");
    db.save("salaryComplaints", {
      id: uuid(),
      uid: ctx.user.uid,
      staffId: ctx.user.staffId || null,
      email: ctx.user.email,
      name: ctx.user.name || ctx.user.email,
      message,
      status: "open",
      createdAt: Date.now()
    });
    note.value = "";
    toast("Complaint submitted.", "success");
  }});
  const host = el("div");
  root.appendChild(card("New Complaint", [note, el("div", { class: "row", style: "margin-top:10px" }, [submit])]));
  root.appendChild(host);

  const draw = () => {
    let rows = db.list("salaryComplaints");
    if (!seeAll) rows = rows.filter((r) => r.uid === ctx.user.uid || r.staffId === ctx.user.staffId || r.email === ctx.user.email);
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    host.innerHTML = "";
    host.appendChild(card("Complaint History", [table([
      { label: "Date", render: (r) => fmtDateTime(r.createdAt || r.at) },
      { label: "User", render: (r) => r.name || r.email || "-" },
      { label: "Message", key: "message" },
      { label: "Status", render: (r) => r.status || "open" }
    ], rows, { empty: "No complaints yet." })]));
  };
  draw();
  const off = db.on("salaryComplaints", draw);
  return () => off();
}
