require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

const { GMAIL_USER, GMAIL_APP_PASSWORD, OWNER_EMAIL, SITE_URL, ADMIN_PASSWORD, DATABASE_URL, SQLITE_FILE } = process.env;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const allowedOrigins = (SITE_URL || "").split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
const adminEnabled = () => !!db && !!ADMIN_PASSWORD && ADMIN_PASSWORD.length >= 12;

/* ---------- Database (PostgreSQL in production, SQLite only for local testing) ---------- */
let db = null;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY, rid TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, service TEXT NOT NULL, issue TEXT, address TEXT NOT NULL, pincode TEXT, slot_date TEXT NOT NULL, slot_time TEXT NOT NULL, note TEXT, status TEXT NOT NULL, assigned_to TEXT, admin_note TEXT)`,
  `CREATE TABLE IF NOT EXISTS job_events(id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, at TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, actor TEXT NOT NULL, note TEXT)`,
  `CREATE TABLE IF NOT EXISTS partners(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, skill TEXT NOT NULL, exp TEXT, area TEXT, status TEXT NOT NULL)`
];
async function initDb() {
  if (DATABASE_URL) {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }, max: 5 });
    db = { q: async (sql, p = []) => { let i = 0; return (await pool.query(sql.replace(/\?/g, () => "$" + (++i)), p)).rows; } };
  } else if (SQLITE_FILE) {
    const { DatabaseSync } = require("node:sqlite");
    const s = new DatabaseSync(SQLITE_FILE);
    db = { q: async (sql, p = []) => { const st = s.prepare(sql); return /^\s*select/i.test(sql) ? st.all(...p) : (st.run(...p), []); } };
  }
  if (!db) { console.warn("No DATABASE_URL set: bookings are emailed only, and the admin dashboard and tracking are off."); return; }
  for (const ddl of SCHEMA) await db.q(ddl);
  try { await db.q("ALTER TABLE bookings ADD COLUMN map_link TEXT"); } catch (e) { /* column already exists */ }
}

/* ---------- Helpers ---------- */
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanNote = v => String(v == null ? "" : v).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").trim().slice(0, 1000);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sha = s => crypto.createHash("sha256").update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const now = () => new Date().toISOString();
const istDate = (off = 0) => new Date(Date.now() + off * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const waDigits = p => { let d = p.replace(/\D/g, ""); return d.length === 10 ? "91" + d : d; };
const SLOTS = ["Morning", "Afternoon", "Evening", "Any time"];
const ISSUES = ["Not working", "Unusual noise", "Leakage or physical damage", "Routine maintenance", "Other"];
const TRANSITIONS = {
  REQUESTED: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["ON_THE_WAY", "CONFIRMED", "CANCELLED"], ON_THE_WAY: ["COMPLETED", "ASSIGNED", "CANCELLED"], COMPLETED: [], CANCELLED: []
};
const BOOKING_ID = /^SV-\d{8}-[0-9A-F]{6}$/;
const mailer = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
const sameOrigin = req => { const o = req.get("origin"); if (!o) return true; try { const h = new URL(o).host; return h === req.get("host") || allowedOrigins.includes(o.replace(/\/$/, "")); } catch { return false; } };
const limiter = (max, ms = 15 * 60 * 1000, extra = {}) => rateLimit({ windowMs: ms, limit: max, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: "Too many requests. Please try again in a few minutes." }, ...extra });

/* ---------- App + security ---------- */
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {                                  // force HTTPS behind Render's proxy
  if (req.headers["x-forwarded-proto"] === "http") return res.redirect(301, "https://" + req.headers.host + req.originalUrl);
  next();
});
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"],
    mediaSrc: ["'self'"], frameSrc: ["https://www.google.com"], connectSrc: ["'self'"], fontSrc: ["'self'"], formAction: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
  } },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }
}));
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (req.path.startsWith("/api") || req.path.startsWith("/admin")) { res.setHeader("X-Robots-Tag", "noindex, nofollow"); res.setHeader("Cache-Control", "no-store"); }
  next();
});
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h", dotfiles: "ignore" }));
app.get("/healthz", (_q, res) => res.send("ok"));
app.get("/admin", (_q, res) => res.sendFile(path.join(__dirname, "views", "admin.html")));

/* ---------- Public: booking ---------- */
app.post("/api/booking", limiter(5), async (req, res) => {
  try {
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: "Not allowed." });
    const b = req.body || {};
    if (clean(b.website, 100) || !(Number(b.t) >= 3000)) return res.json({ ok: true, ref: "SV-OK" });   // bot traps
    const name = clean(b.name, 80), phone = clean(b.phone, 20), service = clean(b.service, 80), address = clean(b.address, 200);
    const date = clean(b.date, 10), slot = clean(b.slot, 20), note = cleanNote(b.note), issue = clean(b.issue, 40), pincode = clean(b.pincode, 6);
    const maplink = clean(b.maplink, 300);
    const mapOk = !maplink || /^https:\/\/(www\.google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps)(\/|\?|$)\S*$/i.test(maplink);
    const rid = /^[A-Za-z0-9-]{8,64}$/.test(String(b.rid || "")) ? String(b.rid) : null;
    const badDate = !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < istDate(0) || date > istDate(90);
    if (name.length < 2 || service.length < 2 || address.length < 5 || !/^\+?[\d\s-]{8,16}$/.test(phone) || badDate || !SLOTS.includes(slot) ||
        !ISSUES.includes(issue) || !mapOk || (pincode && !/^\d{6}$/.test(pincode)) || b.consent !== true) {
      return res.status(400).json({ ok: false, error: "Please check your details and accept the terms." });
    }
    if (db && rid) { const ex = await db.q("SELECT id FROM bookings WHERE rid = ?", [rid]); if (ex.length) return res.json({ ok: true, ref: ex[0].id }); }   // retry = same booking

    let ref = null, saved = false, mailed = false;
    if (db) {
      for (let i = 0; i < 3 && !saved; i++) {
        const id = "SV-" + istDate(0).replace(/-/g, "") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
        try {
          const t = now();
          await db.q("INSERT INTO bookings(id,rid,created_at,updated_at,name,phone,service,issue,address,pincode,slot_date,slot_time,note,status,map_link) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [id, rid, t, t, name, phone, service, issue, address, pincode || null, date, slot, note || null, "REQUESTED", maplink || null]);
          await db.q("INSERT INTO job_events(id,booking_id,at,from_status,to_status,actor,note) VALUES(?,?,?,?,?,?,?)", [crypto.randomUUID(), id, t, null, "REQUESTED", "customer", null]);
          ref = id; saved = true;
        } catch (e) { console.error("Booking save failed:", e.message); }
      }
    }
    if (!ref) ref = "SV-" + istDate(0).replace(/-/g, "") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    try {
      const d = waDigits(phone);
      await mailer.sendMail({
        from: `"Suvidha Website" <${GMAIL_USER}>`, to: OWNER_EMAIL, subject: `New booking ${ref}: ${service} - ${name}`,
        text: `New technician booking\n\nReference: ${ref}\nName: ${name}\nPhone: ${phone}\nService: ${service}\nProblem: ${issue}\nAddress: ${address}\nPincode: ${pincode || "-"}\nMap link: ${maplink || "-"}\nPreferred date: ${date}\nPreferred time: ${slot}\nDetails: ${note || "-"}\n\nWhatsApp the customer: https://wa.me/${d}\n`,
        html: `<h2>New technician booking</h2><p><b>Reference:</b> ${ref}<br><b>Name:</b> ${esc(name)}<br><b>Phone:</b> <a href="tel:+${d}">${esc(phone)}</a><br><b>Service:</b> ${esc(service)}<br><b>Problem:</b> ${esc(issue)}<br><b>Address:</b> ${esc(address)}<br><b>Pincode:</b> ${esc(pincode || "-")}<br>${maplink ? `<b>Map:</b> <a href="${esc(maplink)}">Open location</a><br>` : ""}<b>Preferred date:</b> ${date}<br><b>Preferred time:</b> ${slot}<br><b>Details:</b> ${esc(note || "-")}</p><p><a href="https://wa.me/${d}">WhatsApp the customer</a></p>`
      });
      mailed = true;
    } catch (e) { console.error("Booking email failed:", e.message); }
    if (!saved && !mailed) return res.status(500).json({ ok: false, error: "Could not send right now." });   // never show a false success
    res.json({ ok: true, ref });
  } catch (err) { console.error("Booking error:", err.message); res.status(500).json({ ok: false, error: "Could not send right now." }); }
});

