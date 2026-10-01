// Default school configuration seeded on first run. Everything here is editable
// from the Settings module afterwards (nothing is hardcoded into module logic).
import { db } from "./db.js";
import { DEFAULT_BRANDING } from "./branding.js";
import { DEFAULT_ROLE_ACCESS } from "./rbac.js";

const SECTIONS = [
  { id: "pre-basic", name: "Pre-Basic", order: 1, type: "western" },
  { id: "basic", name: "Basic", order: 2, type: "western" },
  { id: "secondary", name: "Secondary", order: 3, type: "western" },
  { id: "islamiyya", name: "Islamiyya", order: 4, type: "islamiyya" },
  { id: "tahfiz", name: "Tahfiz", order: 5, type: "tahfiz" }
];

const CLASSES = [
  ["pre-basic", ["Pre-basic 1A", "Pre-basic 1B", "Pre-basic 2A", "Pre-basic 2B", "Pre-basic 3"]],

  ["basic", ["Basic 1", "Basic 2", "Basic 3", "Basic 4", "Basic 5"]],
  ["secondary", ["JSS 1", "JSS 2", "JSS 3", "SSS 1", "SSS 2", "SSS 3"]],
  ["islamiyya", ["Abu Bakr As-Siddiq", "Umar ibn Al-Khattab", "Uthman ibn Affan", "Ali ibn Abi Talib","Talhah ibn Ubaydillah", "Az-Zubayr ibn Al-Awwam","Abdur-Rahman ibn Awf", "Sa'd ibn Abi Waqqas", "Sa'id ibn Zayd", "Abu Ubaydah ibn Al-Jarrah"]],
  ["tahfiz", ["Abu Bakr As-Siddiq", "Umar ibn Al-Khattab", "Uthman ibn Affan", "Ali ibn Abi Talib","Talhah ibn Ubaydillah", "Az-Zubayr ibn Al-Awwam","Abdur-Rahman ibn Awf", "Sa'd ibn Abi Waqqas", "Sa'id ibn Zayd", "Abu Ubaydah ibn Al-Jarrah"]]
];

function classId(sectionId, name) { return sectionId + ":" + (name || "").toLowerCase().replace(/\s+/g, "-"); }

const SUBJECTS = {
  "pre-basic": ["English Language", "Mathematics", "Quantitative Reasoning", "Verbal Reasoning",
    "Civic Education", "Basic Science", "Handwriting", "Rhymes", "Nursery Activities"],
  "basic": ["English", "Mathematics", "Basic Science", "Civic Education", "Social Studies",
    "CRS/IRS", "Computer Studies", "Agricultural Science", "Home Economics", "Hausa Language"],
  "secondary": ["English Language", "Mathematics", "Physics", "Chemistry", "Biology",
    "Agricultural Science", "Civic Education", "Economics", "Commerce", "Government",
    "Literature", "Geography", "Computer Science", "Islamic Studies", "Hausa"],
  "islamiyya": ["Al-Qur'an", "Tajweed", "Tauhid", "Fiqh", "Hadith", "Sirah",
    "Arabic Grammar", "Arabic Reading", "Arabic Writing", "Islamic Morals"],
  "tahfiz": ["Surahs Memorized", "New Memorization", "Revision Performance", "Tajweed",
    "Fluency", "Accuracy", "Discipline"]
};

const SERVICES = [
  { name: "Form Fee", optional: false, prices: { "pre-basic": 2000, basic: 2000, secondary: 2000, islamiyya: 1000, tahfiz: 1000 } },
  { name: "Registration Fee", optional: false, prices: { "pre-basic": 5000, basic: 5000, secondary: 7000 } },
  { name: "Miscellaneous Fee", optional: false, prices: { "pre-basic": 4000, basic: 5000, secondary: 5000 } },
  { name: "Sport Fee", optional: true, prices: { "pre-basic": 2000, basic: 2000, secondary: 3000 } },
  { name: "ID Card Fee", optional: false, prices: { "pre-basic": 1000, basic: 1000, secondary: 1000 } },
  { name: "Exam Fee", optional: false, prices: { "pre-basic": 5000, basic: 8000, secondary: 10000, islamiyya: 3000, tahfiz: 3000 } },
  { name: "Tuition Fee", optional: false, prices: { "pre-basic": 25000, basic: 35000, secondary: 60000, islamiyya: 15000, tahfiz: 20000 } }
];

