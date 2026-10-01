import { num, uuid } from "./utils.js";
import * as cfg from "./config.js";

const letters = ["A", "B", "C", "D"];

export function isMathSubject(subject = "") {
  return /math|mathematics|quantitative/i.test(String(subject || ""));
}

export function mathTopics(sectionId = "", classId = "") {
  const saved = (cfg.mathSettings().topics || []).filter((t) => (t.status || "Active") === "Active");
  if (saved.length) return saved;
  const band = classBand(sectionId, classId);
  const byBand = {
    prebasic: ["Counting", "Shapes", "Number Recognition"],
    primary: ["Addition", "Subtraction", "Multiplication", "Division"],
    junior: ["Algebra", "Fractions", "Geometry", "Statistics"],
    senior: ["Trigonometry", "Coordinate Geometry", "Calculus", "Probability", "Sets"]
  };
  return (byBand[band] || byBand.primary).map((name) => ({ id: slug(name), name, band, status: "Active" }));
}

export function mathDifficulties() {
  const list = cfg.mathSettings().difficulties || [];
  return list.length ? list : ["Easy", "Medium", "Hard"];
}

export function mathFormulas() {
  const saved = cfg.mathSettings().formulas || [];
  return saved.length ? saved : [
    { id: "area-rectangle", name: "Area of Rectangle", formula: "A = l × b", category: "Geometry" },
    { id: "area-triangle", name: "Area of Triangle", formula: "A = 1/2 × b × h", category: "Geometry" },
    { id: "volume-cube", name: "Volume of Cube", formula: "V = a³", category: "Mensuration" },
    { id: "pythagoras", name: "Pythagoras Theorem", formula: "a² + b² = c²", category: "Geometry" },
    { id: "quadratic", name: "Quadratic Formula", formula: "x = (-b ± √(b² - 4ac)) / 2a", category: "Algebra" }
  ];
}

export function generateMathQuestions({ sectionId = "", classId = "", subject = "Mathematics", topic = "Addition", difficulty = "Easy", count = 10, type = "Objective" } = {}) {
  const out = [];
  const seen = new Set();
  const max = Math.max(1, Math.min(100, num(count) || 10));
  let guard = 0;
  while (out.length < max && guard < max * 80) {
    guard++;
    const q = makeQuestion({ sectionId, classId, subject, topic, difficulty, type });
    const key = strip(q.text).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: uuid(),
      sectionId,
      classId,
      subject,
      topic,
      type,
      difficulty,
      marks: type === "Objective" ? 1 : 5,
      isMathematics: true,
      text: q.text,
      options: q.options || [],
      answer: q.answer,
      answerText: q.answerText || String(q.correct ?? ""),
      solution: q.solution || "",
      createdAt: Date.now()
    });
  }
  return out;
}

