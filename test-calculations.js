import { 
  calculateStudentSubjectTotal, 
  calculateStudentAverage, 
  calculatePositions, 
  calculateInvoiceTotal, 
  calculateTotalPaid, 
  calculateOutstandingBalance, 
  calculateNetSalary 
} from "./js/core/calculations.js";

let testsPassed = 0;
let testsTotal = 0;

function assert(condition, message) {
  testsTotal++;
  if (condition) {
    console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
    testsPassed++;
  } else {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
  }
}

console.log("=== Running Calculation Tests ===");

// 1. Empty Score Test
assert(calculateStudentSubjectTotal("", "", 70) === 70, "Empty Score Test: CA='', Exam=70 => Total=70");

// 2. Decimal Test
assert(calculateStudentSubjectTotal(78.5, 0, 80) === 158.5, "Decimal Test: 78.5 + 80 => 158.5");

// 3. Student Result Test
const total = calculateStudentSubjectTotal(80, 0, 0) + 
              calculateStudentSubjectTotal(70, 0, 0) + 
              calculateStudentSubjectTotal(90, 0, 0);
assert(total === 240, "Student Result Test: Total 80+70+90 = 240");
assert(calculateStudentAverage(240, 3) === 80, "Student Result Test: Average 240/3 = 80");

// 4. Ranking Tie Test
const results = [
  { id: 1, total: 240 },
  { id: 2, total: 100 },
  { id: 3, total: 240 },
  { id: 4, total: 200 }
];
const ranked = calculatePositions(results);
assert(ranked[0].total === 240 && ranked[0].position === 1, "Ranking 1st");
assert(ranked[1].total === 240 && ranked[1].position === 1, "Ranking 1st (Tie)");
assert(ranked[2].total === 200 && ranked[2].position === 3, "Ranking 3rd");
assert(ranked[3].total === 100 && ranked[3].position === 4, "Ranking 4th");

// 5. Finance Test
const fee = 100000;
const payments = [{amount: 40000}, {amount: 30000}];
const paid = calculateTotalPaid(payments);
assert(paid === 70000, "Finance Test: Paid 40k + 30k = 70k");
assert(calculateOutstandingBalance(fee, paid) === 30000, "Finance Test: Balance 100k - 70k = 30k");

// 6. Overpayment Prevention Test
assert(calculateOutstandingBalance(100, 150) === 0, "Overpayment Prevention Test: 100 - 150 => 0");

// 7. Salary Zero Test
assert(calculateNetSalary(0, 0, 0, [], 0) === 0, "Salary Zero Test: Net Salary = 0");

console.log(`=== Tests Complete: ${testsPassed}/${testsTotal} Passed ===`);