const PROGRAM_FEES = {
  "pre-basic": 80000,
  basic: 90000,
  secondary: 120000,
  islamiyya: 25000,
  tahfiz: 35000
};

const UNIFORMS = {
  "pre-basic": { "One Set": 6000, "Two Sets": 12000, "Sport Wear": 4000 },
  "basic": { "One Set": 6000, "Two Sets": 12000, "Sport Wear": 4000 },
  "secondary": { "One Set": 8000, "Two Sets": 16000, "Sport Wear": 5000 },
  "islamiyya": { "One Set": 5000, "Two Sets": 10000, "Sport Wear": 0 },
  "tahfiz": { "One Set": 5000, "Two Sets": 10000, "Sport Wear": 0 }
};

const BOOKS = { "pre-basic": 5000, basic: 8000, secondary: 15000, islamiyya: 3000, tahfiz: 2000 };

const UNIFORM_ITEM_NAMES = [
  "Sports Wear", "Cardigan", "School Cap", "School Tie", "School Belt", "School Socks",
  "School Sweater", "House Wear", "Lab Coat", "Prefect Uniform", "Hijab",
  "Customized School Bag", "Customized Water Bottle", "Other Uniform Items"
];

const GRADING = [
  { grade: "A", min: 70, max: 100, remark: "Excellent" },
  { grade: "B", min: 60, max: 69, remark: "Very Good" },
  { grade: "C", min: 50, max: 59, remark: "Good" },
  { grade: "D", min: 45, max: 49, remark: "Fair" },
  { grade: "E", min: 40, max: 44, remark: "Poor" },
  { grade: "F", min: 0, max: 39, remark: "Very Poor" }
];

const MATH_TOPICS = [
  ["Counting", "prebasic"], ["Shapes", "prebasic"], ["Number Recognition", "prebasic"],
  ["Addition", "primary"], ["Subtraction", "primary"], ["Multiplication", "primary"], ["Division", "primary"],
  ["Algebra", "junior"], ["Fractions", "junior"], ["Geometry", "junior"], ["Statistics", "junior"],
  ["Trigonometry", "senior"], ["Coordinate Geometry", "senior"], ["Calculus", "senior"], ["Probability", "senior"], ["Sets", "senior"]
].map(([name, band]) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, band, status: "Active" }));

const MATH_FORMULAS = [
  { id: "area-rectangle", name: "Area of Rectangle", formula: "A = l × b", category: "Geometry" },
  { id: "area-triangle", name: "Area of Triangle", formula: "A = 1/2 × b × h", category: "Geometry" },
  { id: "volume-cube", name: "Volume of Cube", formula: "V = a³", category: "Mensuration" },
  { id: "pythagoras", name: "Pythagoras Theorem", formula: "a² + b² = c²", category: "Geometry" },
  { id: "quadratic", name: "Quadratic Formula", formula: "x = (-b ± √(b² - 4ac)) / 2a", category: "Algebra" }
];

