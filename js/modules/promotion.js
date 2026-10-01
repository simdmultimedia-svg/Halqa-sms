import { db } from "../core/db.js";
import { el, toast, confirmDialog, fmtDateTime, uuid } from "../core/utils.js";
import { card, pageHead, table, btn, select, field } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { can } from "../core/rbac.js";

export function render(root, ctx) {
  root.appendChild(pageHead("Promotion", "Promote students to the next class at the end of session. History, payments and results are retained."));
  if (!can(ctx.user.role, "promote")) { root.appendChild(card("Access", [el("p", { class: "muted", text: "Only Admin / Super Admin can run promotions." })])); return; }
  const host = el("div");

  const c = card("Run Promotion");
  const secSel = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map((s) => ({ value: s.id, label: s.name }))]);
  c.appendChild(el("div", { class: "form-grid" }, [field("Limit to Section (optional)", secSel)]));
  c.appendChild(el("p", { class: "muted", text: "Students in the final class of a section will be graduated automatically." }));
  c.appendChild(el("div", { class: "row", style: "margin-top:10px; gap: 10px;" }, [
    btn("Promote Students", { variant: "primary", icon: "⬆️", onclick: () => run(secSel.value) }),
    btn("Rollback Recent Promotion", { variant: "danger", icon: "⏪", onclick: () => rollback() })
  ]));
  root.appendChild(c);
  root.appendChild(host);

  function drawLogs() {
    const logs = db.list("promotionLogs").sort((a, b) => b.at - a.at).slice(0, 30);
    host.innerHTML = "";
    host.appendChild(card("Promotion Log", [table([
      { label: "When", render: (l) => fmtDateTime(l.at) }, { label: "By", key: "by" },
      { label: "Promoted", key: "promoted" }, { label: "Graduated", key: "graduated" }, { label: "Session", key: "session" }
    ], logs, { empty: "No promotions run yet" })]));
  }
  drawLogs();

  async function run(sectionId) {
    if (!(await confirmDialog("Run promotion now? This moves active students to their next class based on class order.", { okText: "Promote" }))) return;
    
    let students = db.query("students", (s) => (s.status || "active") === "active");
    if (sectionId) students = students.filter((s) => cfg.studentInSection(s, sectionId));
    
    let promoted = 0, graduated = 0;
    
    students.forEach((s) => {
      s.history = s.history || [];
      
      // Calculate next class dynamically from class ordering
      const secClasses = cfg.classes(s.sectionId);
      const currentIndex = secClasses.findIndex(c => c.id === s.classId);
      
      let nextClassId = null;
      if (currentIndex !== -1 && currentIndex + 1 < secClasses.length) {
        nextClassId = secClasses[currentIndex + 1].id;
      }

      if (nextClassId) {
        s.history.push({ type: "promotion", at: Date.now(), by: ctx.user.email, note: `${cfg.className(s.classId)} \u2192 ${cfg.className(nextClassId)}` });
        s.classId = nextClassId; 
        promoted++;
      } else {
        // Only graduate if they are in the highest class of the section
        s.status = "graduated";
        s.history.push({ type: "graduated", at: Date.now(), by: ctx.user.email, note: "Graduated (final class)" });
        graduated++;
      }
      db.save("students", s);
    });
    
    db.save("promotionLogs", { id: uuid(), at: Date.now(), by: ctx.user.email, promoted, graduated, session: cfg.currentSession() });
    db.save("auditLogs", { id: uuid(), type: "promotion", uid: ctx.user.uid, at: Date.now(), message: `Promoted ${promoted}, graduated ${graduated}` });
    toast(`Promoted ${promoted}, graduated ${graduated}`, "success", 4000);
    drawLogs();
  }

  async function rollback() {
    if (!(await confirmDialog("Undo recent promotions? This will scan students who were promoted or graduated in the last 48 hours and move them back one class.", { okText: "Rollback", danger: true }))) return;
    
    const students = db.query("students", s => s.history && s.history.length > 0);
    const threshold = Date.now() - (48 * 60 * 60 * 1000); // 48 hours
    
    let rolledBack = 0;
    
    students.forEach(s => {
      // Find the most recent promotion/graduation event
      const recentPromoIdx = s.history.findLastIndex(h => (h.type === "promotion" || h.type === "promoted" || h.type === "graduated") && h.at > threshold);
      if (recentPromoIdx !== -1) {
        const h = s.history[recentPromoIdx];
        
        // Rollback logic
        if (h.type === "graduated") {
          s.status = "active";
          // Their class is probably still the highest class
        } else {
          // They were promoted. Move them back one class.
          const secClasses = cfg.classes(s.sectionId);
          const currentIndex = secClasses.findIndex(c => c.id === s.classId);
          if (currentIndex > 0) {
            s.classId = secClasses[currentIndex - 1].id;
          }
        }
        
        // Remove the promotion history entry to prevent double-rollback and keep history clean
        s.history.splice(recentPromoIdx, 1);
        s.history.push({ type: "rollback", at: Date.now(), by: ctx.user.email, note: "Rolled back accidental promotion" });
        
        db.save("students", s);
        rolledBack++;
      }
    });
    
    db.save("auditLogs", { id: uuid(), type: "promotion_rollback", uid: ctx.user.uid, at: Date.now(), message: `Rolled back ${rolledBack} promotions` });
    toast(`Successfully rolled back ${rolledBack} students.`, "success");
    drawLogs();
  }
}
