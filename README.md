# Suvidha website: how to put it online (simple steps)

This folder is a complete website with a secure backend, a booking database and an admin dashboard.

## What the website does
- Customers book a technician (service, problem, address, pincode, date, time) and get a booking reference.
- The booking is saved in your database AND emailed to you (hyperstorage19@gmail.com).
- Customers can track their booking with the reference and the last 4 digits of their phone.
- You manage everything at https://YOUR-SITE/admin : confirm, assign a professional, mark on the way, complete or cancel. Every change is recorded with a time.
- Technician applications are saved and emailed too.
- Google Maps: the contact section shows an embedded map of Prayagraj and an "Open in Google Maps" button. The booking form has an optional Google Maps link, and /admin has buttons to open the customer's address in Google Maps.

## Step 1: Gmail App Password (3 minutes)
1. Google Account > Security. Turn ON 2-Step Verification.
2. Search "App passwords" and create one named "Suvidha website".
3. Copy the 16 letters. Keep them private. Never send them to anyone.

## Step 2: Create a free database (5 minutes)
Bookings need a database, or they are only emailed and the admin page and tracking stay off.
1. On render.com choose New > PostgreSQL (free plan), or use neon.tech or supabase.com.
2. Copy the "connection URL" (it starts with postgres://). This is your DATABASE_URL.
Note: some free databases expire or pause after some time. Check the plan, and make regular backups of important data.

## Step 3: Put the files on GitHub
Upload ALL files and folders from this package (public, views, server.js, package.json, README.md, .gitignore, .env.example). Do NOT upload a file called ".env".
If you already did this before, replace the old files with these new ones.

## Step 4: Publish on Render
1. render.com > New > Web Service > connect your GitHub repository.
2. Build command: npm install    Start command: npm start
3. Add these Environment Variables:
   - GMAIL_USER = hyperstorage19@gmail.com
   - GMAIL_APP_PASSWORD = the 16 letters from Step 1
   - OWNER_EMAIL = hyperstorage19@gmail.com
   - DATABASE_URL = the URL from Step 2
   - ADMIN_PASSWORD = a long unique password (12+ characters). Use a password manager.
   - SESSION_SECRET = any long random text (30+ characters)
4. Deploy. Open your link, make a TEST booking, then open /admin, sign in and manage it. Check your inbox and Spam folder too.

## Step 5: Your own web address (recommended)
Buy a domain (for example suvidha.in), add it in Render > Settings > Custom Domains, and copy the DNS records Render shows into your domain seller. HTTPS is automatic. Then set SITE_URL to your domain for extra protection.

## Security built in
- Admin: long password required, login limited to 6 wrong tries per 15 minutes, signed login cookie (HttpOnly, SameSite Strict, Secure, expires in 8 hours), protection against cross-site requests, and all customer text is shown safely.
- Website: strict content security policy (no inline scripts), HTTPS redirect and HSTS, clickjacking protection, secure headers, request size limit.
- Forms: validated and cleaned on the server, hidden bot trap, too-fast check, rate limits, duplicate-submission protection, safe database queries (no SQL injection).
- Tracking needs the reference AND the phone digits, and shows no address or phone number.
- Your Gmail App Password and admin password live only in Render settings, never in the website code.
- Errors are logged on the server only; visitors see simple messages.

## Your part to stay safe
- Never share ADMIN_PASSWORD, the App Password or DATABASE_URL. If one leaks, change it straight away.
- Keep 2-Step Verification on for your Gmail, GitHub and Render accounts.
- Update packages now and then (run "npm audit", or ask a developer).
- Do not use /admin on a shared or public computer.
- No website can be made 100% unhackable. This setup follows good practice, but you should test it and keep it updated.

## Technician profiles
Open public/app.js, find "const TECHS=[]" and add your real technicians. The "Our professionals" section then appears.

## Test on your own computer (optional)
Install Node.js 22 or newer. In this folder run:
  npm install
  copy .env.example to .env and fill the values
  npm start
Open http://localhost:3000   (admin: http://localhost:3000/admin)
For a quick local test without Postgres, add SQLITE_FILE=local.db to .env (do not use this on Render).
