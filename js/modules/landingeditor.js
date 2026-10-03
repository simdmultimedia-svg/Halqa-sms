import { db } from "../core/db.js";
import { el, toast } from "../core/utils.js";
import { card, pageHead, field, input, textarea, btn, readFileAsDataURL } from "../core/ui.js";
import { can } from "../core/rbac.js";

const DEFAULTS = {
  heroTitle: "Leading Islamic Education in Northern Nigeria",
  heroText: "Providing excellence in Qur'anic memorization, Islamic studies, and comprehensive education under the guidance of experienced scholars.",
  aboutTitle: "Discover the True Spirit of Islamic Education",
  aboutText: "At Halqatu Zaid bin Sabit Kano, we combine traditional Islamic scholarship with modern educational excellence. Our experienced teachers guide students through comprehensive programs that nurture both spiritual and academic growth.",
  vision: "To be the leading institution in Islamic education, producing graduates who are excellent in both religious and secular knowledge, ready to serve their communities.",
  mission: "To provide quality Islamic education that combines Qur'anic memorization, Arabic language studies, and modern curriculum in a nurturing environment.",
  programmesTitle: "Our Programmes",
  newsTitle: "News & Events",
  programmes: [
    { icon: "📖", title: "Tahfizul Qur'an", text: "Complete memorization of the Holy Qur'an with proper tajweed and understanding under qualified Huffaz." },
    { icon: "🕌", title: "Islamiyya Studies", text: "Comprehensive Islamic studies including Fiqh, Hadith, Tafsir, and Arabic language for all age groups." },
    { icon: "🎒", title: "Western Education", text: "Modern curriculum following national standards, preparing students for higher education and career success." }
  ],
  news: [
    { icon: "📚", title: "Qur'anic Memorization Competition", text: "Annual competition for students to showcase their memorization skills. Registration now open for all classes." },
    { icon: "🎓", title: "New Academic Session", text: "Admission is now open for the 2026/2027 academic session. Apply today to secure your place." },
    { icon: "🏆", title: "Graduation Ceremony", text: "Celebrating the achievements of our graduating students. Join us for this special occasion." }
  ]
};

function content(value) {
  const saved = value && typeof value === "object" ? value : {};
  const usableCards = (items, fallback) => Array.isArray(items) && items.some((item) => item?.title || item?.text)
    ? items
    : fallback;
  // Do not let an empty array from an earlier editor session erase the public
  // programme/news sections. It is common when a setting was first saved
  // before its card records were created.
  return {
    ...DEFAULTS,
    ...saved,
    programmes: usableCards(saved.programmes, DEFAULTS.programmes),
    news: usableCards(saved.news, DEFAULTS.news)
  };
}

function setText(id, value) { const node = document.getElementById(id); if (node && value) node.textContent = value; }

function drawCards(id, items) {
  const host = document.getElementById(id);
  if (!host || !Array.isArray(items) || !items.some((item) => item?.title || item?.text)) return;
  host.innerHTML = "";
  items.filter((item) => item?.title || item?.text).slice(0, 6).forEach((item) => {
    const cardNode = document.createElement("div");
    cardNode.className = "card fade-in";
    const visual = document.createElement("div");
    visual.className = "card-image";
    if (item.image) {
      visual.style.backgroundImage = `url("${item.image}")`;
      visual.style.backgroundSize = "cover";
      visual.style.backgroundPosition = "center";
      visual.textContent = "";
    } else visual.textContent = item.icon || "✦";
    const body = document.createElement("div");
    body.className = "card-content";
    const heading = document.createElement("h3"); heading.className = "card-title"; heading.textContent = item.title || "";
    const text = document.createElement("p"); text.className = "card-description"; text.textContent = item.text || "";
    body.append(heading, text); cardNode.append(visual, body); host.appendChild(cardNode);
  });
}

export function applyLandingContent(value) {
  const data = content(value);
  setText("landing-hero-title", data.heroTitle);
  setText("landing-hero-text", data.heroText);
  setText("landing-about-title", data.aboutTitle);
  setText("landing-about-text", data.aboutText);
  setText("landing-vision-text", data.vision);
  setText("landing-mission-text", data.mission);
  setText("landing-programmes-title", data.programmesTitle);
  setText("landing-news-title", data.newsTitle);
  const hero = document.getElementById("home");
  if (hero && data.heroImage) { hero.style.backgroundImage = `linear-gradient(rgba(9, 31, 72, .66), rgba(9, 31, 72, .74)), url("${data.heroImage}")`; hero.style.backgroundSize = "cover"; hero.style.backgroundPosition = "center"; }
  drawCards("landing-programmes-list", data.programmes);
  drawCards("landing-news-list", data.news);
}

