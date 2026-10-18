require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

const { GMAIL_USER, GMAIL_APP_PASSWORD, OWNER_EMAIL, SITE_URL } = process.env;
if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !OWNER_EMAIL) {
  console.warn("WARNING: GMAIL_USER, GMAIL_APP_PASSWORD and OWNER_EMAIL must all be set, or booking emails will fail.");
}
const allowedOrigins = (SITE_URL || "").split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);

const app = express();
app.set("trust proxy", 1);            // correct visitor IP behind Render/Railway
app.disable("x-powered-by");
app.use(helmet({                      // security headers + content security policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      mediaSrc: ["'self'"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "10kb" }));   // reject big requests
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
app.get("/healthz", (_req, res) => res.send("ok"));

const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
});

// Remove control characters (stops email-header injection) and limit length
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanNote = v => String(v == null ? "" : v).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").trim().slice(0, 1000);
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SLOTS = ["Morning", "Afternoon", "Evening", "Any time"];
const istDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

const bookingLimiter = rateLimit({            // max 5 bookings per visitor per 15 minutes
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests. Please try again in a few minutes." }
});

app.post("/api/booking", bookingLimiter, async (req, res) => {
  try {
    const origin = req.get("origin");
    if (allowedOrigins.length && origin && !allowedOrigins.includes(origin.replace(/\/$/, ""))) {
      return res.status(403).json({ ok: false, error: "Not allowed." });
    }
    const b = req.body || {};
    if (clean(b.website, 100)) return res.json({ ok: true, ref: "SV-OK" });      // hidden trap field filled = bot
    if (!(Number(b.t) >= 3000)) return res.json({ ok: true, ref: "SV-OK" });     // submitted too fast = bot

    const name = clean(b.name, 80), phone = clean(b.phone, 20), service = clean(b.service, 80);
    const address = clean(b.address, 200), date = clean(b.date, 10), slot = clean(b.slot, 20), note = cleanNote(b.note);

    const badDate = !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < istDate(0) || date > istDate(90);
    if (name.length < 2 || service.length < 2 || address.length < 5 || !/^\+?[\d\s-]{8,16}$/.test(phone) || badDate || !SLOTS.includes(slot)) {
      return res.status(400).json({ ok: false, error: "Please check your name, phone, service, address and date." });
    }

    const ref = "SV-" + istDate(0).replace(/-/g, "") + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
    let digits = phone.replace(/\D/g, "");
    if (digits.length === 10) digits = "91" + digits;

    await mailer.sendMail({
      from: `"Suvidha Website" <${GMAIL_USER}>`,
      to: OWNER_EMAIL,
      subject: `New booking ${ref}: ${service} - ${name}`,
      text: `New technician booking from the Suvidha website\n\nReference: ${ref}\nName: ${name}\nPhone: ${phone}\nService: ${service}\nAddress: ${address}\nPreferred date: ${date}\nPreferred time: ${slot}\nDetails: ${note || "-"}\n\nWhatsApp the customer: https://wa.me/${digits}\n`,
      html: `<h2>New technician booking</h2><p><b>Reference:</b> ${ref}<br><b>Name:</b> ${esc(name)}<br><b>Phone:</b> <a href="tel:+${digits}">${esc(phone)}</a><br><b>Service:</b> ${esc(service)}<br><b>Address:</b> ${esc(address)}<br><b>Preferred date:</b> ${date}<br><b>Preferred time:</b> ${slot}<br><b>Details:</b> ${esc(note || "-")}</p><p><a href="https://wa.me/${digits}">WhatsApp the customer</a></p>`
    });
    res.json({ ok: true, ref });
  } catch (err) {
    console.error("Booking email failed:", err.message);          // details stay in the server log only
    res.status(500).json({ ok: false, error: "Could not send right now." });
  }
});

const partnerLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 3, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: "Too many requests. Please try again later." } });
app.post("/api/partner", partnerLimiter, async (req, res) => {
  try {
    const origin = req.get("origin");
    if (allowedOrigins.length && origin && !allowedOrigins.includes(origin.replace(/\/$/, ""))) return res.status(403).json({ ok: false, error: "Not allowed." });
    const b = req.body || {};
    if (clean(b.website, 100) || !(Number(b.t) >= 3000)) return res.json({ ok: true });
    const name = clean(b.name, 80), phone = clean(b.phone, 20), skill = clean(b.skill, 80), exp = clean(b.exp, 30), area = clean(b.area, 120);
    if (name.length < 2 || skill.length < 2 || !exp || !/^\+?[\d\s-]{8,16}$/.test(phone)) return res.status(400).json({ ok: false, error: "Please check your details." });
    let digits = phone.replace(/\D/g, ""); if (digits.length === 10) digits = "91" + digits;
    await mailer.sendMail({
      from: `"Suvidha Website" <${GMAIL_USER}>`, to: OWNER_EMAIL,
      subject: `New partner application: ${skill} - ${name}`,
      text: `New partner application\n\nName: ${name}\nPhone: ${phone}\nSkill: ${skill}\nExperience: ${exp}\nArea: ${area || "-"}\n\nWhatsApp: https://wa.me/${digits}\n`,
      html: `<h2>New partner application</h2><p><b>Name:</b> ${esc(name)}<br><b>Phone:</b> <a href="tel:+${digits}">${esc(phone)}</a><br><b>Skill:</b> ${esc(skill)}<br><b>Experience:</b> ${esc(exp)}<br><b>Area:</b> ${esc(area || "-")}</p><p><a href="https://wa.me/${digits}">WhatsApp the applicant</a></p>`
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Partner email failed:", err.message);
    res.status(500).json({ ok: false, error: "Could not send right now." });
  }
});

app.use((err, _req, res, _next) => res.status(400).json({ ok: false, error: "Bad request." }));
app.use((_req, res) => res.status(404).send("Page not found"));
app.listen(process.env.PORT || 3000, () => console.log("Suvidha website is running"));