/* ---------- Public: booking tracking (reference + last 4 phone digits) ---------- */
app.get("/api/track", limiter(15), async (req, res) => {
  if (!db) return res.status(503).json({ ok: false, error: "Tracking is not available yet." });
  try {
    const ref = clean(req.query.ref, 30).toUpperCase(), p = String(req.query.p || "").replace(/\D/g, "").slice(-4);
    const b = BOOKING_ID.test(ref) && p.length === 4 ? (await db.q("SELECT * FROM bookings WHERE id = ?", [ref]))[0] : null;
    if (!b || !safeEq(b.phone.replace(/\D/g, "").slice(-4), p)) return res.status(404).json({ ok: false, error: "No booking found for these details." });
    res.json({ ok: true, status: b.status, service: b.service, date: b.slot_date, slot: b.slot_time });
  } catch (e) { console.error("Track error:", e.message); res.status(500).json({ ok: false, error: "Could not check right now." }); }
});

/* ---------- Public: partner application ---------- */
app.post("/api/partner", limiter(3), async (req, res) => {
  try {
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: "Not allowed." });
    const b = req.body || {};
    if (clean(b.website, 100) || !(Number(b.t) >= 3000)) return res.json({ ok: true });
    const name = clean(b.name, 80), phone = clean(b.phone, 20), skill = clean(b.skill, 80), exp = clean(b.exp, 30), area = clean(b.area, 120);
    if (name.length < 2 || skill.length < 2 || !exp || !/^\+?[\d\s-]{8,16}$/.test(phone)) return res.status(400).json({ ok: false, error: "Please check your details." });
    let saved = false, mailed = false;
    if (db) { try { await db.q("INSERT INTO partners(id,created_at,name,phone,skill,exp,area,status) VALUES(?,?,?,?,?,?,?,?)", ["P-" + crypto.randomBytes(4).toString("hex"), now(), name, phone, skill, exp, area || null, "NEW"]); saved = true; } catch (e) { console.error("Partner save failed:", e.message); } }
    try {
      const d = waDigits(phone);
      await mailer.sendMail({ from: `"Suvidha Website" <${GMAIL_USER}>`, to: OWNER_EMAIL, subject: `New partner application: ${skill} - ${name}`,
        text: `New partner application\n\nName: ${name}\nPhone: ${phone}\nSkill: ${skill}\nExperience: ${exp}\nArea: ${area || "-"}\n\nWhatsApp: https://wa.me/${d}\n`,
        html: `<h2>New partner application</h2><p><b>Name:</b> ${esc(name)}<br><b>Phone:</b> <a href="tel:+${d}">${esc(phone)}</a><br><b>Skill:</b> ${esc(skill)}<br><b>Experience:</b> ${esc(exp)}<br><b>Area:</b> ${esc(area || "-")}</p><p><a href="https://wa.me/${d}">WhatsApp the applicant</a></p>` });
      mailed = true;
    } catch (e) { console.error("Partner email failed:", e.message); }
    if (!saved && !mailed) return res.status(500).json({ ok: false, error: "Could not send right now." });
    res.json({ ok: true });
  } catch (err) { console.error("Partner error:", err.message); res.status(500).json({ ok: false, error: "Could not send right now." }); }
});

