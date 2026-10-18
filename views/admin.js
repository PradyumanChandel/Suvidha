/* Admin dashboard. All customer data is written with textContent (never innerHTML) to prevent script injection. */
const $ = s => document.querySelector(s);
const h = (tag, props = {}, kids = []) => { const e = document.createElement(tag); Object.assign(e, props); [].concat(kids).forEach(k => e.append(k)); return e; };
async function api(url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  if (r.status === 401) { show(false); }
  return { ok: r.ok && j.ok, status: r.status, ...j };
}
function show(on) { $("#login").hidden = on; $("#app").hidden = !on; }
const pill = s => h("span", { className: "pill" + (s === "CANCELLED" ? " c" : s === "COMPLETED" ? " d" : ""), textContent: s.replace("_", " ") });
const fmt = t => t ? new Date(t).toLocaleString() : "";

$("#lf").addEventListener("submit", async e => {
  e.preventDefault(); const m = $("#lmsg"); m.textContent = "";
  const r = await api("/api/admin/login", { method: "POST", body: { password: $("#pw").value } });
  if (r.ok) { $("#pw").value = ""; show(true); loadBookings(); } else m.textContent = r.error || "Could not sign in.";
});
$("#out").addEventListener("click", async () => { await api("/api/admin/logout", { method: "POST" }); show(false); });
document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => {
  $("#tb").hidden = b.dataset.tab !== "tb"; $("#tp").hidden = b.dataset.tab !== "tp";
  if (b.dataset.tab === "tp") loadPartners(); else loadBookings();
}));
$("#fs").addEventListener("change", () => loadBookings());
let qt; $("#fq").addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(loadBookings, 300); });

async function loadBookings() {
  const r = await api("/api/admin/bookings?status=" + encodeURIComponent($("#fs").value) + "&q=" + encodeURIComponent($("#fq").value));
  const tb = $("#rows"); tb.replaceChildren();
  if (!r.ok) { tb.append(h("tr", {}, h("td", { colSpan: 5, textContent: r.error || "Could not load." }))); return; }
  if (!r.rows.length) tb.append(h("tr", {}, h("td", { colSpan: 5, textContent: "No bookings yet." })));
  r.rows.forEach(b => {
    const tr = h("tr", { className: "row", tabIndex: 0 }, [h("td", { textContent: b.id }), h("td", { textContent: b.name + " · " + b.phone }), h("td", { textContent: b.service }), h("td", { textContent: b.slot_date + " " + b.slot_time }), h("td", {}, pill(b.status))]);
    tr.addEventListener("click", () => openBooking(b.id)); tr.addEventListener("keydown", e => { if (e.key === "Enter") openBooking(b.id); });
    tb.append(tr);
  });
}
async function openBooking(id) {
  const r = await api("/api/admin/bookings/" + encodeURIComponent(id)), p = $("#detail"); p.replaceChildren();
  if (!r.ok) { p.append(h("p", { textContent: r.error || "Could not load." })); return; }
  const b = r.booking, dl = h("dl");
  [["Reference", b.id], ["Status", b.status], ["Name", b.name], ["Phone", b.phone], ["Service", b.service], ["Problem", b.issue], ["Address", b.address], ["Pincode", b.pincode], ["Preferred", b.slot_date + " (" + b.slot_time + ")"], ["Details", b.note], ["Map link", b.map_link], ["Professional", b.assigned_to], ["Admin note", b.admin_note]]
    .forEach(([k, v]) => { dl.append(h("dt", { textContent: k }), h("dd", { textContent: v || "-" })); });
  const tech = h("input", { placeholder: "Professional's name (needed to assign)", value: b.assigned_to || "" });
  const note = h("textarea", { rows: 2, placeholder: "Note (optional)" }), msg = h("p", { className: "msg" });
  const acts = h("div", { className: "acts" });
  r.next.forEach(s => {
    const btn = h("button", { className: "btn" + (s === "CANCELLED" ? " bad" : ""), type: "button", textContent: "Mark " + s.replace("_", " ").toLowerCase() });
    btn.addEventListener("click", async () => {
      if (s === "CANCELLED" && !confirm("Cancel this booking?")) return;
      const x = await api("/api/admin/bookings/" + encodeURIComponent(id) + "/status", { method: "POST", body: { status: s, note: note.value, assigned_to: tech.value } });
      if (x.ok) { openBooking(id); loadBookings(); } else msg.textContent = x.error || "Failed.";
    });
    acts.append(btn);
  });
  const wa = h("a", { className: "btn alt", textContent: "WhatsApp", target: "_blank", rel: "noopener", href: "https://wa.me/" + (b.phone.replace(/\D/g, "").length === 10 ? "91" : "") + b.phone.replace(/\D/g, "") });
  const hist = h("ul", {}, r.events.map(e => h("li", { textContent: fmt(e.at) + " · " + (e.from_status ? e.from_status + " → " : "") + e.to_status + " (" + e.actor + ")" + (e.note ? " · " + e.note : "") })));
  const maps = h("a", { className: "btn alt", textContent: "Open address in Google Maps", target: "_blank", rel: "noopener", href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(b.address + " Prayagraj") });
  const own = /^https:\/\//.test(b.map_link || "") ? h("a", { className: "btn alt", textContent: "Open customer's map link", target: "_blank", rel: "noopener", href: b.map_link }) : null;
  p.append(h("h2", { textContent: b.name }), dl, hist, ...(r.next.length ? [tech, note, acts] : []), msg, h("div", { className: "acts" }, [wa, maps, ...(own ? [own] : [])]));
}
async function loadPartners() {
  const r = await api("/api/admin/partners"), tb = $("#prow"); tb.replaceChildren();
  if (!r.ok) { tb.append(h("tr", {}, h("td", { colSpan: 6, textContent: r.error || "Could not load." }))); return; }
  if (!r.rows.length) tb.append(h("tr", {}, h("td", { colSpan: 6, textContent: "No applications yet." })));
  r.rows.forEach(p => {
    const sel = h("select", {}, ["NEW", "CONTACTED", "APPROVED", "REJECTED"].map(s => h("option", { textContent: s, selected: s === p.status })));
    sel.addEventListener("change", () => api("/api/admin/partners/" + encodeURIComponent(p.id) + "/status", { method: "POST", body: { status: sel.value } }));
    tb.append(h("tr", {}, [h("td", { textContent: p.name }), h("td", { textContent: p.phone }), h("td", { textContent: p.skill }), h("td", { textContent: p.exp || "" }), h("td", { textContent: p.area || "" }), h("td", {}, sel)]));
  });
}
api("/api/admin/me").then(r => { if (r.ok) { show(true); loadBookings(); } });
