export async function render(root, ctx) {
  const role = (ctx.user.role || "").toLowerCase().replace(/\s+/g, "_");
  if (["teacher", "staff", "exam_officer"].includes(role)) {
    const m = await import("./staffactivity.js");
    return m.render(root, { ...ctx, param: ctx.user.staffId });
  } else {
    const m = await import("./studentactivity.js");
    return m.render(root, { ...ctx, param: ctx.user.studentId });
  }
}
