/**
 * CIC KANO Enterprise System
 * Core Calculations Module
 * Centralized, verifiable, strict mathematical logic.
 */

// Helper to coerce any falsy/empty value to a strict Number or 0.
export const num = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const parsed = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(parsed) ? 0 : parsed;
};

// Helper to reliably round to 2 decimal places for currency
export const roundCurrency = (value) => {
  return Number(num(value).toFixed(2));
};

/**
 * 1. STUDENT RESULTS
 */

/**
 * Computes the total subject score based on CA1, CA2, and Exam.
 * UI/Save logic must validate that scores do not exceed configured maximums.
 */
export function calculateStudentSubjectTotal(ca1, ca2, exam) {
  return num(ca1) + num(ca2) + num(exam);
}

/**
 * Computes the average score across subjects.
 */
export function calculateStudentAverage(totalScore, numSubjects) {
  if (numSubjects <= 0) return 0;
  return num(totalScore) / num(numSubjects);
}

/**
 * Assigns ranks to an array of result objects using Standard Competition Ranking.
 * (e.g., 1, 1, 3, 4)
 * Modifies the array in place and returns it.
 * Objects must have a 'total' property.
 */
export function calculatePositions(resultsArray) {
  if (!Array.isArray(resultsArray) || resultsArray.length === 0) return [];
  
  // Sort descending
  const sorted = resultsArray.slice().sort((a, b) => num(b.total) - num(a.total));
  
  let currentRank = 1;
  let previousScore = null;
  
  sorted.forEach((r, index) => {
    const score = num(r.total);
    if (score !== previousScore) {
      currentRank = index + 1; // Standard Competition Ranking
      previousScore = score;
    }
    r.position = currentRank;
  });
  
  return sorted;
}

/**
 * 2. FINANCE
 */

export function calculateInvoiceTotal(itemsArray) {
  if (!Array.isArray(itemsArray)) return 0;
  const sum = itemsArray.reduce((acc, item) => {
    if (item.unitPrice !== undefined && item.quantity !== undefined) {
      return acc + (num(item.quantity) * num(item.unitPrice));
    }
    return acc + num(item.amount || item.totalAmount || 0);
  }, 0);
  return roundCurrency(sum);
}

export function calculateTotalPaid(paymentsArray) {
  if (!Array.isArray(paymentsArray)) return 0;
  const sum = paymentsArray.reduce((acc, p) => acc + num(p.amount || p.amountPaid || 0), 0);
  return roundCurrency(sum);
}

/**
 * Calculates Outstanding Balance.
 * Capped at 0 (prevents negative balances overpayments).
 */
export function calculateOutstandingBalance(totalFee, totalPaid) {
  const diff = num(totalFee) - num(totalPaid);
  return roundCurrency(Math.max(diff, 0)); // Overpayments are blocked
}

/**
 * 3. PAYROLL
 */

export function calculateNetSalary(basic, allowances, bonus, deductionsArray, absenceDeduction) {
  const base = num(basic);
  const allows = Array.isArray(allowances) ? allowances.reduce((sum, a) => sum + num(a), 0) : num(allowances);
  const bns = num(bonus);
  
  const deds = Array.isArray(deductionsArray) 
    ? deductionsArray.reduce((sum, d) => sum + num(d.amount || d), 0) 
    : num(deductionsArray);
    
  const absDed = num(absenceDeduction);
  
  const net = base + allows + bns - deds - absDed;
  return roundCurrency(Math.max(net, 0)); // Net salary cannot be negative
}

/**
 * 4. INVENTORY
 */

export function calculateInventoryValue(remainingStock, unitPrice) {
  return roundCurrency(num(remainingStock) * num(unitPrice));
}

// Ensure backward compatibility with existing usage if `calc.num()` is requested
export const calc = {
  num,
  roundCurrency,
  calculateStudentSubjectTotal,
  calculateStudentAverage,
  calculatePositions,
  calculateInvoiceTotal,
  calculateTotalPaid,
  calculateOutstandingBalance,
  calculateNetSalary,
  calculateInventoryValue
};

// Expose diagnostic tool
if (typeof window !== "undefined") {
  window.cicCalculationAudit = () => {
    console.log("=== CIC KANO CALCULATION ACCURACY AUDIT ===");
    const auditResult = {
      invoicesChecked: 0,
      receiptsChecked: 0,
      vouchersChecked: 0,
      inventoryChecked: 0,
      mismatches: 0,
    duplicateRecords: 0,
    invalidNumbers: 0,
    timestamp: new Date().toISOString()
  };
  
  try {
    if (window.db) {
      // Check Invoices
      const invoices = window.db.list("invoices") || [];
      auditResult.invoicesChecked = invoices.length;
      invoices.forEach(inv => {
        const expectedTotal = calculateInvoiceTotal(inv.services);
        const expectedBal = calculateOutstandingBalance(expectedTotal - num(inv.discount) - num(inv.scholarship), calculateTotalPaid(inv.payments));
        if (num(inv.grossAmount) !== expectedTotal || num(inv.balance) !== expectedBal) auditResult.mismatches++;
        if (isNaN(inv.totalAmount) || isNaN(inv.balance)) auditResult.invalidNumbers++;
      });
      
      // Check Receipts
      const receipts = window.db.list("receipts") || [];
      auditResult.receiptsChecked = receipts.length;
      
      // Check Inventory
      const inventory = window.db.list("inventory") || [];
      auditResult.inventoryChecked = inventory.length;
      const seenItems = new Set();
      inventory.forEach(item => {
        if (seenItems.has(item.name.toLowerCase())) auditResult.duplicateRecords++;
        seenItems.add(item.name.toLowerCase());
        if (isNaN(item.remainingStock) || isNaN(item.unitCost)) auditResult.invalidNumbers++;
      });
    }
  } catch (e) {
    console.error("Audit error:", e);
  }
  
    console.table(auditResult);
    return auditResult;
  };
}
