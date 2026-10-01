import { db } from "../core/db.js";
import { el, naira, num, slug, uuid } from "../core/utils.js";
import { input, select, btn, table } from "../core/ui.js";
import * as cfg from "../core/config.js";

export const UNIFORM_PACKAGE_OPTIONS = [
  { value: "", label: "No Uniform" },
  { value: "1", label: "One Set" },
  { value: "2", label: "Two Sets" },
  { value: "3", label: "Three Sets" },
  { value: "custom", label: "Custom Quantity" }
];

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  if (value && typeof value === "object") return Object.values(value).filter((v) => typeof v === "string");
  return [];
}

const DEFAULT_ITEMS = [
  "Sports Wear", "Cardigan", "School Cap", "School Tie", "School Belt", "School Socks",
  "School Sweater", "House Wear", "Lab Coat", "Prefect Uniform", "Hijab",
  "Customized School Bag", "Customized Water Bottle", "Other Uniform Items"
];

export function uniformCatalog() {
  return safeArray((db.setting("uniformItems") || {}).list).filter((i) => i && i.status !== "inactive");
}

export function uniformItemsFor(sectionId, classId) {
  return uniformCatalog().filter((item) => {
    const sections = safeArray(item.sectionIds);
    const classes = safeArray(item.classIds);
    return (!sections.length || sections.includes(sectionId)) &&
      (!classes.length || classes.includes(classId));
  }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export function uniformSetPrice(sectionId) {
  const settings = db.setting("uniformItems") || {};
  const bySection = settings.setPriceBySection || {};
  const legacy = cfg.uniformPrices(sectionId);
  return num(bySection[sectionId] || legacy["One Set"]);
}

export function buildUniformLines(sectionId, classId, selection = {}) {
  selection = selection && typeof selection === "object" ? selection : {};
  const lines = [];
  const quantity = num(selection.quantity);
  const setPrice = uniformSetPrice(sectionId);
  if (quantity > 0 && setPrice > 0) {
    lines.push({
      id: `uniform-set-${sectionId}-${quantity}`,
      name: `Uniform (${quantity} ${quantity === 1 ? "Set" : "Sets"})`,
      amount: setPrice * quantity,
      type: "uniform",
      uniformItemName: "Uniform",
      quantity,
      unitPrice: setPrice,
      optional: false,
      meta: { uniformQuantity: quantity, unitPrice: setPrice }
    });
  }
  const selectedIds = safeArray(selection.itemIds);
  uniformItemsFor(sectionId, classId).filter((item) => selectedIds.includes(item.id)).forEach((item) => {
    lines.push({
      id: `uniform-item-${item.id}`,
      name: item.name,
      amount: num(item.price),
      type: "uniform",
      uniformItemId: item.id,
      uniformItemName: item.name,
      category: item.category || "Additional Uniform Items",
      quantity: 1,
      unitPrice: num(item.price),
      optional: true
    });
  });
  return lines;
}

export function uniformSelector(sectionId, classId, { selection = {}, onSelectionChange } = {}) {
  selection = selection && typeof selection === "object" ? selection : {};
  const state = {
    package: selection.package || "",
    quantity: num(selection.quantity),
    itemIds: new Set(safeArray(selection.itemIds))
  };
  const wrap = el("div");
  const packageSel = select(() => UNIFORM_PACKAGE_OPTIONS.map((o) => ({ ...o, selected: state.package === o.value })));
  const customQty = input({ type: "number", min: 1, value: state.quantity || 1, style: "width:110px;display:none" });
  const packagePrice = el("span", { class: "amt" });
  const items = uniformItemsFor(sectionId, classId);
  const itemRows = [];

  function packageQuantity() {
    if (packageSel.value === "custom") return Math.max(1, num(customQty.value));
    return num(packageSel.value);
  }

  function emit() {
    state.package = packageSel.value;
    state.quantity = packageQuantity();
    state.itemIds = new Set(itemRows.filter((r) => r.cb.checked).map((r) => r.item.id));
    packagePrice.textContent = state.quantity > 0 ? naira(uniformSetPrice(sectionId) * state.quantity) : "";
    customQty.style.display = packageSel.value === "custom" ? "" : "none";
    onSelectionChange?.({
      package: state.package,
      quantity: state.quantity,
      itemIds: Array.from(state.itemIds)
    }, buildUniformLines(sectionId, classId, state));
  }

  packageSel.onchange = emit;
  customQty.oninput = emit;
  wrap.appendChild(el("div", { class: "svc-row" }, [
    el("span", { class: "nm", text: "Uniform Package" }),
    packageSel,
    customQty,
    packagePrice
  ]));

  if (items.length) {
    wrap.appendChild(el("div", { style: "font-weight:700;margin:12px 0 6px", text: "Additional Uniform Items" }));
    items.forEach((item) => {
      const cb = input({ type: "checkbox" });
      cb.checked = state.itemIds.has(item.id);
      cb.onchange = emit;
      itemRows.push({ item, cb });
      wrap.appendChild(el("label", { class: "svc-row" }, [
        cb,
        el("span", { class: "nm", text: item.name }),
        el("span", { class: "muted", text: item.category || "" }),
        el("span", { class: "amt", text: naira(item.price) })
      ]));
    });
  } else {
    wrap.appendChild(el("p", { class: "muted", text: "No additional uniform items configured for this section/class." }));
  }
  emit();
  return { wrap, getLines: () => buildUniformLines(sectionId, classId, state), getSelection: () => ({ ...state, itemIds: Array.from(state.itemIds) }) };
}

export function defaultUniformItems() {
  return DEFAULT_ITEMS.map((name) => ({ id: "uniform-" + slug(name), name, category: "Additional Uniform Items", price: 0, status: "active", sectionIds: [], classIds: [] }));
}

export function uniformManagementPanel({ onEdit, onDelete } = {}) {
  const items = uniformCatalog();
  return table([
    { label: "Item Name", key: "name" },
    { label: "Category", key: "category" },
    { label: "Price", align: "right", render: (i) => naira(i.price) },
    { label: "Status", render: (i) => i.status || "active" },
    { label: "Sections", render: (i) => safeArray(i.sectionIds).length ? safeArray(i.sectionIds).map(cfg.sectionName).join(", ") : "All" },
    { label: "Classes", render: (i) => safeArray(i.classIds).length ? safeArray(i.classIds).map(cfg.className).join(", ") : "All" },
    { label: "", render: (i) => el("div", { class: "row", style: "gap:4px" }, [
      btn("Edit", { sm: true, onclick: () => onEdit?.(i) }),
      btn("Del", { sm: true, variant: "danger", onclick: () => onDelete?.(i) })
    ]) }
  ], items, { empty: "No uniform items configured yet." });
}

export function makeUniformRecord(existing, values) {
  return {
    id: existing?.id || "uniform-" + slug(values.name || uuid()),
    name: values.name,
    category: values.category || "Additional Uniform Items",
    price: num(values.price),
    status: values.status || "active",
    sectionIds: safeArray(values.sectionIds),
    classIds: safeArray(values.classIds),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
}


