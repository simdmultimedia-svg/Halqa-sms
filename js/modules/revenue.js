import { db } from "../core/db.js";
import { el, naira, num, sumBy } from "../core/utils.js";
import { card, pageHead, statCard, select, table } from "../core/ui.js";
import * as cfg from "../core/config.js";
import { calculateInvoiceTotal } from "../core/calculations.js";

export function render(root, ctx) {
  root.appendChild(pageHead("Revenue Forecast", "View projected and actual revenue broken down by terms, sections, and classes."));
  
  const host = el("div");
  root.appendChild(host);

  const draw = () => {
    host.innerHTML = "";
    
    const invoices = db.list("invoices").filter(i => i.session === cfg.currentSession());
    const students = db.list("students").filter(s => s.status !== "graduated" && s.status !== "withdrawn");

    // Summaries
    const firstTermInvs = invoices.filter(i => i.term === "First Term");
    const secondTermInvs = invoices.filter(i => i.term === "Second Term");
    const thirdTermInvs = invoices.filter(i => i.term === "Third Term");

    const sumTerm = (invs) => sumBy(invs, i => i.totalAmount);
    const grossTerm = (invs) => sumBy(invs, i => num(i.grossAmount) || calculateInvoiceTotal(i.services));
    
    const firstExpected = sumTerm(firstTermInvs);
    const secondExpected = sumTerm(secondTermInvs);
    const thirdExpected = sumTerm(thirdTermInvs);
    const annualExpected = firstExpected + secondExpected + thirdExpected;
    const grossExpected = grossTerm(invoices);
    const scholarshipValue = sumBy(invoices, i => i.scholarship);
    const discountValue = sumBy(invoices, i => i.discount);
    
    const totalCollected = sumBy(invoices, i => i.amountPaid);
    const totalOutstanding = sumBy(invoices, i => i.balance);

    // Summary Cards
    const stats = el("div", { class: "grid grid-4", style: "margin-bottom:20px" }, [
      statCard("G", naira(grossExpected), "Gross Expected Revenue"),
      statCard("S", naira(scholarshipValue), "Scholarship Value"),
      statCard("D", naira(discountValue), "Discount Value"),
      statCard("💰", naira(annualExpected), "Expected Annual Revenue"),
      statCard("📈", naira(totalCollected), "Total Collected"),
      statCard("📉", naira(totalOutstanding), "Total Outstanding Balance"),
      statCard("📅", naira(firstExpected), "First Term Expected")
    ]);
    host.appendChild(stats);

    // Term Forecast Details
    const termTabs = el("div", { class: "row", style: "margin-bottom:14px; gap:10px" });
    const termSel = select(() => [
      { value: "Annual", label: "Annual (All Terms)" },
      { value: "First Term", label: "First Term" },
      { value: "Second Term", label: "Second Term" },
      { value: "Third Term", label: "Third Term" }
    ]);
    termTabs.appendChild(el("span", { text: "View Data For:", style: "font-weight:600" }));
    termTabs.appendChild(termSel);
    
    const termDataHost = el("div");
    host.appendChild(termTabs);
    host.appendChild(termDataHost);

    const renderTermData = () => {
      termDataHost.innerHTML = "";
      const term = termSel.value;
      const targetInvs = term === "Annual" ? invoices : invoices.filter(i => i.term === term);
      
      const expected = sumBy(targetInvs, i => i.totalAmount);
      const gross = grossTerm(targetInvs);
      const scholarships = sumBy(targetInvs, i => i.scholarship);
      const discounts = sumBy(targetInvs, i => i.discount);
      const collected = sumBy(targetInvs, i => i.amountPaid);
      const outstanding = sumBy(targetInvs, i => i.balance);

      const termStats = el("div", { class: "grid grid-4", style: "margin-bottom:20px" }, [
        statCard("G", naira(gross), `${term} Gross Expected`),
        statCard("S", naira(scholarships), `${term} Scholarships`),
        statCard("D", naira(discounts), `${term} Discounts`),
        statCard("🎯", naira(expected), `${term} Expected Income`),
        statCard("✅", naira(collected), `${term} Collected Income`),
        statCard("⏳", naira(outstanding), `${term} Outstanding Income`)
      ]);
      termDataHost.appendChild(termStats);

      // Breakdown by Section
      const secData = cfg.sections().map(sec => {
        const secInvs = targetInvs.filter(i => i.sectionId === sec.id);
        return {
          section: sec.name,
          expected: sumBy(secInvs, i => i.totalAmount),
          collected: sumBy(secInvs, i => i.amountPaid),
          outstanding: sumBy(secInvs, i => i.balance)
        };
      }).filter(d => d.expected > 0 || d.collected > 0);

      const secCard = card(`Section Revenue (${term})`);
      secCard.appendChild(table([
        { label: "Section", key: "section" },
        { label: "Expected Revenue", align: "right", render: d => naira(d.expected) },
        { label: "Collected", align: "right", render: d => naira(d.collected) },
        { label: "Outstanding", align: "right", render: d => naira(d.outstanding) }
      ], secData, { empty: "No revenue data for this period." }));
      
      // Breakdown by Class
      const clsData = [];
      cfg.sections().forEach(sec => {
        cfg.classes(sec.id).forEach(cls => {
          const clsInvs = targetInvs.filter(i => i.classId === cls.id);
          const expected = sumBy(clsInvs, i => i.totalAmount);
          const collected = sumBy(clsInvs, i => i.amountPaid);
          if (expected > 0 || collected > 0) {
            clsData.push({
              className: cls.name,
              sectionName: sec.name,
              expected,
              collected,
              outstanding: sumBy(clsInvs, i => i.balance)
            });
          }
        });
      });

      const clsCard = card(`Class Revenue Breakdown (${term})`);
      clsCard.appendChild(table([
        { label: "Class", key: "className" },
        { label: "Section", key: "sectionName" },
        { label: "Expected Revenue", align: "right", render: d => naira(d.expected) },
        { label: "Collected", align: "right", render: d => naira(d.collected) },
        { label: "Outstanding", align: "right", render: d => naira(d.outstanding) }
      ], clsData, { empty: "No revenue data for this period." }));

      // Revenue by Type breakdown (Tuition / Uniform Items / Books / Services)
      let totalTuition = 0, totalPrograms = 0, totalServices = 0, totalBooks = 0;
      const uniformRevenue = {};
      targetInvs.forEach(inv => {
        (inv.services || []).forEach(s => {
          const amt = num(s.amount);
          if (s.type === "program") totalPrograms += amt;
          else if ((s.name || "").toLowerCase().includes("tuition")) totalTuition += amt;
          else if (s.type === "book") totalBooks += amt;
          else if (s.type === "uniform") {
            const key = s.uniformItemName || ((s.name || "").startsWith("Uniform (") ? "Uniform Revenue" : s.name || "Other Uniform Revenue");
            uniformRevenue[key] = (uniformRevenue[key] || 0) + amt;
          } else totalServices += amt;
        });
      });

      const uniformData = Object.entries(uniformRevenue).map(([name, amount]) => ({
        type: name === "Uniform" || name === "Uniform Revenue" ? "Uniform Revenue" : `${name} Revenue`, amount
      }));
      const typeData = [
        { type: "Tuition Fees", amount: totalTuition },
        { type: "Program Fees", amount: totalPrograms },
        ...uniformData,
        { type: "Books Revenue", amount: totalBooks },
        { type: "Other Services", amount: totalServices }
      ].filter(d => d.amount > 0);

      const uniformTotal = Object.values(uniformRevenue).reduce((a, v) => a + num(v), 0);
      const typeCard = card(`Revenue by Type (${term})`);
      typeCard.appendChild(table([
        { label: "Revenue Type", key: "type" },
        { label: "Amount", align: "right", render: d => naira(d.amount) },
        { label: "% of Total", align: "right", render: d => {
          const total = totalTuition + totalPrograms + totalServices + totalBooks + uniformTotal;
          return total > 0 ? ((d.amount / total) * 100).toFixed(1) + "%" : "0%";
        }}
      ], typeData, { empty: "No revenue breakdown available." }));

      termDataHost.appendChild(el("div", { class: "grid grid-2" }, [secCard, clsCard]));
      if (typeData.length > 0) termDataHost.appendChild(typeCard);
    };

    termSel.onchange = renderTermData;
    renderTermData();
  };

  draw();
  const offs = ["invoices", "students", "payments"].map(c => db.on(c, draw));
  return () => offs.forEach(o => o());
}


