import { db } from "../core/db.js";
import { lazyListen } from "../core/adapter.js";
import { el, fmtDateTime, debounce } from "../core/utils.js";
import { card, pageHead, table, input } from "../core/ui.js";
import { can } from "../core/rbac.js";

export function render(root, ctx) {
  lazyListen("auditLogs");
  root.appendChild(pageHead("Audit Trail", "System activity log."));
  if (!can(ctx.user.role, "viewAudit")) { root.appendChild(card("Access", [el("p", { class: "muted", text: "You do not have permission to view the audit trail." })])); return; }
  const search = input({ placeholder: "Filter logs\u2026", style: "max-width:320px" });
  root.appendChild(el("div", { class: "row", style: "margin-bottom:14px" }, [search]));
  const host = el("div");
  root.appendChild(host);
  const draw = () => {
    const q = (search.value || "").toLowerCase();
    let rows = db.list("auditLogs").sort((a, b) => (b.at || 0) - (a.at || 0));
    if (q) rows = rows.filter((l) => `${l.type} ${l.message} ${l.email || ""}`.toLowerCase().includes(q));
    rows = rows.slice(0, 300);
    host.innerHTML = "";
    host.appendChild(card("", [table([
      { label: "When", render: (l) => fmtDateTime(l.at) }, { label: "Type", key: "type" },
      { label: "Message", key: "message" }, { label: "User", render: (l) => l.email || l.uid || "" }
    ], rows, { empty: "No activity logged yet" })]));
  };
  draw();
  search.oninput = debounce(draw, 200);
  const off = db.on("auditLogs", draw);
  return () => off();
}
