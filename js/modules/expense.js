import { db } from "../core/db.js";
import { el, toast, naira, num, fmtDate, todayISO, modal, uuid, sumBy } from "../core/utils.js";
import { card, pageHead, table, btn, input, select, field, textarea } from "../core/ui.js";
import { nextExpenseNo } from "../core/idgen.js";

const CATEGORIES = ["Salaries", "Utilities", "Maintenance", "Supplies", "Transport", "Feeding", "Rent", "Miscellaneous"];

export function render(root, ctx) {
  root.appendChild(pageHead("Expenses", "Record and review school expenditure.", [btn("Add Expense", { variant: "primary", icon: "+", onclick: () => addExpense(ctx) })]));
  const host = el("div");
  root.appendChild(host);
  const draw = () => {
    const rows = db.list("expenses").sort((a, b) => b.date - a.date);
    const total = sumBy(rows, (r) => r.amount);
    host.innerHTML = "";
    host.appendChild(el("div", { class: "row", style: "margin-bottom:12px" }, [el("div", { class: "card stat", style: "flex:1" }, [el("div", { class: "ic", text: "\uD83D\uDCC9" }), el("div", {}, [el("div", { class: "v", text: naira(total) }), el("div", { class: "l", text: "Total Expenses" })])])]));
    host.appendChild(card("", [table([
      { label: "No", key: "expenseNo" }, { label: "Category", key: "category" }, { label: "Description", key: "description" },
      { label: "Amount", align: "right", render: (r) => naira(r.amount) }, { label: "Date", render: (r) => fmtDate(r.date) }, { label: "By", key: "by" }
    ], rows, { empty: "No expenses recorded" })]));
  };
  draw();
  const off = db.on("expenses", draw);
  return () => off();
}

function addExpense(ctx) {
  const cat = select(() => CATEGORIES.map((c) => ({ value: c, label: c })));
  const amount = input({ type: "number", min: "0" });
  const date = input({ type: "date", value: todayISO() });
  const desc = textarea({ rows: 2 });
  const body = el("div", { class: "form-grid" }, [field("Category", cat), field("Amount (\u20A6)", amount), field("Date", date), field("Description", desc, { full: true })]);
  const m = modal({ title: "Add Expense", body, footer: [btn("Save", { variant: "primary", onclick: async () => {
    if (num(amount.value) <= 0) return toast("Enter an amount", "error");
    const expenseNo = await nextExpenseNo();
    db.save("expenses", { id: uuid(), expenseNo, category: cat.value, amount: num(amount.value), date: new Date(date.value).getTime(), description: desc.value, by: ctx.user.name });
    db.save("auditLogs", { id: uuid(), type: "expense", uid: ctx.user.uid, at: Date.now(), message: `Recorded expense ${naira(num(amount.value))} (${cat.value})` });
    toast("Expense recorded", "success"); m.close();
  } })] });
}