/* ---------- Admin: signed, expiring, httpOnly session cookie ---------- */
const sign = d => crypto.createHmac("sha256", SESSION_SECRET).update(d).digest("base64url");
const makeToken = () => { const body = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 3600e3 })).toString("base64url"); return body + "." + sign(body); };
const validToken = t => { if (!t) return false; const [body, sig] = t.split("."); if (!body || !sig || !safeEq(sig, sign(body))) return false; try { return JSON.parse(Buffer.from(body, "base64url")).exp > Date.now(); } catch { return false; } };
const cookie = (req, n) => { const m = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(n + "=")); return m ? m.slice(n.length + 1) : null; };
const requireAdmin = (req, res, next) => {
  if (!adminEnabled()) return res.status(503).json({ ok: false, error: "Admin is not set up." });
  if (!validToken(cookie(req, "sv_admin"))) return res.status(401).json({ ok: false, error: "Please sign in." });
  if (req.method !== "GET" && (req.get("x-requested-with") !== "fetch" || !sameOrigin(req))) return res.status(403).json({ ok: false, error: "Not allowed." });   // CSRF guard
  next();
};
app.post("/api/admin/login", limiter(6, 15 * 60 * 1000, { skipSuccessfulRequests: true }), async (req, res) => {
  if (!adminEnabled()) return res.status(503).json({ ok: false, error: "Admin is not set up." });
  if (req.get("x-requested-with") !== "fetch" || !sameOrigin(req)) return res.status(403).json({ ok: false, error: "Not allowed." });
  const ok = safeEq(String((req.body || {}).password || ""), ADMIN_PASSWORD);
  if (!ok) { await new Promise(r => setTimeout(r, 600)); return res.status(401).json({ ok: false, error: "Wrong password." }); }
  res.setHeader("Set-Cookie", `sv_admin=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${req.secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => { res.setHeader("Set-Cookie", "sv_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); res.json({ ok: true }); });
app.get("/api/admin/me", requireAdmin, (_q, res) => res.json({ ok: true }));

app.get("/api/admin/bookings", requireAdmin, async (req, res) => {
  try {
    const status = clean(req.query.status, 20), q = clean(req.query.q, 40);
    const where = [], p = [];
    if (TRANSITIONS[status]) { where.push("status = ?"); p.push(status); }
    if (q) { where.push("(id LIKE ? OR name LIKE ? OR phone LIKE ?)"); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    res.json({ ok: true, rows: await db.q(`SELECT id,created_at,name,phone,service,status,slot_date,slot_time,assigned_to FROM bookings ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 200`, p) });
  } catch (e) { console.error(e.message); res.status(500).json({ ok: false, error: "Failed." }); }
});
app.get("/api/admin/bookings/:id", requireAdmin, async (req, res) => {
  try {
    if (!BOOKING_ID.test(req.params.id)) return res.status(400).json({ ok: false, error: "Bad id." });
    const b = (await db.q("SELECT * FROM bookings WHERE id = ?", [req.params.id]))[0];
    if (!b) return res.status(404).json({ ok: false, error: "Not found." });
    res.json({ ok: true, booking: b, events: await db.q("SELECT at,from_status,to_status,actor,note FROM job_events WHERE booking_id = ? ORDER BY at", [b.id]), next: TRANSITIONS[b.status] || [] });
  } catch (e) { console.error(e.message); res.status(500).json({ ok: false, error: "Failed." }); }
});
app.post("/api/admin/bookings/:id/status", requireAdmin, async (req, res) => {
  try {
    if (!BOOKING_ID.test(req.params.id)) return res.status(400).json({ ok: false, error: "Bad id." });
    const to = clean((req.body || {}).status, 20), note = clean((req.body || {}).note, 300), tech = clean((req.body || {}).assigned_to, 80);
    const b = (await db.q("SELECT status, assigned_to FROM bookings WHERE id = ?", [req.params.id]))[0];
    if (!b) return res.status(404).json({ ok: false, error: "Not found." });
    if (!(TRANSITIONS[b.status] || []).includes(to)) return res.status(409).json({ ok: false, error: `Cannot move from ${b.status} to ${to}.` });
    if (to === "ASSIGNED" && !tech) return res.status(400).json({ ok: false, error: "Enter the professional's name." });
    const t = now();
    await db.q("UPDATE bookings SET status = ?, updated_at = ?, assigned_to = ?, admin_note = COALESCE(?, admin_note) WHERE id = ?", [to, t, to === "ASSIGNED" ? tech : b.assigned_to, note || null, req.params.id]);
    await db.q("INSERT INTO job_events(id,booking_id,at,from_status,to_status,actor,note) VALUES(?,?,?,?,?,?,?)", [crypto.randomUUID(), req.params.id, t, b.status, to, "admin", note || null]);
    res.json({ ok: true });
  } catch (e) { console.error(e.message); res.status(500).json({ ok: false, error: "Failed." }); }
});
app.get("/api/admin/partners", requireAdmin, async (_q, res) => {
  try { res.json({ ok: true, rows: await db.q("SELECT id,created_at,name,phone,skill,exp,area,status FROM partners ORDER BY created_at DESC LIMIT 200") }); }
  catch (e) { console.error(e.message); res.status(500).json({ ok: false, error: "Failed." }); }
});
app.post("/api/admin/partners/:id/status", requireAdmin, async (req, res) => {
  try {
    const st = clean((req.body || {}).status, 20);
    if (!/^P-[0-9a-f]{8}$/.test(req.params.id) || !["NEW", "CONTACTED", "APPROVED", "REJECTED"].includes(st)) return res.status(400).json({ ok: false, error: "Bad request." });
    await db.q("UPDATE partners SET status = ? WHERE id = ?", [st, req.params.id]); res.json({ ok: true });
  } catch (e) { console.error(e.message); res.status(500).json({ ok: false, error: "Failed." }); }
});

app.use((err, _req, res, _next) => res.status(400).json({ ok: false, error: "Bad request." }));
app.use((_req, res) => res.status(404).send("Page not found"));
initDb().catch(e => console.error("Database setup failed:", e.message)).finally(() =>
  app.listen(process.env.PORT || 3000, () => console.log("Suvidha website is running")));