function imageField(label, item, key) {
  const file = input({ type: "file", accept: "image/*" });
  const preview = el("div", { style: "height:74px;border:1px dashed var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#f8fafc" });
  const render = () => { preview.innerHTML = item[key] ? `<img src="${item[key]}" alt="Preview" style="width:100%;height:100%;object-fit:cover">` : "No image selected"; };
  render();
  file.onchange = async () => { if (file.files?.[0]) { item[key] = await readFileAsDataURL(file.files[0]); render(); } };
  return field(label, el("div", { style: "display:grid;gap:8px" }, [preview, file]));
}

function itemEditor(title, items) {
  const box = card(title);
  items.forEach((item, index) => {
    const name = input({ value: item.title || "", placeholder: "Title" });
    const icon = input({ value: item.icon || "", placeholder: "Icon, e.g. 📚" });
    const description = textarea({ value: item.text || "", placeholder: "Description" });
    name.oninput = () => { item.title = name.value.trim(); };
    icon.oninput = () => { item.icon = icon.value.trim(); };
    description.oninput = () => { item.text = description.value.trim(); };
    box.appendChild(el("div", { class: "form-grid", style: "padding:14px 0;border-top:1px solid var(--border)" }, [
      field(`${title.slice(0, -1)} ${index + 1} title`, name), field("Icon (shown without an image)", icon),
      field("Description", description, { full: true }), imageField("Image", item, "image")
    ]));
  });
  return box;
}

export function render(root, ctx) {
  if (!can(ctx.user.role, "manageSettings")) {
    root.appendChild(card("Access denied", [el("p", { class: "muted", text: "Only Admin and Super Admin can edit public landing-page content." })]));
    return;
  }
  const state = content(db.setting("landingPage"));
  root.appendChild(pageHead("Landing Page Editor", "Edit the public website. Changes are shared online after saving."));

  const heroTitle = input({ value: state.heroTitle });
  const heroText = textarea({ value: state.heroText, rows: 4 });
  const aboutTitle = input({ value: state.aboutTitle });
  const aboutText = textarea({ value: state.aboutText, rows: 4 });
  const vision = textarea({ value: state.vision, rows: 4 });
  const mission = textarea({ value: state.mission, rows: 4 });
  const programmesTitle = input({ value: state.programmesTitle });
  const newsTitle = input({ value: state.newsTitle });

  root.appendChild(card("Hero section", [
    el("div", { class: "form-grid" }, [field("Hero headline", heroTitle, { full: true }), field("Hero text", heroText, { full: true }), imageField("Hero background image", state, "heroImage")]),
    el("p", { class: "muted", text: "Use a wide landscape image for the best hero result. Large images may take longer to sync." })
  ]));
  root.appendChild(card("About, Vision & Mission", [el("div", { class: "form-grid" }, [field("About heading", aboutTitle, { full: true }), field("About text", aboutText, { full: true }), field("Our Vision", vision, { full: true }), field("Our Mission", mission, { full: true })]) ]));
  root.appendChild(card("Section titles", [el("div", { class: "form-grid" }, [field("Programmes title", programmesTitle), field("News & Events title", newsTitle)])]));
  root.appendChild(itemEditor("Programmes", state.programmes));
  root.appendChild(itemEditor("News & Events", state.news));
  root.appendChild(el("div", { class: "row", style: "margin:20px 0;gap:10px" }, [
    btn("Save Landing Page", { variant: "primary", onclick: () => {
      state.heroTitle = heroTitle.value.trim(); state.heroText = heroText.value.trim();
      state.aboutTitle = aboutTitle.value.trim(); state.aboutText = aboutText.value.trim();
      state.vision = vision.value.trim(); state.mission = mission.value.trim();
      state.programmesTitle = programmesTitle.value.trim(); state.newsTitle = newsTitle.value.trim();
      db.saveSetting("landingPage", state); applyLandingContent(state);
      toast("Landing page saved and synced online.", "success");
    }}),
    btn("Preview Public Page", { onclick: () => { applyLandingContent(state); window.open("/", "_blank", "noopener"); } })
  ]));
}
