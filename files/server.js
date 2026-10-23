require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const SERVICES = require("./services");

const { GMAIL_USER, GMAIL_APP_PASSWORD, OWNER_EMAIL, SITE_URL, ADMIN_PASSWORD, DATABASE_URL, SQLITE_FILE,
        GOOGLE_CLIENT_ID, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID } = process.env;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const allowedOrigins = (SITE_URL || "").split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
const BY_SLUG = new Map(SERVICES.list.map(s => [s.slug, s]));
const phoneProvider = () => !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SID);
const adminEnabled = () => !!db && !!ADMIN_PASSWORD && ADMIN_PASSWORD.length >= 12;

/* ===================== Database ===================== */
let db = null;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY, rid TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, service TEXT NOT NULL, issue TEXT, address TEXT NOT NULL, pincode TEXT, slot_date TEXT NOT NULL, slot_time TEXT NOT NULL, note TEXT, status TEXT NOT NULL, assigned_to TEXT, admin_note TEXT)`,
  `CREATE TABLE IF NOT EXISTS job_events(id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, at TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, actor TEXT NOT NULL, note TEXT)`,
  `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, google_sub TEXT UNIQUE NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, phone_verified INTEGER NOT NULL DEFAULT 0, lat DOUBLE PRECISION, lng DOUBLE PRECISION, loc_at TEXT, is_pro INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pros(user_id TEXT PRIMARY KEY, services TEXT NOT NULL, experience TEXT, area TEXT, bio TEXT, status TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 0, lat DOUBLE PRECISION, lng DOUBLE PRECISION, created_at TEXT NOT NULL)`
];
const MIGRATIONS = [
  "ALTER TABLE bookings ADD COLUMN map_link TEXT", "ALTER TABLE bookings ADD COLUMN user_id TEXT", "ALTER TABLE bookings ADD COLUMN pro_user_id TEXT",
  "ALTER TABLE bookings ADD COLUMN lat DOUBLE PRECISION", "ALTER TABLE bookings ADD COLUMN lng DOUBLE PRECISION", "ALTER TABLE bookings ADD COLUMN service_slug TEXT",
  "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)", "CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id)", "CREATE INDEX IF NOT EXISTS idx_bookings_pro ON bookings(pro_user_id)"
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
  if (!db) { console.warn("No DATABASE_URL set: sign-in, orders and the admin dashboard are off."); return; }
  for (const ddl of SCHEMA) await db.q(ddl);
  for (const m of MIGRATIONS) { try { await db.q(m); } catch (e) { /* already applied */ } }
}

/* ===================== Helpers ===================== */
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanNote = v => String(v == null ? "" : v).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").trim().slice(0, 600);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sha = s => crypto.createHash("sha256").update(String(s)).digest();
const shaHex = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const now = () => new Date().toISOString();
const plusDays = n => new Date(Date.now() + n * 864e5).toISOString();
const istDate = (off = 0) => new Date(Date.now() + off * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const normPhone = p => { let d = String(p || "").replace(/\D/g, ""); if (d.length === 12 && d.startsWith("91")) d = d.slice(2); if (d.length === 11 && d.startsWith("0")) d = d.slice(1); return /^[6-9]\d{9}$/.test(d) ? "+91" + d : null; };
const waDigits = p => String(p).replace(/\D/g, "");
const validLat = n => Number.isFinite(n) && n >= -90 && n <= 90, validLng = n => Number.isFinite(n) && n >= -180 && n <= 180;
const hav = (a, b, c, d) => { const r = x => x * Math.PI / 180, dl = r(c - a), dg = r(d - b); const x = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dg / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
const shortName = n => { const p = String(n).trim().split(/\s+/); return p.length > 1 ? p[0] + " " + p[p.length - 1][0] + "." : p[0]; };
const mapLinkOf = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
const SLOTS = ["Morning", "Afternoon", "Evening", "Any time"];
const ISSUES = ["Not working", "Unusual noise", "Leakage or physical damage", "Routine maintenance", "Other"];
const EXPERIENCE = ["Less than 1 year", "1 to 3 years", "3 to 5 years", "5+ years"];
const TRANSITIONS = {
  REQUESTED: ["CONFIRMED", "ASSIGNED", "CANCELLED"], CONFIRMED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["ON_THE_WAY", "CONFIRMED", "CANCELLED"], ON_THE_WAY: ["COMPLETED", "ASSIGNED", "CANCELLED"], COMPLETED: [], CANCELLED: []
};
const BOOKING_ID = /^SV-\d{8}-[0-9A-F]{6}$/;
const USER_ID = /^U-[0-9a-f]{10}$/;
const mailer = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
const notify = (subject, text) => mailer.sendMail({ from: `"Suvidha Website" <${GMAIL_USER}>`, to: OWNER_EMAIL, subject, text }).catch(e => console.error("Email failed:", e.message));
const sameOrigin = req => { const o = req.get("origin"); if (!o) return true; try { return new URL(o).host === req.get("host") || allowedOrigins.includes(o.replace(/\/$/, "")); } catch { return false; } };
const limiter = (max, ms = 15 * 60 * 1000, extra = {}) => rateLimit({ windowMs: ms, limit: max, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: "Too many requests. Please try again in a few minutes." }, ...extra });
const hits = new Map();
const hit = (key, max, ms) => { const t = Date.now(), a = (hits.get(key) || []).filter(x => t - x < ms); if (a.length >= max) { hits.set(key, a); return false; } a.push(t); hits.set(key, a); return true; };
setInterval(() => hits.clear(), 3600e3).unref();
const cookie = (req, n) => { const m = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(n + "=")); return m ? m.slice(n.length + 1) : null; };

/* ===================== Google sign-in (ID token verified here, on the server) ===================== */
let certCache = { keys: null, exp: 0 };
async function googleKeys() {
  if (certCache.keys && Date.now() < certCache.exp) return certCache.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const j = await r.json(); const cc = /max-age=(\d+)/.exec((r.headers && r.headers.get && r.headers.get("cache-control")) || "");
  certCache = { keys: j.keys, exp: Date.now() + (cc ? +cc[1] : 3600) * 1000 };
  return j.keys;
}
async function verifyGoogle(idToken) {
  const parts = String(idToken || "").split("."); if (parts.length !== 3) throw new Error("bad token");
  const [h, p, s] = parts, head = JSON.parse(Buffer.from(h, "base64url")); if (head.alg !== "RS256") throw new Error("bad alg");
  const jwk = (await googleKeys()).find(k => k.kid === head.kid); if (!jwk) throw new Error("unknown key");
  if (!crypto.verify("RSA-SHA256", Buffer.from(h + "." + p), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"))) throw new Error("bad signature");
  const c = JSON.parse(Buffer.from(p, "base64url"));
  if (!["https://accounts.google.com", "accounts.google.com"].includes(c.iss) || c.aud !== GOOGLE_CLIENT_ID || !(c.exp * 1000 > Date.now()) || c.email_verified !== true || !c.sub || !c.email) throw new Error("invalid claims");
  return c;
}

/* ===================== Phone OTP (Twilio Verify, India only) ===================== */
async function twilio(pathPart, params) {
  const r = await fetch(`https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/${pathPart}`, {
    method: "POST", headers: { Authorization: "Basic " + Buffer.from(TWILIO_ACCOUNT_SID + ":" + TWILIO_AUTH_TOKEN).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params)
  });
  return { ok: r.ok, json: await r.json().catch(() => ({})) };
}

/* ===================== Sessions ===================== */
async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.q("DELETE FROM sessions WHERE expires_at < ?", [now()]);
  await db.q("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)", [shaHex(token), userId, now(), plusDays(14)]);
  res.setHeader("Set-Cookie", `sv_sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600${req.secure ? "; Secure" : ""}`);
}
async function userFromSession(req) {
  const t = cookie(req, "sv_sid"); if (!t) return null;
  return (await db.q("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?", [shaHex(t), now()]))[0] || null;
}
const stageOf = u => ({ google: true, phone: phoneProvider() ? Number(u.phone_verified) === 1 : !!u.phone, location: u.lat != null && u.lng != null });
const complete = st => st.google && st.phone && st.location;
async function publicUser(u) {
  const pro = (await db.q("SELECT status, available FROM pros WHERE user_id = ?", [u.id]))[0];
  return { id: u.id, name: u.name, email: u.email, phone: u.phone || null, phoneVerified: Number(u.phone_verified) === 1, lat: u.lat, lng: u.lng, stage: stageOf(u), pro: pro ? { status: pro.status, available: Number(pro.available) === 1 } : null };
}
const auth = (need = "full") => async (req, res, next) => {
  try {
    if (!db) return res.status(503).json({ ok: false, error: "The service is starting. Please try again shortly." });
    const u = await userFromSession(req); if (!u) return res.status(401).json({ ok: false, error: "Please sign in." });
    if (req.method !== "GET" && (req.get("x-requested-with") !== "fetch" || !sameOrigin(req))) return res.status(403).json({ ok: false, error: "Not allowed." });
    req.user = u; req.stage = stageOf(u);
    if (need === "full" && !complete(req.stage)) return res.status(403).json({ ok: false, error: "Please finish verification first.", stage: req.stage });
    next();
  } catch (e) { console.error("Auth error:", e.message); res.status(500).json({ ok: false, error: "Something went wrong." }); }
};
const fail = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

/* ===================== App + security headers ===================== */
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => { if (req.headers["x-forwarded-proto"] === "http") return res.redirect(301, "https://" + req.headers.host + req.originalUrl); next(); });
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "https://accounts.google.com/gsi/client"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com/gsi/style"], imgSrc: ["'self'", "data:"], mediaSrc: ["'self'"],
    frameSrc: ["https://www.google.com", "https://accounts.google.com/gsi/"], connectSrc: ["'self'", "https://accounts.google.com/gsi/"],
    fontSrc: ["'self'"], formAction: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
  } },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },      // needed by Google sign-in popups
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }
}));
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=()");
  if (req.path.startsWith("/api") || req.path.startsWith("/admin") || req.path.startsWith("/app")) { res.setHeader("X-Robots-Tag", "noindex, nofollow"); }
  if (req.path.startsWith("/api") || req.path.startsWith("/admin")) res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h", dotfiles: "ignore" }));
app.get("/healthz", (_q, res) => res.send("ok"));
app.get("/admin", (_q, res) => res.sendFile(path.join(__dirname, "views", "admin.html")));
app.get("/app", (_q, res) => res.sendFile(path.join(__dirname, "public", "app.html")));

/* ===================== Public config + catalog ===================== */
app.get("/api/config", (_q, res) => res.json({ ok: true, googleClientId: GOOGLE_CLIENT_ID || "", phoneVerification: phoneProvider(), ready: !!db }));
app.get("/api/services", (_q, res) => res.json({ ok: true, groups: SERVICES.GROUPS, services: SERVICES.list }));

/* ===================== Sign-in: Google -> phone -> location ===================== */
app.post("/api/auth/google", limiter(20), async (req, res) => {
  try {
    if (!db) return fail(res, 503, "The service is starting. Please try again shortly.");
    if (!GOOGLE_CLIENT_ID) return fail(res, 503, "Google sign-in is not set up yet.");
    if (req.get("x-requested-with") !== "fetch" || !sameOrigin(req)) return fail(res, 403, "Not allowed.");
    let c; try { c = await verifyGoogle((req.body || {}).credential); } catch (e) { console.error("Google verify failed:", e.message); return fail(res, 401, "Google sign-in could not be verified."); }
    const t = now(), nm = clean(c.name || c.email.split("@")[0], 80);
    let u = (await db.q("SELECT * FROM users WHERE google_sub = ?", [c.sub]))[0];
    if (!u) { await db.q("INSERT INTO users(id,google_sub,email,name,phone_verified,is_pro,created_at,last_login) VALUES(?,?,?,?,?,?,?,?)", ["U-" + crypto.randomBytes(5).toString("hex"), c.sub, c.email, nm, 0, 0, t, t]); }
    else await db.q("UPDATE users SET email = ?, name = ?, last_login = ? WHERE id = ?", [c.email, nm, t, u.id]);
    u = (await db.q("SELECT * FROM users WHERE google_sub = ?", [c.sub]))[0];
    await startSession(req, res, u.id);
    res.json({ ok: true, user: await publicUser(u) });
  } catch (e) { console.error("Google login error:", e.message); fail(res, 500, "Something went wrong."); }
});
app.post("/api/auth/logout", async (req, res) => {
  try { const t = cookie(req, "sv_sid"); if (t && db) await db.q("DELETE FROM sessions WHERE id = ?", [shaHex(t)]); } catch {}
  res.setHeader("Set-Cookie", "sv_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"); res.json({ ok: true });
});
app.get("/api/me", auth("google"), async (req, res) => res.json({ ok: true, user: await publicUser(req.user) }));
app.post("/api/auth/phone/start", auth("google"), async (req, res) => {
  try {
    const phone = normPhone((req.body || {}).phone); if (!phone) return fail(res, 400, "Enter a valid 10-digit Indian mobile number.");
    if (!hit("otp-phone:" + phone, 3, 3600e3) || !hit("otp-user:" + req.user.id, 5, 3600e3)) return fail(res, 429, "Too many attempts. Please try again later.");
    await db.q("UPDATE users SET phone = ?, phone_verified = 0 WHERE id = ?", [phone, req.user.id]);
    if (!phoneProvider()) return res.json({ ok: true, mode: "saved" });                       // no SMS service set up: number saved, not verified
    const r = await twilio("Verifications", { To: phone, Channel: "sms" });
    if (!r.ok) { console.error("OTP send failed:", r.json.code || r.json.message); return fail(res, 502, "Could not send the code. Please try again."); }
    res.json({ ok: true, mode: "otp" });
  } catch (e) { console.error(e.message); fail(res, 500, "Something went wrong."); }
});
app.post("/api/auth/phone/verify", auth("google"), async (req, res) => {
  try {
    if (!phoneProvider()) return fail(res, 503, "Phone verification is not set up.");
    const code = clean((req.body || {}).code, 8); if (!/^\d{4,8}$/.test(code) || !req.user.phone) return fail(res, 400, "Enter the code you received.");
    if (!hit("otp-try:" + req.user.id, 5, 10 * 60e3)) return fail(res, 429, "Too many wrong codes. Please wait 10 minutes.");
    const r = await twilio("VerificationCheck", { To: req.user.phone, Code: code });
    if (!r.ok || r.json.status !== "approved") return fail(res, 400, "That code is not correct.");
    await db.q("UPDATE users SET phone_verified = 1 WHERE id = ?", [req.user.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e.message); fail(res, 500, "Something went wrong."); }
});
app.post("/api/me/location", auth("google"), async (req, res) => {
  try {
    const lat = Number((req.body || {}).lat), lng = Number((req.body || {}).lng);
    if (!validLat(lat) || !validLng(lng)) return fail(res, 400, "Invalid location.");
    const la = Math.round(lat * 1e5) / 1e5, ln = Math.round(lng * 1e5) / 1e5;
    await db.q("UPDATE users SET lat = ?, lng = ?, loc_at = ? WHERE id = ?", [la, ln, now(), req.user.id]);
    await db.q("UPDATE pros SET lat = ?, lng = ? WHERE user_id = ?", [la, ln, req.user.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e.message); fail(res, 500, "Something went wrong."); }
});

/* ===================== Customers: nearby professionals + orders ===================== */
app.get("/api/pros/nearby", auth("full"), limiter(60), async (req, res) => {
  try {
    const slug = clean(req.query.service, 60); if (!BY_SLUG.has(slug)) return fail(res, 400, "Unknown service.");
    const rows = await db.q("SELECT p.user_id, p.services, p.experience, p.area, p.lat, p.lng, u.name FROM pros p JOIN users u ON u.id = p.user_id WHERE p.status = 'APPROVED' AND p.available = 1 AND p.lat IS NOT NULL AND p.user_id <> ?", [req.user.id]);
    const out = rows.filter(r => r.services.split(",").includes(slug)).map(r => ({ id: r.user_id, name: shortName(r.name), experience: r.experience, area: r.area, km: Math.round(hav(req.user.lat, req.user.lng, r.lat, r.lng) * 10) / 10 }))
      .filter(r => r.km <= 50).sort((a, b) => a.km - b.km).slice(0, 20);
    res.json({ ok: true, pros: out });
  } catch (e) { console.error(e.message); fail(res, 500, "Something went wrong."); }
});
app.post("/api/orders", auth("full"), limiter(8), async (req, res) => {
  try {
    const b = req.body || {}, svc = BY_SLUG.get(clean(b.service, 60)); if (!svc) return fail(res, 400, "Unknown service.");
    const issue = clean(b.issue, 40), address = clean(b.address, 200), date = clean(b.date, 10), slot = clean(b.slot, 20), note = cleanNote(b.note);
    const rid = /^[A-Za-z0-9-]{8,64}$/.test(String(b.rid || "")) ? String(b.rid) : null;
    const badDate = !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < istDate(0) || date > istDate(90);
    if (!ISSUES.includes(issue) || address.length < 5 || badDate || !SLOTS.includes(slot) || b.consent !== true) return fail(res, 400, "Please check your details and accept the terms.");
    if (rid) { const ex = await db.q("SELECT id FROM bookings WHERE rid = ?", [rid]); if (ex.length) return res.json({ ok: true, ref: ex[0].id }); }
    let proId = null, proName = null;
    if (b.proId) {
      if (!USER_ID.test(String(b.proId)) || b.proId === req.user.id) return fail(res, 400, "That professional is not available.");
      const p = (await db.q("SELECT p.services, u.name FROM pros p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? AND p.status = 'APPROVED' AND p.available = 1", [b.proId]))[0];
      if (!p || !p.services.split(",").includes(svc.slug)) return fail(res, 400, "That professional is not available right now.");
      proId = b.proId; proName = p.name;
    }
    const u = req.user; let ref = null;
    for (let i = 0; i < 3 && !ref; i++) {
      const id = "SV-" + istDate(0).replace(/-/g, "") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase(), t = now();
      try {
        await db.q("INSERT INTO bookings(id,rid,created_at,updated_at,name,phone,service,issue,address,slot_date,slot_time,note,status,map_link,user_id,pro_user_id,lat,lng,service_slug) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [id, rid, t, t, u.name, u.phone, svc.name, issue, address, date, slot, note || null, "REQUESTED", mapLinkOf(u.lat, u.lng), u.id, proId, u.lat, u.lng, svc.slug]);
        await db.q("INSERT INTO job_events(id,booking_id,at,from_status,to_status,actor,note) VALUES(?,?,?,?,?,?,?)", [crypto.randomUUID(), id, t, null, "REQUESTED", "customer", proName ? "Requested " + proName : null]);
        ref = id;
      } catch (e) { console.error("Order save failed:", e.message); }
    }
    if (!ref) return fail(res, 500, "Could not place the order. Please try again.");
    notify(`New order ${ref}: ${svc.name} - ${u.name}`, `New order\n\nReference: ${ref}\nCustomer: ${u.name} (${u.phone})\nService: ${svc.name}\nProblem: ${issue}\nAddress: ${address}\nWhen: ${date} (${slot})\nProfessional requested: ${proName || "none (please assign)"}\nMap: ${mapLinkOf(u.lat, u.lng)}\nNote: ${note || "-"}\n\nWhatsApp: https://wa.me/${waDigits(u.phone)}`);
    res.json({ ok: true, ref });
  } catch (e) { console.error("Order error:", e.message); fail(res, 500, "Something went wrong."); }
});
app.get("/api/orders", auth("full"), async (req, res) => {
  try {
    const rows = await db.q("SELECT b.id, b.created_at, b.service, b.status, b.slot_date, b.slot_time, b.address, b.pro_user_id, pu.name AS pro_name, pu.phone AS pro_phone FROM bookings b LEFT JOIN users pu ON pu.id = b.pro_user_id WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT 50", [req.user.id]);
    res.json({ ok: true, orders: rows.map(r => ({ id: r.id, created_at: r.created_at, service: r.service, status: r.status, date: r.slot_date, slot: r.slot_time, address: r.address,
      pro: r.pro_user_id && ["ASSIGNED", "ON_THE_WAY", "COMPLETED"].includes(r.status) ? { name: r.pro_name, phone: r.pro_phone } : null, requestedPro: !!r.pro_user_id && r.status === "REQUESTED" })) });
  } catch (e) { console.error(e.message); fail(res, 500, "Something went wrong."); }
});
app.post("/api/orders/:id/cancel", auth("full"), async (req, res) => {
  try {
    if (!BOOKING_ID.test(req.params.id)) return fail(res, 400, "Bad id.");
    const b = (await db.q("SELECT status FROM bookings WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]))[0];
    if (!b) return fail(res, 404, "Not found.");
    if (!(TRANSITIONS[b.status] || []).includes("CANCELLED")) return fail(res, 409, "This order can no longer be cancelled.");
    const t = now();
    await db.q("UPDATE bookings SET status = 'CANCELLED', updated_at = ? WHERE id = ?", [t, req.params.id]);
    await db.q("INSERT INTO job_events(id,booking_id,at,from_status,to_status,actor,note) VALUES(?,?,?,?,?,?,?)", [crypto.randomUUID(), req.params.id, t, b.status, "CANCELLED", "customer", null]);
    res.json({ ok: true });
  } catch (e) { console.error(e.message); fail(res, 500, "Something went wrong."); }
});

/* ===================== Professionals ===================== */
app.post("/api/pro/register", auth("full"), limiter(10), async (req, res) => {
  try {
    const b = req.body || {}, services = [...new Set((Array.isArray(b.services) ? b.services : []).map(s => clean(s, 60)))].filter(s => BY_SLUG.has(s)).slice(0, 8);
    const experience = clean(b.experience, 30), area = clean(b.area, 120), bio = cleanNote(b.bio).slice(0, 300);
    if (!services.length || !EXPERIENCE.includes(experience) || area.length < 2) return fail(res, 400, "Choose at least one service, your experience and your area.");
    const u = req.user, ex = (await db.q("SELECT status FROM pros WHERE user_id = ?", [u.id]))[0];
    if (ex) { await db.q("UPDATE pros SET services = ?, experience = ?, area = ?, bio = ? WHERE user_id = ?", [services.join(","), experience, area, bio || null, u.id]); }
    else {
      await db.q("INSERT INTO pros(user_id,services,experience,area,bio,status,available,lat,lng,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", [u.id, services.join(","), experience, area, bio || null, "PENDING", 0, u.lat, u.lng, now()]);
      await db.q("UPDATE users SET is_pro = 1 WHERE id = ?", [u.id]);
      notify(`New professional to approve: ${u.name}`, `A new professional registered.\n\nName: ${u.name}\nPhone: ${u.phone}\nEmail: ${u.email}\nServices: ${services.join(", ")}\nExperience: ${experience}\nArea: ${area}\n\nApprove or reject at /admin.`);
    }
    res.json({ ok: true });
  } catch (e) { console.error(e.message); fail(res, 500, "Something went wrong."); }
});
app.get("/api/pro/me", auth("google"), async (req, res) => {
  const p = (await db.q("SELECT services, experience, area, bio, status, available FROM pros WHERE user_id = ?", [req.user.id]))[0];
  res.json({ ok: true, pro: p ? { ...p, services: p.services.split(","), available: Number(p.available) === 1 } : null });
});
app.post("/api/pro/availability", auth("full"), async (req, res) => {
  try {
    const p = (await db.q("SELECT status FROM pros WHERE user_id = ?", [req.user.id]))[0];
    if (!p || p.status !== "APPROVED") return fail(res, 403, "Your profile is not approved yet.");
    await db.q("UPDATE pros SET available = ? WHERE user_id = ?", [(req.body || {}).available === true ? 1 : 0, req.user.id]); res.json({ ok: true });
  } catch (e) { console.error(e.message); fail(res, 500, "Something went wrong."); }
});
async function proJobs(proId) {
  return db.q("SELECT id, created_at, service, issue, slot_date, slot_time, status, note, lat, lng, name, phone, address, map_link FROM bookings WHERE pro_user_id = ? ORDER BY created_at DESC LIMIT 100", [proId]);
}
app.get("/api/pro/orders", auth("full"), async (req, res) => {
  try {
    const p = (await db.q("SELECT status, lat, lng FROM pros WHERE user_id = ?", [req.user.id]))[0];
    if (!p || p.status !== "APPROVED") return fail(res, 403, "Your profile is not approved yet.");
    res.json({ ok: true, orders: (await proJobs(req.user.id)).map(o => {
      const open = ["ASSIGNED", "ON_THE_WAY", "COMPLETED"].includes(o.status), km = p.lat != null && o.lat != null ? Math.round(hav(p.lat, p.lng, o.lat, o.lng) * 10) / 10 : null;
      return { id: o.id, service: o.service, issue: o.issue, date: o.slot_date, slot: o.slot_time, status: o.status, km, note: o.note,
        customer: open ? { name: o.name, phone: o.phone, address: o.address, map: o.map_link } : null };
    }) });
  } catch (e) { console.error(e.message); fail(res, 500, "Something went wrong."); }
});
async function proOwnOrder(req, res) {
  if (!BOOKING_ID.test(req.params.id)) { fail(res, 400, "Bad id."); return null; }
  const b = (await db.q("SELECT status FROM bookings WHERE id = ? AND pro_user_id = ?", [req.params.id, req.user.id]))[0];
  if (!b) { fail(res, 404, "Not found."); return null; } return b;
}
const logEvent = (id, from, to, actor, note) => db.q("INSERT INTO job_events(id,booking_id,at,from_status,to_status,actor,note) VALUES(?,?,?,?,?,?,?)", [crypto.randomUUID(), id, now(), from, to, actor, note || null]);
app.post("/api/pro/orders/:id/respond", auth("full"), async (req, res) => {
  try {
    const b = await proOwnOrder(req, res); if (!b) return;
    const action = clean((req.body || {}).action, 10);
    if (!["REQUESTED", "CONFIRMED"].includes(b.status) || !["accept", "decline"].includes(action)) return fail(res, 409, "You can no longer respond to this order.");
    if (action === "accept") {
      await db.q("UPDATE bookings SET status = 'ASSIGNED', assigned_to = ?, updated_at = ? WHERE id = ?", [req.user.name, now(), req.params.id]);
      await logEvent(req.params.id, b.status, "ASSIGNED", "pro", "Accepted by " + req.user.name);
    } else {
      await db.q("UPDATE bookings SET pro_user_id = NULL, updated_at = ? WHERE id = ?", [now(), req.params.id]);
      await logEvent(req.params.id, b.status, b.status, "pro", "Declined by " + req.user.name);
    }
    res.json({ ok: true });
  } catch (e) { console.error(e.message); fail(res, 500, "Something went wrong."); }
});
app.post("/api/pro/orders/:id/status", auth("full"), async (req, res) => {
  try {
    const b = await proOwnOrder(req, res); if (!b) return;
    const to = clean((req.body || {}).status, 20), ok = (b.status === "ASSIGNED" && to === "ON_THE_WAY") || (b.status === "ON_THE_WAY" && to === "COMPLETED");
    if (!ok) return fail(res, 409, "That change is not allowed.");
    await db.q("UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?", [to, now(), req.params.id]);
    await logEvent(req.params.id, b.status, to, "pro", null); res.json({ ok: true });
  } catch (e) { console.error(e.message); fail(res, 500, "Something went wrong."); }
});

/* ===================== Admin (separate signed cookie) ===================== */
const sign = d => crypto.createHmac("sha256", SESSION_SECRET).update(d).digest("base64url");
const makeToken = () => { const body = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 3600e3 })).toString("base64url"); return body + "." + sign(body); };
const validToken = t => { if (!t) return false; const [body, sig] = t.split("."); if (!body || !sig || !safeEq(sig, sign(body))) return false; try { return JSON.parse(Buffer.from(body, "base64url")).exp > Date.now(); } catch { return false; } };
const requireAdmin = (req, res, next) => {
  if (!adminEnabled()) return fail(res, 503, "Admin is not set up.");
  if (!validToken(cookie(req, "sv_admin"))) return fail(res, 401, "Please sign in.");
  if (req.method !== "GET" && (req.get("x-requested-with") !== "fetch" || !sameOrigin(req))) return fail(res, 403, "Not allowed.");
  next();
};
app.post("/api/admin/login", limiter(6, 15 * 60 * 1000, { skipSuccessfulRequests: true }), async (req, res) => {
  if (!adminEnabled()) return fail(res, 503, "Admin is not set up.");
  if (req.get("x-requested-with") !== "fetch" || !sameOrigin(req)) return fail(res, 403, "Not allowed.");
  if (!safeEq(String((req.body || {}).password || ""), ADMIN_PASSWORD)) { await new Promise(r => setTimeout(r, 600)); return fail(res, 401, "Wrong password."); }
  res.setHeader("Set-Cookie", `sv_admin=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${req.secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => { res.setHeader("Set-Cookie", "sv_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); res.json({ ok: true }); });
app.get("/api/admin/me", requireAdmin, (_q, res) => res.json({ ok: true }));
app.get("/api/admin/bookings", requireAdmin, async (req, res) => {
  try {
    const status = clean(req.query.status, 20), q = clean(req.query.q, 40), where = [], p = [];
    if (TRANSITIONS[status]) { where.push("status = ?"); p.push(status); }
    if (q) { where.push("(id LIKE ? OR name LIKE ? OR phone LIKE ?)"); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    res.json({ ok: true, rows: await db.q(`SELECT id,created_at,name,phone,service,status,slot_date,slot_time,assigned_to FROM bookings ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 200`, p) });
  } catch (e) { console.error(e.message); fail(res, 500, "Failed."); }
});
app.get("/api/admin/bookings/:id", requireAdmin, async (req, res) => {
  try {
    if (!BOOKING_ID.test(req.params.id)) return fail(res, 400, "Bad id.");
    const b = (await db.q("SELECT * FROM bookings WHERE id = ?", [req.params.id]))[0]; if (!b) return fail(res, 404, "Not found.");
    res.json({ ok: true, booking: b, events: await db.q("SELECT at,from_status,to_status,actor,note FROM job_events WHERE booking_id = ? ORDER BY at", [b.id]), next: TRANSITIONS[b.status] || [] });
  } catch (e) { console.error(e.message); fail(res, 500, "Failed."); }
});
app.post("/api/admin/bookings/:id/status", requireAdmin, async (req, res) => {
  try {
    if (!BOOKING_ID.test(req.params.id)) return fail(res, 400, "Bad id.");
    const to = clean((req.body || {}).status, 20), note = clean((req.body || {}).note, 300), tech = clean((req.body || {}).assigned_to, 80), proId = clean((req.body || {}).pro_user_id, 20);
    const b = (await db.q("SELECT status, assigned_to, pro_user_id FROM bookings WHERE id = ?", [req.params.id]))[0]; if (!b) return fail(res, 404, "Not found.");
    if (!(TRANSITIONS[b.status] || []).includes(to)) return fail(res, 409, `Cannot move from ${b.status} to ${to}.`);
    if (to === "ASSIGNED" && !tech) return fail(res, 400, "Enter the professional's name.");
    if (proId && !USER_ID.test(proId)) return fail(res, 400, "Bad professional id.");
    await db.q("UPDATE bookings SET status = ?, updated_at = ?, assigned_to = ?, pro_user_id = ?, admin_note = COALESCE(?, admin_note) WHERE id = ?", [to, now(), to === "ASSIGNED" ? tech : b.assigned_to, proId || b.pro_user_id, note || null, req.params.id]);
    await logEvent(req.params.id, b.status, to, "admin", note); res.json({ ok: true });
  } catch (e) { console.error(e.message); fail(res, 500, "Failed."); }
});
app.get("/api/admin/pros", requireAdmin, async (_q, res) => {
  try { res.json({ ok: true, rows: await db.q("SELECT p.user_id, p.services, p.experience, p.area, p.status, p.available, p.created_at, u.name, u.phone, u.email, u.phone_verified FROM pros p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 200") }); }
  catch (e) { console.error(e.message); fail(res, 500, "Failed."); }
});
app.post("/api/admin/pros/:id/status", requireAdmin, async (req, res) => {
  try {
    const st = clean((req.body || {}).status, 20);
    if (!USER_ID.test(req.params.id) || !["PENDING", "APPROVED", "REJECTED", "SUSPENDED"].includes(st)) return fail(res, 400, "Bad request.");
    await db.q("UPDATE pros SET status = ?, available = CASE WHEN ? = 'APPROVED' THEN available ELSE 0 END WHERE user_id = ?", [st, st, req.params.id]); res.json({ ok: true });
  } catch (e) { console.error(e.message); fail(res, 500, "Failed."); }
});
app.get("/api/admin/stats", requireAdmin, async (_q, res) => {
  try { const c = async s => Number((await db.q(s))[0].n); res.json({ ok: true, customers: await c("SELECT COUNT(*) AS n FROM users"), pros: await c("SELECT COUNT(*) AS n FROM pros WHERE status = 'APPROVED'"), pending: await c("SELECT COUNT(*) AS n FROM pros WHERE status = 'PENDING'"), orders: await c("SELECT COUNT(*) AS n FROM bookings") }); }
  catch (e) { console.error(e.message); fail(res, 500, "Failed."); }
});

app.use((err, _req, res, _next) => res.status(400).json({ ok: false, error: "Bad request." }));
app.use((_req, res) => res.status(404).send("Page not found"));
initDb().catch(e => console.error("Database setup failed:", e.message)).finally(() => app.listen(process.env.PORT || 3000, () => console.log("Suvidha website is running")));
