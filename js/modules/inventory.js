import { db } from "../core/db.js";
import { el, toast, naira, num, modal, uuid, confirmDialog } from "../core/utils.js";
import { card, pageHead, table, btn, input, select, field } from "../core/ui.js";
import { calculateInventoryValue } from "../core/calculations.js";

const CATS = ["Books", "Uniforms", "Furniture", "Stationery", "Electronics", "Sports", "Other"];

export function render(root, ctx) {
  root.appendChild(pageHead("Inventory", "Track school assets and consumables.", [btn("Add Item", { variant: "primary", icon: "+", onclick: () => edit(null) })]));
  const host = el("div");
  root.appendChild(host);
  const draw = () => {
    const rows = db.list("inventory").sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    // Filter out corrupted or hidden records
    const validRows = rows.filter(r => r && r.id && r.name && r.name.trim() !== "");
    
    // Group duplicates by name to prevent double counting if UI accidentally created duplicates
    const uniqueItems = new Map();
    validRows.forEach(r => {
      const key = r.name.trim().toLowerCase();
      if (!uniqueItems.has(key)) {
        uniqueItems.set(key, { ...r });
      } else {
        const existing = uniqueItems.get(key);
        existing.openingStock = num(existing.openingStock) + num(r.openingStock) + (r.quantity ? num(r.quantity) : 0);
        existing.addedStock = num(existing.addedStock) + num(r.addedStock);
        existing.issuedStock = num(existing.issuedStock) + num(r.issuedStock);
        // Clean up the duplicate from db
        db.remove("inventory", r.id);
        db.save("inventory", existing);
      }
    });
    
    const displayRows = Array.from(uniqueItems.values()).map(r => {
      // Migrate old quantity if present
      const opening = num(r.openingStock) + (r.quantity !== undefined ? num(r.quantity) : 0);
      const added = num(r.addedStock);
      const issued = num(r.issuedStock);
      const remaining = opening + added - issued;
      
      // Auto-update legacy data structure
      if (r.quantity !== undefined || r.remainingStock !== remaining) {
        r.openingStock = opening;
        r.addedStock = added;
        r.issuedStock = issued;
        r.remainingStock = remaining;
        delete r.quantity;
        db.save("inventory", r);
      }
      
      return { ...r, opening, added, issued, remaining };
    });
    
    host.innerHTML = "";
    host.appendChild(card("", [table([
      { label: "Item", key: "name" }, 
      { label: "Category", key: "category" }, 
      { label: "Opening", key: "opening" },
      { label: "Added", key: "added" },
      { label: "Issued", key: "issued" },
      { label: "Remaining", key: "remaining" },
      { label: "Unit Cost", align: "right", render: (r) => naira(r.unitCost) }, 
      { label: "Value", align: "right", render: (r) => naira(calculateInventoryValue(r.remaining, r.unitCost)) },
      { label: "", render: (r) => el("div", { class: "row" }, [btn("Edit", { sm: true, onclick: () => edit(r.id) }), btn("\u2715", { sm: true, variant: "danger", onclick: () => del(r.id) })]) }
    ], displayRows, { empty: "No inventory items" })]));
    
    // Safely calculate total value, preventing string concatenation and counting only valid rows
    let grandTotal = 0;
    displayRows.forEach(r => {
      grandTotal += calculateInventoryValue(r.remaining, r.unitCost);
    });
    
    host.appendChild(card("", [
      el("div", { style: "display: flex; justify-content: flex-end; font-size: 1.2rem;" }, [
        el("b", { text: "Total Stock Value: " }),
        el("span", { text: naira(grandTotal), style: "margin-left: 10px; color: var(--primary);" })
      ])
    ]));
  };
  draw();
  const off = db.on("inventory", draw);
  return () => off();

  function edit(id) {
    const r = id ? { ...db.get("inventory", id) } : {};
    // Fallback logic for legacy records
    const initialOpening = num(r.openingStock) + (r.quantity !== undefined ? num(r.quantity) : 0);
    
    const name = input({ value: r.name || "" });
    const cat = select(() => CATS.map((c) => ({ value: c, label: c, selected: r.category === c })));
    const opening = input({ type: "number", value: initialOpening });
    const added = input({ type: "number", value: num(r.addedStock) });
    const issued = input({ type: "number", value: num(r.issuedStock) });
    const cost = input({ type: "number", value: num(r.unitCost) });
    
    const body = el("div", { class: "form-grid" }, [
      field("Item Name", name, { full: true }), 
      field("Category", cat), 
      field("Opening Stock", opening), 
      field("Added Stock", added), 
      field("Issued Stock", issued), 
      field("Unit Cost (\u20A6)", cost)
    ]);
    
    const m = modal({ title: id ? "Edit Item" : "Add Item", body, footer: [btn("Save", { variant: "primary", onclick: () => {
      if (!name.value.trim()) return toast("Name required", "error");
      
      const op = num(opening.value);
      const add = num(added.value);
      const iss = num(issued.value);
      const rem = op + add - iss;
      
      db.save("inventory", { 
        id: r.id || uuid(), 
        name: name.value.trim(), 
        category: cat.value, 
        openingStock: op,
        addedStock: add,
        issuedStock: iss,
        remainingStock: rem,
        unitCost: num(cost.value) 
      });
      toast("Saved", "success"); m.close();
    } })] });
  }
  async function del(id) { if (await confirmDialog("Delete this item?", { danger: true, okText: "Delete" })) { db.remove("inventory", id); toast("Deleted", "success"); } }
}
