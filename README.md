# Suvidha website - how to put it online (simple steps)

This folder is a complete website with a secure backend. When a customer books a technician on the form,
the booking details (reference number, name, phone, service, address, date and time) are sent to your email (hyperstorage19@gmail.com).

## Step 1: Make a Gmail "App Password" (about 3 minutes)
This is a special password only for the website. Your real Gmail password is never used.
1. Open your Google Account > Security.
2. Turn ON "2-Step Verification" (if it is off).
3. Search for "App passwords", create one named "Suvidha website".
4. Copy the 16 letters Google shows you. Keep them private. Do NOT send them to anyone, including Claude.

## Step 2: Put the files on GitHub (free)
1. Make a free account at github.com and create a new repository named "suvidha-website".
2. Upload ALL files from this folder (public folder, server.js, package.json, README.md, .gitignore, .env.example).
3. Do NOT upload a file called ".env" (it is meant to stay secret).

## Step 3: Publish on Render (free to start)
1. Make a free account at render.com and choose New > Web Service. Connect your GitHub repository.
2. Build command: npm install     Start command: npm start
3. Under Environment Variables, add:
   - GMAIL_USER = hyperstorage19@gmail.com
   - GMAIL_APP_PASSWORD = the 16 letters from Step 1
   - OWNER_EMAIL = hyperstorage19@gmail.com
4. Click Deploy. In a few minutes Render gives you a public link like https://suvidha-website.onrender.com
5. Open the link, send a test booking, and check your inbox (and Spam folder the first time).
Note: on free plans the site may "sleep" when nobody visits, so the first visit can be slow. A paid plan removes this.

## Step 4: Your own web address (recommended for a business)
1. Buy a domain such as suvidha.in or suvidhaprayagraj.com from a domain seller (GoDaddy, Namecheap, Hostinger and others).
2. In Render: Settings > Custom Domains > add your domain, then copy the DNS records Render shows into your domain seller's DNS page.
3. HTTPS (the padlock) is added automatically.
4. Then set SITE_URL in Render to your domain, for example https://www.suvidha.in,https://suvidha.in (extra protection).

## Security built in
- Secure browser headers and a content security policy (helmet).
- Each visitor can send at most 5 bookings in 15 minutes (stops spam floods).
- Hidden trap field and "too fast" check to catch bots.
- Every field is cleaned and length-limited; emails are safe from header injection and HTML tricks.
- Requests larger than 10 KB are refused.
- Your Gmail App Password lives only on the server, never in the website code.
- Error details stay in the server log; visitors only see a simple message.

## Your part to stay safe
- Never share the App Password. If it leaks, delete it in your Google Account and make a new one.
- Keep 2-Step Verification on for your Gmail.
- Your email and phone numbers are visible on the site, so expect some spam calls/emails. That is normal for a business site.
- Once in a while run "npm audit" or ask a developer to update the packages.

## Test on your own computer (optional)
Install Node.js, open this folder in a terminal, then:
  npm install
  copy .env.example to .env and fill the values
  npm start
Open http://localhost:3000

## What is new in this version
- Booking form (name, phone, service, address, date, time) with a booking reference number, emailed to you.
- "Join Suvidha" partner application form, also emailed to you.
- New sections: how booking works, pricing approach, trust, FAQ and policies.
- IMPORTANT: upload BOTH server.js and public/index.html to GitHub so the website and the email backend match.
- Policies and FAQ are starter text. Read them and change anything that is not how your business works.
- Technician profiles: open public/index.html, find "const TECHS=[]" and add your real technicians. The section then appears by itself.