export function seedDefaults() {
  if (!db.setting("branding")) db.saveSetting("branding", DEFAULT_BRANDING, { sync: false });

  // Migrate or Seed Sections
  let sectionSettings = db.setting("sections");
  if (!sectionSettings || (sectionSettings.list || []).length === 0) {
    db.saveSetting("sections", { list: SECTIONS }, { sync: false });
  }

  // Migrate or Seed Classes
  let classSettings = db.setting("classes");
  if (!classSettings) classSettings = { list: [] };
  if (!classSettings.list) classSettings.list = [];
  const existingSettingClasses = new Set(classSettings.list.map(c => c.id));
  let addedToSettings = false;
  
  CLASSES.forEach(([sectionId, names]) => {
    names.forEach(name => {
      const id = classId(sectionId, name);
      if (!existingSettingClasses.has(id)) {
        classSettings.list.push({ id, sectionId, name, type: "western", status: "Active" });
        addedToSettings = true;
      }
    });
  });
  
  if (addedToSettings) {
    db.saveSetting("classes", classSettings, { sync: false });
  }

  // Populate Classes Collection (for offline persistence)
  const existingClasses = new Set(db.list("classes").map(c => c.id));
  CLASSES.forEach(([sectionId, names]) => {
    names.forEach(name => {
      const id = classId(sectionId, name);
      if (!existingClasses.has(id)) {
        db.save("classes", { id, sectionId, name, type: "western", status: "Active" }, { sync: true });
      }
    });
  });

  let subjSettings = db.setting("subjects");
  if (!subjSettings || (subjSettings.list || []).length === 0) {
    const list = [];
    Object.keys(SUBJECTS).forEach(sectionId => {
      SUBJECTS[sectionId].forEach(name => {
        list.push({ id: sectionId + ":" + name.toLowerCase().replace(/\s+/g, "-"), sectionId, name, status: "Active" });
      });
    });
    db.saveSetting("subjects", { list }, { sync: false });
  }

  if (!db.setting("grading")) db.saveSetting("grading", { list: GRADING }, { sync: false });
  
  if (!db.setting("fees")) {
    db.saveSetting("fees", { 
      services: SERVICES, programFees: PROGRAM_FEES, 
      uniforms: UNIFORMS, books: BOOKS, uniformItems: UNIFORM_ITEM_NAMES 
    }, { sync: false });
  }

  if (!db.setting("sessions")) db.saveSetting("sessions", {
    current: "2025/2026", list: ["2024/2025", "2025/2026", "2026/2027"],
    currentTerm: "First Term", terms: ["First Term", "Second Term", "Third Term"],
    nextTermBegins: ""
  }, { sync: false });

  let promoPaths = db.setting("promotionPaths");
  if (!promoPaths) promoPaths = { map: {} };
  if (!promoPaths.map) promoPaths.map = {};
  let addedPromoPaths = false;
  CLASSES.forEach(([sectionId, names]) => {
    for (let i = 0; i < names.length - 1; i++) {
      const fromId = classId(sectionId, names[i]);
      const toId = classId(sectionId, names[i + 1]);
      if (promoPaths.map[fromId] === undefined) {
        promoPaths.map[fromId] = toId;
        addedPromoPaths = true;
      }
    }
  });
  if (addedPromoPaths) {
    db.saveSetting("promotionPaths", promoPaths, { sync: false });
  }

  if (!db.setting("roles")) db.saveSetting("roles", { access: DEFAULT_ROLE_ACCESS }, { sync: false });
  if (!db.setting("system")) db.saveSetting("system", { factoryName: "RESET CIC KANO" }, { sync: false });

  // expose role access overrides for rbac
  const roles = db.setting("roles");
  if (roles && roles.access) window.__CICKANORoleAccess = roles.access;

  deduplicateClasses();
}

function deduplicateClasses() {
  const all = db.list("classes");
  const byName = {};
  all.forEach(c => {
    const key = (c.sectionId || c.section_id) + "::" + (c.name || "").toLowerCase().trim();
    if (!byName[key]) byName[key] = [];
    byName[key].push(c);
  });

  Object.values(byName).forEach(group => {
    if (group.length <= 1) return;
    
    // Find the standard class (seeded one)
    const secId = group[0].sectionId || group[0].section_id;
    const stdId = classId(secId, group[0].name || "");
    const standard = group.find(c => c.id === stdId) || group[0];
    
    group.forEach(c => {
      if (c.id === standard.id) return;
      
      // Merge foreign keys (local-only: dedup runs at boot before auth)
      const updateClassId = (col) => {
        db.list(col).filter(x => x.classId === c.id || x.class_id === c.id).forEach(x => {
          if (x.classId) x.classId = standard.id;
          if (x.class_id) x.class_id = standard.id;
          db.save(col, x, { sync: false });
        });
      };
      
      updateClassId("students");
      updateClassId("results");
      updateClassId("attendance");
      updateClassId("invoices");
      updateClassId("resultApprovals");
      updateClassId("lessonPlans");
      updateClassId("assignments");
      updateClassId("cbtAttempts");
      updateClassId("staff");

      db.remove("classes", c.id, { sync: false });
    });
  });
}
