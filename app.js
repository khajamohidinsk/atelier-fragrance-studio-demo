const data = [
  {id:1,name:"Moss & Mineral",brand:"Field Notes · No. 04",family:"Fresh",mood:"Fresh",art:"fresh",notes:["Bergamot","Green tea","Vetiver"],rating:"4.8",desc:"A bright, rain-washed composition: sparkling citrus over green tea, settling into damp earth and clean vetiver."},
  {id:2,name:"Amber Hour",brand:"Maison Solenne · No. 11",family:"Amber",mood:"Warm",art:"warm",notes:["Vanilla","Amber","Benzoin"],rating:"4.7",desc:"Soft amber light, a hint of resin, and a velvety vanilla finish. Warm without becoming heavy."},
  {id:3,name:"Petal Theory",brand:"Atelier Flora · No. 02",family:"Floral",mood:"Floral",art:"floral",notes:["Iris","Rose","White musk"],rating:"4.9",desc:"Airy petals and powder-soft iris meet a quiet musk base. Elegant, translucent, and close to the skin."},
  {id:4,name:"Cedar Archive",brand:"North & Grain · No. 07",family:"Woody",mood:"Woody",art:"woody",notes:["Cedarwood","Sandalwood","Musk"],rating:"4.6",desc:"Dry cedar shavings, creamy sandalwood, and a smooth skin-musk accord inspired by a quiet library."},
  {id:5,name:"Citrus Veil",brand:"Field Notes · No. 01",family:"Citrus",mood:"Fresh",art:"fresh",notes:["Bergamot","Neroli","Petitgrain"],rating:"4.5",desc:"A clean citrus opening with green neroli facets and a soft, sunlit woody dry-down."},
  {id:6,name:"Velvet Dusk",brand:"Maison Solenne · No. 15",family:"Woody Amber",mood:"Warm",art:"warm",notes:["Cardamom","Sandalwood","Vanilla"],rating:"4.8",desc:"Spiced cardamom drifts into creamy woods and a restrained vanilla warmth, made for late evenings."}
];

const $ = selector => document.querySelector(selector);
let mood = "", family = "", showAll = false, collectionOnly = false;
let saved = readStorage("atelier-saved", []).map(Number);
let journalEntries = readStorage("atelier-journal", [{day:"14 OCT", title:"Rain on warm stone", description:"Mineral air, wet cedar, and a soft amber trail.", meta:"ATMOSPHERIC · WOODY"}]);

function readStorage(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } }
function writeStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* demo still works without storage */ } }
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char])); }

function render() {
  const query = $("#search").value.trim().toLowerCase();
  let rows = data.filter(item => {
    const searchable = [item.name,item.brand,item.family,item.mood,...item.notes].join(" ").toLowerCase();
    return (!mood || item.mood === mood) && (!family || item.family === family) && (!collectionOnly || saved.includes(item.id)) && (!query || searchable.includes(query));
  });
  if (!showAll && !query && !mood && !family && !collectionOnly) rows = rows.slice(0, 3);
  $("#results-title").textContent = collectionOnly ? "Your collection" : query || mood || family ? `${rows.length} fragrance${rows.length === 1 ? "" : "s"} found` : "Explore fragrances";
  $("#viewall").textContent = collectionOnly ? "Back to discover ↗" : showAll ? "Show featured ↗" : "View all ↗";
  $("#cards").innerHTML = rows.length ? rows.map(cardTemplate).join("") : `<div class="panel empty"><strong>${collectionOnly ? "Your collection is waiting." : "No matching scents."}</strong><span>Try another search or clear your filters to explore the full edit.</span></div>`;
  $("#saved-count").textContent = saved.length || "";
  document.querySelectorAll("[data-mood]").forEach(button => button.classList.toggle("selected", button.dataset.mood === mood));
  $("#family").value = family;
}

function cardTemplate(item) {
  const isSaved = saved.includes(item.id);
  return `<article class="card" data-id="${item.id}" tabindex="0" aria-label="Open details for ${escapeHTML(item.name)}"><div class="art ${item.art}"><div class="mini">${escapeHTML(item.name.split(" ")[0].toUpperCase())}</div></div><div class="content"><div class="meta"><span>${escapeHTML(item.family.toUpperCase())}</span><button class="heart ${isSaved ? "saved" : ""}" data-save="${item.id}" aria-label="${isSaved ? "Remove" : "Save"} ${escapeHTML(item.name)}">${isSaved ? "♥" : "♡"}</button></div><h3>${escapeHTML(item.name)}</h3><div class="brand">${escapeHTML(item.brand)}</div>${item.notes.map(note => `<span class="tag">${escapeHTML(note)}</span>`).join("")}<div class="cardfoot"><span>${escapeHTML(item.mood)} · SAMPLE</span><span>✦ ${item.rating}</span></div></div></article>`;
}

