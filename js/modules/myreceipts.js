import { el } from "../core/utils.js";
export async function render(root, ctx) {
  if (!ctx.user.studentId) {
    root.innerHTML = "<div class='card'><p class='muted'>No student linked to this account.</p></div>";
    return;
  }
  const m = await import("./receipts.js");
  return m.render(root, { ...ctx, param: ctx.user.studentId });
}
