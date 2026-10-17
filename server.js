require("dotenv").config();
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

const { GMAIL_USER, GMAIL_APP_PASSWORD, OWNER_EMAIL, SITE_URL } = process.env;
if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !OWNER_EMAIL) {
  console.warn("WARNING: GMAIL_USER, GMAIL_APP_PASSWORD and OWNER_EMAIL must all be set, or enquiry emails will fail.");
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

const enquiryLimiter = rateLimit({            // max 5 enquiries per visitor per 15 minutes
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many enquiries. Please try again in a few minutes." }
});

app.post("/api/enquiry", enquiryLimiter, async (req, res) => {
  try {
    const origin = req.get("origin");
    if (allowedOrigins.length && origin && !allowedOrigins.includes(origin.replace(/\/$/, ""))) {
      return res.status(403).json({ ok: false, error: "Not allowed." });
    }
    const b = req.body || {};
    if (clean(b.website, 100)) return res.json({ ok: true });      // hidden trap field filled = bot
    if (!(Number(b.t) >= 3000)) return res.json({ ok: true });     // submitted too fast = bot

    const name = clean(b.name, 80), phone = clean(b.phone, 20), service = clean(b.service, 80);
    const area = clean(b.area, 120), note = cleanNote(b.note);
    if (name.length < 2 || service.length < 2 || !/^\+?[\d\s-]{8,16}$/.test(phone)) {
      return res.status(400).json({ ok: false, error: "Please check your name, phone number and service." });
    }

    await mailer.sendMail({
      from: `"Suvidha Website" <${GMAIL_USER}>`,
      to: OWNER_EMAIL,
      subject: `New enquiry: ${service} - ${name}`,
      text: `New enquiry from the Suvidha website\n\nName: ${name}\nPhone: ${phone}\nService: ${service}\nArea: ${area || "-"}\nDetails: ${note || "-"}\n`,
      html: `<h2>New enquiry from the Suvidha website</h2><p><b>Name:</b> ${esc(name)}<br><b>Phone:</b> ${esc(phone)}<br><b>Service:</b> ${esc(service)}<br><b>Area:</b> ${esc(area || "-")}<br><b>Details:</b> ${esc(note || "-")}</p>`
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Enquiry email failed:", err.message);          // details stay in the server log only
    res.status(500).json({ ok: false, error: "Could not send right now." });
  }
});

app.use((err, _req, res, _next) => res.status(400).json({ ok: false, error: "Bad request." }));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.use((_req, res) => res.status(404).send("Page not found"));
app.listen(process.env.PORT || 3000, () => console.log("Suvidha website is running"));
