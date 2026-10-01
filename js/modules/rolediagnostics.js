import { db } from "../core/db.js";
import { el } from "../core/utils.js";
import { card, pageHead, table } from "../core/ui.js";
import { allowedModules, can, normaliseRole } from "../core/rbac.js";

export function render(root, ctx) {
  if (!can(ctx.user.role, "manageRoles")) {
    root.appendChild(pageHead("Access Denied"));
    root.appendChild(card("Access Denied", [el("p", { class: "muted", text: "Only Admin / Super Admin can view role diagnostics." })]));
    return;
  }

  root.appendChild(pageHead("Role Diagnostics", "Compare user records, Firebase UID mappings, assigned roles, loaded roles, and allowed modules."));
  const host = el("div");
  root.appendChild(host);

  const draw = () => {
    const users = db.list("users").sort((a, b) => (a.email || "").localeCompare(b.email || ""));
    const rows = users.map((u) => {
      const uid = u.uid || u.id;
      const roleRec = db.get("userRoles", uid);
      const assignedRole = roleRec?.role || "";
      const loadedRole = normaliseRole(u.role || assignedRole);
      const canonicalAssigned = normaliseRole(assignedRole);
      const mismatch = !assignedRole || canonicalAssigned !== loadedRole || (roleRec?.email && u.email && roleRec.email !== u.email);
      return {
        ...u,
        uid,
        assignedRole,
        loadedRole,
        mismatch,
        allowed: allowedModules(loadedRole).join(", ")
      };
    });
    host.innerHTML = "";
    host.appendChild(card("Users & Roles", [table([
      { label: "User Name", render: (r) => r.name || "-" },
      { label: "Email", render: (r) => r.email || "-" },
      { label: "Firebase UID", render: (r) => r.uid || "-" },
      { label: "Assigned Role", render: (r) => r.assignedRole || "MISSING" },
      { label: "Loaded Role", render: (r) => r.loadedRole || "NONE" },
      { label: "Allowed Modules", render: (r) => r.allowed || "None" },
      { label: "Status", render: (r) => el("strong", { style: `color:${r.mismatch ? "#c62828" : "#2e7d32"}`, text: r.mismatch ? "Mismatch" : "OK" }) }
    ], rows, { empty: "No users found." })]));
  };

  draw();
  const offUsers = db.on("users", draw);
  const offRoles = db.on("userRoles", draw);
  return () => { offUsers(); offRoles(); };
}