function openDetail(id) {
  const item = data.find(entry => entry.id === Number(id));
  if (!item) return;
  $("#detail").innerHTML = `<div class="detailart art ${item.art}"><div class="mini">${escapeHTML(item.name.split(" ")[0].toUpperCase())}</div></div><p class="label">${escapeHTML(item.family.toUpperCase())} · FICTIONAL SAMPLE</p><h2 id="detail-title">${escapeHTML(item.name)}</h2><p class="brand">${escapeHTML(item.brand)}</p><p class="desc">${escapeHTML(item.desc)}</p><p class="label">NOTE PROFILE</p><div class="detailnotes">${item.notes.map(note => `<span>${escapeHTML(note)}</span>`).join("")}</div><p style="font:22px Georgia;margin-bottom:0">✦ ${item.rating} <small style="font:11px system-ui;color:#9ba297">sample score</small></p>`;
  $("#modal").showModal();
}

function renderJournal() {
  $("#journal").innerHTML = journalEntries.map(entry => `<div class="journal-entry"><b>${escapeHTML(entry.day)}</b><div><strong>${escapeHTML(entry.title)}</strong><p>${escapeHTML(entry.description)}</p><small>${escapeHTML(entry.meta)}</small></div></div>`).join("");
  $("#journal-count").textContent = `${journalEntries.length} entr${journalEntries.length === 1 ? "y" : "ies"}`;
}
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200); }
function clearFilters() { mood = ""; family = ""; showAll = false; $("#search").value = ""; $("#family").value = ""; render(); }

$("#cards").addEventListener("click", event => {
  const saveButton = event.target.closest("[data-save]");
  if (saveButton) { event.stopPropagation(); const id = Number(saveButton.dataset.save); saved = saved.includes(id) ? saved.filter(savedId => savedId !== id) : [...saved, id]; writeStorage("atelier-saved", saved); render(); showToast(saved.includes(id) ? "Saved to your collection" : "Removed from your collection"); return; }
  const card = event.target.closest("[data-id]"); if (card) openDetail(card.dataset.id);
});
$("#cards").addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && event.target.closest("[data-id]")) { event.preventDefault(); openDetail(event.target.closest("[data-id]").dataset.id); } });
$("#search").addEventListener("input", () => { collectionOnly = false; render(); });
$("#filters").addEventListener("click", () => { const open = $("#filterbar").classList.toggle("open"); $("#filters").setAttribute("aria-expanded", open); });
document.querySelectorAll("[data-mood]").forEach(button => button.addEventListener("click", () => { mood = mood === button.dataset.mood ? "" : button.dataset.mood; collectionOnly = false; render(); }));
$("#family").addEventListener("change", event => { family = event.target.value; collectionOnly = false; render(); });
$("#clear").addEventListener("click", clearFilters);
document.querySelectorAll("[data-note]").forEach(button => button.addEventListener("click", () => { clearFilters(); $("#search").value = button.dataset.note; render(); $("#cards").scrollIntoView({behavior:"smooth", block:"start"}); }));
$("#viewall").addEventListener("click", () => { if (collectionOnly) { collectionOnly = false; } else { showAll = !showAll; } render(); });

document.querySelectorAll(".nav").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll(".nav").forEach(nav => nav.classList.remove("active")); button.classList.add("active");
  const view = button.dataset.view; $("#breadcrumb").textContent = view[0].toUpperCase() + view.slice(1);
  if (view === "collection") { collectionOnly = true; showAll = true; mood = family = ""; $("#search").value = ""; $("#discover").scrollIntoView({behavior:"smooth"}); render(); }
  else if (view === "notes") { $("#note-panel").scrollIntoView({behavior:"smooth", block:"center"}); }
  else if (view === "journal") { $("#journal-panel").scrollIntoView({behavior:"smooth", block:"center"}); }
  else { collectionOnly = false; $("#discover").scrollIntoView({behavior:"smooth"}); render(); }
}));

$("#close").addEventListener("click", () => $("#modal").close()); $("#modal").addEventListener("click", event => { if (event.target === $("#modal")) $("#modal").close(); });
$("#add").addEventListener("click", () => { $("#journal-modal").showModal(); $("#entry-title").focus(); });
$("#journal-close").addEventListener("click", () => $("#journal-modal").close()); $("#journal-cancel").addEventListener("click", () => $("#journal-modal").close());
$("#journal-form").addEventListener("submit", event => { event.preventDefault(); const now = new Date(); journalEntries.unshift({day:`${now.getDate()} ${now.toLocaleString("en", {month:"short"}).toUpperCase()}`,title:$("#entry-title").value.trim(),description:$("#entry-description").value.trim() || "A new scent memory.",meta:"NEW ENTRY · PERSONAL"}); writeStorage("atelier-journal", journalEntries); renderJournal(); $("#journal-form").reset(); $("#journal-modal").close(); showToast("Journal entry added"); });

render(); renderJournal();
