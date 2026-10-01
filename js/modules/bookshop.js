// Bookshop Module — per-book catalog with class/section/price/stock management.
// Books are sold as part of the invoice; no separate payment is created.
import { db } from "../core/db.js";
import { el, toast, naira, num, fmtDate, modal, confirmDialog } from "../core/utils.js";
import { card, pageHead, table, btn, input, field, select, statCard } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { uuid } from "../core/utils.js";

export function render(root, ctx) {
  if (ctx.param === "reports") return renderReports(root, ctx);
  renderMain(root, ctx);
}

function renderMain(root, ctx) {
  root.appendChild(pageHead("Bookshop", "Manage the school bookshop catalogue. Books are automatically added to student invoices during registration."));

  // Stats row
  const statsWrap = el("div", { class: "grid grid-4", style: "margin-bottom:16px" });
  root.appendChild(statsWrap);

  // Controls
  const addBtn = btn("+ Add Book", { variant: "primary", onclick: () => openBookForm(null, draw) });
  const rptBtn = btn("📊 Reports", { variant: "ghost", onclick: () => ctx.go("bookshop", "reports") });
  const filterSection = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map(s => ({ value: s.id, label: s.name }))]);
  const filterClass = select(() => [{ value: "", label: "All Classes" }]);
  const searchInp = input({ placeholder: "Search books…", style: "max-width:220px" });

  filterSection.onchange = () => {
    const classes = cfg.classes(filterSection.value);
    filterClass.innerHTML = "";
    filterClass.appendChild(el("option", { value: "", text: "All Classes" }));
    classes.forEach(c => filterClass.appendChild(el("option", { value: c.id, text: c.name })));
    draw();
  };
  filterClass.onchange = draw;
  searchInp.oninput = draw;

  root.appendChild(el("div", { class: "row", style: "margin-bottom:14px;flex-wrap:wrap;gap:8px" }, [addBtn, rptBtn, searchInp, filterSection, filterClass]));

  const host = el("div");
  root.appendChild(host);

  function getBooks() {
    return db.query("books", () => true).sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }

  function draw() {
    // Stats
    const all = getBooks();
    const totalBooks = all.length;
    const totalStock = all.reduce((s, b) => s + num(b.stock), 0);
    const revenue = db.list("invoices").reduce((sum, inv) => sum + (inv.services || []).filter(l => l.type === "book").reduce((a, l) => a + num(l.amount), 0), 0);
    const lowStock = all.filter(b => num(b.stock) <= num(b.reorderLevel || 5)).length;
    statsWrap.innerHTML = "";
    statsWrap.appendChild(statCard("📚", "Total Books", totalBooks));
    statsWrap.appendChild(statCard("📦", "Total Stock", totalStock));
    statsWrap.appendChild(statCard("💰", "Revenue", naira(revenue)));
    statsWrap.appendChild(statCard("⚠️", "Low Stock", lowStock));

    // Filter
    const q = (searchInp.value || "").toLowerCase();
    let rows = getBooks();
    if (filterSection.value) rows = rows.filter(b => b.sectionId === filterSection.value);
    if (filterClass.value) rows = rows.filter(b => b.classId === filterClass.value);
    if (q) rows = rows.filter(b => (b.title || "").toLowerCase().includes(q) || (b.subject || b.category || "").toLowerCase().includes(q) || (b.isbn || "").toLowerCase().includes(q));

    host.innerHTML = "";
    host.appendChild(card("Book Catalogue", [table([
      { label: "Title", key: "title" },
      { label: "Subject", render: b => b.subject || b.category || "-" },
      { label: "Section", render: b => cfg.sectionName(b.sectionId) },
      { label: "Class", render: b => b.classId ? cfg.className(b.classId) : "All Classes" },
      { label: "Price", align: "right", render: b => naira(b.sellingPrice || b.price) },
      { label: "Stock", align: "right", render: b => {
        const s = num(b.stock);
        return el("span", { style: s <= num(b.reorderLevel || 5) ? "color:var(--danger);font-weight:600" : "", text: String(s) });
      }},
      { label: "Status", render: b => el("span", {
        class: "badge " + (b.status === "available" ? "badge-success" : "badge-muted"),
        text: b.status || "available"
      })},
      { label: "", render: b => el("div", { class: "row", style: "gap:4px" }, [
        btn("Edit", { sm: true, variant: "ghost", onclick: () => openBookForm(b, draw) }),
        btn("Delete", { sm: true, variant: "danger", onclick: () => {
          confirmDialog(`Delete "${b.title}"?`, () => { db.delete("books", b.id); toast("Book deleted", "success"); draw(); });
        }})
      ])}
    ], rows, { empty: "No books in catalogue. Click '+ Add Book' to get started." })]));
  }

  draw();
  const off = db.on("books", draw);
  return () => off();
}