function makeQuestion(ctx) {
  const topic = String(ctx.topic || "").toLowerCase();
  const diff = String(ctx.difficulty || "Easy").toLowerCase();
  const objective = ctx.type !== "Theory";
  const n = rangeFor(ctx.sectionId, ctx.classId, diff);
  const custom = customTemplateQuestion(ctx, objective, n);
  if (custom) return custom;
  if (topic.includes("count")) return objectiveQuestion(`How many objects are represented by ${dots(rand(1, n.maxSmall))}?`, rand(1, n.maxSmall), objective);
  if (topic.includes("shape")) {
    const shapes = [["triangle", 3], ["square", 4], ["rectangle", 4], ["pentagon", 5], ["hexagon", 6]];
    const [shape, sides] = pick(shapes);
    return objectiveQuestion(`How many sides has a ${shape}?`, sides, objective);
  }
  if (topic.includes("number recognition")) {
    const value = rand(1, n.maxSmall);
    return objectiveQuestion(`Write the number shown: <b>${value}</b>`, value, objective);
  }
  if (topic.includes("subtract")) {
    const a = rand(n.min, n.max), b = rand(n.min, Math.min(a, n.max));
    return objectiveQuestion(`${a} - ${b} = ?`, a - b, objective);
  }
  if (topic.includes("multip")) {
    const a = rand(2, n.mult), b = rand(2, n.mult);
    return objectiveQuestion(`${a} × ${b} = ?`, a * b, objective);
  }
  if (topic.includes("division")) {
    const b = rand(2, n.mult), ans = rand(2, n.mult), a = b * ans;
    return objectiveQuestion(`${a} ÷ ${b} = ?`, ans, objective);
  }
  if (topic.includes("fraction")) {
    const den = rand(3, 12), n1 = rand(1, den - 1), n2 = rand(1, den - 1);
    const total = n1 + n2;
    return objectiveQuestion(`${frac(n1, den)} + ${frac(n2, den)} = ?`, simplify(total, den), objective, true);
  }
  if (topic.includes("algebra")) {
    const x = rand(2, 12), a = rand(2, 6), b = rand(1, 15), c = a * x + b;
    return objectiveQuestion(`Solve: ${a}x + ${b} = ${c}`, x, objective, false, `x = ${x}`);
  }
  if (topic.includes("geometry")) {
    const l = rand(3, 20), w = rand(2, 15);
    return objectiveQuestion(`Find the area of a rectangle with length ${l} cm and breadth ${w} cm.`, l * w, objective, false, `${l * w} cm²`);
  }
  if (topic.includes("stat")) {
    const values = [rand(2, 20), rand(2, 20), rand(2, 20), rand(2, 20)];
    const mean = values.reduce((a, v) => a + v, 0) / values.length;
    return objectiveQuestion(`Find the mean of ${values.join(", ")}.`, mean, objective);
  }
  if (topic.includes("trigon")) {
    const pairs = [["sin 30°", "1/2"], ["cos 60°", "1/2"], ["tan 45°", "1"], ["sin 90°", "1"]];
    const [expr, ans] = pick(pairs);
    return objectiveQuestion(`${expr} = ?`, ans, objective);
  }
  if (topic.includes("coordinate")) {
    const x1 = rand(-5, 5), y1 = rand(-5, 5), x2 = rand(-5, 5), y2 = rand(-5, 5);
    return objectiveQuestion(`Find the gradient of the line through (${x1}, ${y1}) and (${x2}, ${y2}).`, simplify(y2 - y1, x2 - x1 || 1), objective, true);
  }
  if (topic.includes("calculus")) {
    const a = rand(2, 8), p = rand(2, 5);
    return objectiveQuestion(`Differentiate ${a}x${sup(p)} with respect to x.`, `${a * p}x${sup(p - 1)}`, objective);
  }
  if (topic.includes("probability")) {
    const red = rand(1, 8), blue = rand(1, 8);
    return objectiveQuestion(`A bag has ${red} red balls and ${blue} blue balls. What is P(red)?`, simplify(red, red + blue), objective, true);
  }
  if (topic.includes("set")) {
    const a = rand(8, 30), b = rand(8, 30), both = rand(1, Math.min(a, b));
    return objectiveQuestion(`If n(A) = ${a}, n(B) = ${b}, and n(A ∩ B) = ${both}, find n(A ∪ B).`, a + b - both, objective);
  }
  if (topic.includes("root")) {
    const r = rand(2, 15);
    return objectiveQuestion(`√${r * r} = ?`, r, objective);
  }
  if (topic.includes("power") || topic.includes("indices")) {
    const a = rand(2, 10);
    return objectiveQuestion(`${a}${sup(2)} + ${a}${sup(3)} = ?`, a ** 2 + a ** 3, objective);
  }
  const a = rand(n.min, n.max), b = rand(n.min, n.max);
  return objectiveQuestion(`${a} + ${b} = ?`, a + b, objective);
}

