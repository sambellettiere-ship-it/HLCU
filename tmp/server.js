'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const RECURRING_FILE = path.join(DATA_DIR, 'recurring.json');
const OWNER_EMAIL = process.env.NOTIFY_EMAIL || 'hiddenlevelcu@gmail.com';

app.use(express.json());
app.use(express.static(__dirname, { dotfiles: 'deny' }));

// ── Data helpers ──────────────────────────────────────────────
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJSON(file, fallback) {
  ensureDir();
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── Email ─────────────────────────────────────────────────────
function getTransport() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
}

async function sendMail({ to, replyTo, subject, text, html }) {
  const transport = getTransport();
  if (!transport) {
    console.log('[EMAIL not configured — would send to:', to, '| Subject:', subject + ']');
    return;
  }
  try {
    await transport.sendMail({
      from: `Hidden Level Cyber Cafe <${process.env.SMTP_USER}>`,
      to, replyTo, subject, text, html,
    });
  } catch (err) {
    console.error('[EMAIL error]', err.message);
  }
}

// ── Auth ──────────────────────────────────────────────────────
function safeCompare(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkAuth(req, res) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    res.status(503).json({ error: 'Admin credentials not configured on server' });
    return false;
  }
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  let reqUser = '', reqPass = '';
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep < 0) throw new Error();
    reqUser = decoded.slice(0, sep);
    reqPass = decoded.slice(sep + 1);
  } catch { res.status(401).json({ error: 'Unauthorized' }); return false; }
  if (!safeCompare(reqUser, username) || !safeCompare(reqPass, password)) {
    res.status(401).json({ error: 'Unauthorized' }); return false;
  }
  return true;
}

// ── Admin ping ────────────────────────────────────────────────
app.get('/api/admin/ping', (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json({ ok: true });
});

// ── Events ────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.json(readJSON(EVENTS_FILE, []));
});

app.post('/api/events', (req, res) => {
  if (!checkAuth(req, res)) return;
  const { date, title, description, type, startTime, endTime } = req.body;
  if (!date || !title) return res.status(400).json({ error: 'date and title are required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const validTypes = ['community', 'family', 'private', 'special'];
  const events = readJSON(EVENTS_FILE, []);
  const ev = {
    id: Date.now().toString(),
    date,
    title: String(title).trim().slice(0, 100),
    description: String(description || '').trim().slice(0, 500),
    type: validTypes.includes(type) ? type : 'special',
    startTime: String(startTime || '').trim().slice(0, 8),
    endTime: String(endTime || '').trim().slice(0, 8),
    createdAt: new Date().toISOString(),
  };
  events.push(ev);
  writeJSON(EVENTS_FILE, events);
  res.status(201).json(ev);
});

app.delete('/api/events/:id', (req, res) => {
  if (!checkAuth(req, res)) return;
  const events = readJSON(EVENTS_FILE, []);
  const idx = events.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Event not found' });
  const [removed] = events.splice(idx, 1);
  writeJSON(EVENTS_FILE, events);
  res.json(removed);
});

// ── Recurring events ──────────────────────────────────────────
app.get('/api/recurring', (req, res) => {
  res.json(readJSON(RECURRING_FILE, []));
});

app.post('/api/recurring', (req, res) => {
  if (!checkAuth(req, res)) return;
  const { title, description, type, startTime, endTime, frequency, dayOfWeek, nth, startDate, endDate } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (frequency !== 'weekly' && frequency !== 'monthly_nth') {
    return res.status(400).json({ error: 'frequency must be "weekly" or "monthly_nth"' });
  }
  const dow = Number(dayOfWeek);
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
    return res.status(400).json({ error: 'dayOfWeek must be an integer 0–6 (Sun–Sat)' });
  }
  let nthVal = null;
  if (frequency === 'monthly_nth') {
    nthVal = Number(nth);
    // Allow 1–4 or -1 (last occurrence in the month)
    if (!Number.isInteger(nthVal) || (nthVal !== -1 && (nthVal < 1 || nthVal > 4))) {
      return res.status(400).json({ error: 'nth must be 1, 2, 3, 4, or -1 (last)' });
    }
  }
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return res.status(400).json({ error: 'startDate must be YYYY-MM-DD' });
  }
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return res.status(400).json({ error: 'endDate must be YYYY-MM-DD' });
  }
  const validTypes = ['community', 'family', 'private', 'special'];
  const list = readJSON(RECURRING_FILE, []);
  const rule = {
    id: Date.now().toString(),
    title: String(title).trim().slice(0, 100),
    description: String(description || '').trim().slice(0, 500),
    type: validTypes.includes(type) ? type : 'special',
    startTime: String(startTime || '').trim().slice(0, 8),
    endTime: String(endTime || '').trim().slice(0, 8),
    frequency,
    dayOfWeek: dow,
    nth: nthVal,
    startDate: startDate || '',
    endDate: endDate || '',
    createdAt: new Date().toISOString(),
  };
  list.push(rule);
  writeJSON(RECURRING_FILE, list);
  res.status(201).json(rule);
});

app.delete('/api/recurring/:id', (req, res) => {
  if (!checkAuth(req, res)) return;
  const list = readJSON(RECURRING_FILE, []);
  const idx = list.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Recurring event not found' });
  const [removed] = list.splice(idx, 1);
  writeJSON(RECURRING_FILE, list);
  res.json(removed);
});

// ── Contact / booking form ────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message, bookingDate, bookingTime, bookingGuests, bookingType } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'name, email, and message are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });

  const subjectLabels = { general: 'General Question', booking: 'Private Booking', membership: 'Membership', event: 'Event Info', other: 'Other' };
  const subjectLabel = subjectLabels[subject] || subject || 'Contact Form';

  let extraText = '';
  let extraHtml = '';
  if (subject === 'booking') {
    extraText = [
      bookingDate ? `Preferred Date: ${bookingDate}` : '',
      bookingTime ? `Preferred Time: ${bookingTime}` : '',
      bookingGuests ? `Expected Guests: ${bookingGuests}` : '',
      bookingType ? `Occasion: ${bookingType}` : '',
    ].filter(Boolean).join('\n');
    extraHtml = [
      bookingDate ? `<p><strong>Preferred Date:</strong> ${bookingDate}</p>` : '',
      bookingTime ? `<p><strong>Preferred Time:</strong> ${bookingTime}</p>` : '',
      bookingGuests ? `<p><strong>Expected Guests:</strong> ${bookingGuests}</p>` : '',
      bookingType ? `<p><strong>Occasion:</strong> ${bookingType}</p>` : '',
    ].filter(Boolean).join('');
  }

  const fullText = `New message from ${name} (${email})\nSubject: ${subjectLabel}\n\n${extraText ? extraText + '\n\n' : ''}Message:\n${message}`;
  const fullHtml = `<h3>${subjectLabel}</h3><p><strong>From:</strong> ${name} &lt;${email}&gt;</p>${extraHtml}<hr><p><strong>Message:</strong></p><p>${String(message).replace(/\n/g, '<br>')}</p>`;

  await sendMail({
    to: OWNER_EMAIL,
    replyTo: email,
    subject: `[Hidden Level] ${subjectLabel} from ${name}`,
    text: fullText,
    html: fullHtml,
  });

  res.json({ ok: true });
});

// Block data directory
app.get('/data/*', (req, res) => res.status(404).end());

// Admin dashboard
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(PORT, () => {
  console.log(`Hidden Level running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