function openBookForm(existing, onSaved) {
  const titleInp = input({ value: existing?.title || "", placeholder: "e.g. Mathematics Textbook SS1" });
  const subjectInp = input({ value: existing?.subject || existing?.category || "", placeholder: "e.g. Mathematics" });
  const isbnInp = input({ value: existing?.isbn || "", placeholder: "ISBN (optional)" });
  const authorInp = input({ value: existing?.author || "", placeholder: "Author" });
  const publisherInp = input({ value: existing?.publisher || "", placeholder: "Publisher" });
  const costInp = input({ type: "number", value: existing?.costPrice || 0, min: 0 });
  const priceInp = input({ type: "number", value: existing?.sellingPrice || existing?.price || 0, min: 0 });
  const stockInp = input({ type: "number", value: existing?.stock || 0, min: 0 });
  const reorderInp = input({ type: "number", value: existing?.reorderLevel || 5, min: 0 });
  const statusSel = select(() => [
    { value: "available", label: "Available", selected: (existing?.status || "available") === "available" },
    { value: "out_of_stock", label: "Out of Stock", selected: existing?.status === "out_of_stock" },
    { value: "inactive", label: "Inactive", selected: existing?.status === "inactive" }
  ]);

  const sectionSel = select(() => [{ value: "", label: "All Sections" }, ...cfg.sections().map(s => ({
    value: s.id, label: s.name, selected: s.id === existing?.sectionId
  }))]);

  const classSel = select(() => [{ value: "", label: "All Classes" }]);
  const fillClasses = () => {
    classSel.innerHTML = "";
    classSel.appendChild(el("option", { value: "", text: "All Classes" }));
    cfg.classes(sectionSel.value).forEach(c =>
      classSel.appendChild(el("option", { value: c.id, text: c.name, selected: c.id === existing?.classId }))
    );
    if (existing?.classId) classSel.value = existing.classId;
  };
  sectionSel.onchange = fillClasses;
  fillClasses();

  const sessionSel = select(() => [
    { value: "", label: "All Sessions" },
    ...Object.keys(cfg.sessions()).filter(k => k !== "current" && k !== "currentTerm").map(s => ({ value: s, label: s })),
    ...(cfg.currentSession() ? [{ value: cfg.currentSession(), label: cfg.currentSession() + " (Current)", selected: !existing?.session }] : [])
  ]);
  if (existing?.session) sessionSel.value = existing.session;

  const body = el("div", { class: "form-grid" }, [
    field("Book Title", titleInp, { full: true }),
    field("Subject", subjectInp),
    field("Section", sectionSel),
    field("Class", classSel),
    field("ISBN (Optional)", isbnInp),
    field("Session", sessionSel),
    field("Author", authorInp),
    field("Publisher", publisherInp),
    field("Cost Price (Naira)", costInp),
    field("Selling Price (Naira)", priceInp),
    field("Stock Quantity", stockInp),
    field("Reorder Level", reorderInp),
    field("Status", statusSel)
  ]);

  const saveBtn = btn("Save Book", { variant: "primary", onclick: () => {
    if (!titleInp.value.trim()) { toast("Book title is required", "error"); return; }
    const sellingPrice = num(priceInp.value);
    const book = {
      id: existing?.id || uuid(),
      title: titleInp.value.trim(),
      subject: subjectInp.value.trim(),
      category: subjectInp.value.trim(),
      isbn: isbnInp.value.trim(),
      author: authorInp.value.trim(),
      publisher: publisherInp.value.trim(),
      sectionId: sectionSel.value,
      classId: classSel.value,
      session: sessionSel.value || cfg.currentSession(),
      costPrice: num(costInp.value),
      sellingPrice,
      price: sellingPrice,
      stock: num(stockInp.value),
      reorderLevel: num(reorderInp.value),
      status: statusSel.value || "available",
      updatedAt: Date.now(),
      createdAt: existing?.createdAt || Date.now()
    };
    db.save("books", book);
    toast("Book saved", "success");
    m.close();
    onSaved();
  }});
  const cancelBtn = btn("Cancel", { onclick: () => m.close() });
  const m = modal({ title: existing ? "Edit Book" : "Add Book", size: "lg", body, footer: [cancelBtn, saveBtn] });
  return m;
}
// Books selector for use in admission/registration flows
export function bookSelector(sectionId, classId, { onSelectionChange } = {}) {
  const session = cfg.currentSession();
  const books = db.query("books", b =>
    (b.status || "available") === "available" && num(b.stock) > 0 &&
    (!b.sectionId || b.sectionId === sectionId) &&
    (!b.classId || b.classId === classId) &&
    (!b.session || b.session === session)
  ).sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  if (!books.length) return null;

  const rows = [];
  const wrap = el("div");
  wrap.appendChild(el("p", { class: "muted", style: "margin-bottom:8px",
    text: "Select the books to include in the invoice. Books are loaded for this section and class." }));

  const selectAllCb = input({ type: "checkbox" });
  wrap.appendChild(el("label", { class: "svc-row", style: "margin-bottom:8px" }, [
    selectAllCb,
    el("span", { class: "nm", text: "Select All Books" }),
    el("span", { class: "amt", text: `${books.length} available` })
  ]));

  const tbl = el("table", { class: "data-table", style: "width:100%" });
  const thead = el("thead");
  thead.appendChild(el("tr", {}, [
    el("th", { text: "" }),
    el("th", { text: "Book Title" }),
    el("th", { text: "Subject" }),
    el("th", { text: "Stock", style: "text-align:right" }),
    el("th", { text: "Price", style: "text-align:right" })
  ]));
  tbl.appendChild(thead);
  const tbody = el("tbody");
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);

  books.forEach(book => {
    const cb = input({ type: "checkbox" });
    cb.onchange = () => {
      selectAllCb.checked = rows.length > 0 && rows.every(r => r.cb.checked);
      if (onSelectionChange) onSelectionChange(getSelectedLines());
    };
    const tr = el("tr", {}, [
      el("td", {}, [cb]),
      el("td", { text: book.title }),
      el("td", { class: "muted", text: book.subject || book.category || "-" }),
      el("td", { style: "text-align:right", text: String(num(book.stock)) }),
      el("td", { style: "text-align:right;font-weight:600", text: naira(book.sellingPrice || book.price) })
    ]);
    tbody.appendChild(tr);
    rows.push({ book, cb });
  });

  function getSelectedLines() {
    return rows.filter(r => r.cb.checked).map(r => ({
      id: "book-" + r.book.id,
      name: r.book.title,
      amount: num(r.book.sellingPrice || r.book.price),
      type: "book",
      bookId: r.book.id,
      subject: r.book.subject || r.book.category || "",
      isbn: r.book.isbn || "",
      author: r.book.author || "",
      publisher: r.book.publisher || "",
      quantity: 1,
      unitPrice: num(r.book.sellingPrice || r.book.price),
      optional: true
    }));
  }

  function selectAll(checked) {
    rows.forEach(r => r.cb.checked = checked);
    selectAllCb.checked = !!checked;
    if (onSelectionChange) onSelectionChange(getSelectedLines());
  }

  selectAllCb.onchange = () => selectAll(selectAllCb.checked);

  return { wrap, getSelectedLines, selectAll };
}
// Deduct stock when a book is sold (called from invoice creation)
export function deductBookStock(bookLines) {
  (bookLines || []).forEach(line => {
    if (!line.bookId) return;
    const book = db.get("books", line.bookId);
    if (book && num(book.stock) > 0) {
      db.save("books", { ...book, stock: Math.max(0, num(book.stock) - 1) });
    }
  });
}