function customTemplateQuestion(ctx, objective, range) {
  const templates = cfg.mathSettings().templates || [];
  const rec = templates.find((t) => String(t.topic || "").toLowerCase() === String(ctx.topic || "").toLowerCase());
  if (!rec?.template || !rec?.answerRule) return null;
  const vars = {
    a: rand(range.min, range.max),
    b: rand(range.min, range.max),
    c: rand(range.min, range.max),
    x: rand(1, 12),
    y: rand(1, 12)
  };
  const text = String(rec.template).replace(/\{([abcxy])\}/g, (_, key) => vars[key]);
  const answer = safeRule(rec.answerRule, vars);
  if (answer == null) return null;
  return objectiveQuestion(text, answer, objective);
}

function safeRule(rule, vars) {
  let expr = String(rule || "").toLowerCase().replace(/\s+/g, "");
  expr = expr.replace(/[abcxy]/g, (m) => String(vars[m]));
  if (!/^[0-9+\-*/().]+$/.test(expr)) return null;
  try {
    const value = Function(`"use strict"; return (${expr});`)();
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  } catch {
    return null;
  }
}

function objectiveQuestion(text, correct, objective, asFraction = false, answerText = null) {
  const normalized = answerText || String(correct);
  if (!objective) return { text: `Solve: ${text}`, correct, answerText: normalized, solution: normalized };
  const options = distractors(correct, asFraction).map(String);
  const answer = options.indexOf(String(correct));
  const finalAnswer = answer >= 0 ? answer : 0;
  if (answer < 0) options[0] = String(correct);
  return { text, correct, options, answer: finalAnswer, answerText: letters[finalAnswer], solution: normalized };
}

function distractors(correct, asFraction = false) {
  const vals = new Set([String(correct)]);
  let guard = 0;
  while (vals.size < 4 && guard++ < 40) {
    if (asFraction) vals.add(String(correct).replace(/(\d+)/, (m) => String(Math.max(1, num(m) + rand(-2, 2)))));
    else if (typeof correct === "number") vals.add(String(correct + pick([-6, -4, -3, -2, 2, 3, 4, 6])));
    else vals.add(String(correct).replace(/\d+/, (m) => String(num(m) + pick([-2, -1, 1, 2]))));
  }
  return shuffle([...vals]).slice(0, 4);
}

function classBand(sectionId, classId) {
  const sec = cfg.section(sectionId);
  const cls = (cfg.className(classId) || "").toLowerCase();
  if (sectionId === "pre-basic" || /nursery|pre/.test(cls)) return "prebasic";
  if (sectionId === "basic" || /primary|basic/.test(cls)) return "primary";
  if (/jss|junior/.test(cls)) return "junior";
  if (/sss|senior/.test(cls) || sectionId === "secondary") return "senior";
  if (sec?.type === "western") return "primary";
  return "primary";
}

function rangeFor(sectionId, classId, diff) {
  const band = classBand(sectionId, classId);
  const base = band === "prebasic" ? 10 : band === "primary" ? 30 : band === "junior" ? 80 : 150;
  const mult = diff === "hard" ? 12 : diff === "medium" ? 9 : 6;
  return { min: 1, max: diff === "hard" ? base * 2 : diff === "medium" ? base : Math.max(10, Math.floor(base / 2)), maxSmall: base, mult };
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[rand(0, arr.length - 1)]; }
function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function strip(s) { return String(s || "").replace(/<[^>]*>/g, ""); }
function sup(n) { return `<sup>${n}</sup>`; }
function frac(a, b) { return `<span class="math-frac"><span>${a}</span><span>${b}</span></span>`; }
function simplify(a, b) {
  if (b === 0) return "undefined";
  const sign = b < 0 ? -1 : 1;
  a *= sign; b *= sign;
  const g = gcd(Math.abs(a), Math.abs(b));
  a /= g; b /= g;
  return b === 1 ? String(a) : `${a}/${b}`;
}
function gcd(a, b) { return b ? gcd(b, a % b) : a || 1; }
function dots(n) { return "●".repeat(Math.max(1, Math.min(20, n))); }