// Bookshop reports
function renderReports(root, ctx) {
  root.appendChild(pageHead("Bookshop Reports", "Sales, stock, and revenue overview."));
  const backBtn = btn("← Back to Catalogue", { variant: "ghost", onclick: () => ctx.go("bookshop") });
  root.appendChild(backBtn);

  const books = db.query("books", () => true).sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  const invoices = db.list("invoices");

  // Compute sales per book
  const salesMap = {};
  invoices.forEach(inv => {
    (inv.services || []).filter(s => s.type === "book" && s.bookId).forEach(s => {
      if (!salesMap[s.bookId]) salesMap[s.bookId] = { qty: 0, revenue: 0 };
      salesMap[s.bookId].qty++;
      salesMap[s.bookId].revenue += num(s.amount);
    });
  });

  const rows = books.map(b => ({
    ...b,
    sold: (salesMap[b.id] || {}).qty || 0,
    revenue: (salesMap[b.id] || {}).revenue || 0,
    remaining: num(b.stock)
  }));

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalSold = rows.reduce((s, r) => s + r.sold, 0);

  const stats = el("div", { class: "grid grid-4", style: "margin-bottom:16px" });
  stats.appendChild(statCard("📚", "Books in Catalogue", books.length));
  stats.appendChild(statCard("🛒", "Total Books Sold", totalSold));
  stats.appendChild(statCard("💰", "Total Revenue", naira(totalRevenue)));
  stats.appendChild(statCard("📦", "Total Remaining Stock", rows.reduce((s, r) => s + r.remaining, 0)));
  root.appendChild(stats);

  root.appendChild(card("Book Sales Report", [table([
    { label: "Title", key: "title" },
    { label: "Section", render: b => cfg.sectionName(b.sectionId) },
    { label: "Class", render: b => b.classId ? cfg.className(b.classId) : "All" },
    { label: "Price", align: "right", render: b => naira(b.sellingPrice || b.price) },
    { label: "Sold", align: "right", render: b => String(b.sold) },
    { label: "Remaining", align: "right", render: b => {
      const rem = b.remaining;
      return el("span", { style: rem <= 5 ? "color:var(--danger);font-weight:600" : "", text: String(rem) });
    }},
    { label: "Revenue", align: "right", render: b => naira(b.revenue) }
  ], rows, { empty: "No books in catalogue." })]));
}




