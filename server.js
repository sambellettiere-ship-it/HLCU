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
  : '/data/hlcc-volume';
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const REGISTRATIONS_FILE = path.join(DATA_DIR, 'registrations.json');
const RECURRING_FILE = path.join(DATA_DIR, 'recurring.json');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SHOWCASE_FILE = path.join(DATA_DIR, 'showcase.json');
const OWNER_EMAIL = process.env.NOTIFY_EMAIL || 'hiddenlevelcu@gmail.com';

app.use(express.json({ limit: '10mb' }));
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));
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

// ── User Auth & Captcha ───────────────────────────────────────
const captchas = new Map();

app.get('/api/auth/captcha', (req, res) => {
  const d1 = Math.floor(Math.random() * 10) + 1;
  const d2 = Math.floor(Math.random() * 10) + 1;
  const operators = ['+', '-', '*'];
  const op = operators[Math.floor(Math.random() * operators.length)];
  let ans = 0;
  if(op === '+') ans = d1 + d2;
  if(op === '-') ans = d1 - d2;
  if(op === '*') ans = d1 * d2;
  
  const id = crypto.randomUUID();
  captchas.set(id, { ans: ans.toString(), expires: Date.now() + 5*60000 });
  res.json({ id, text: `What is ${d1} ${op} ${d2}?` });
});

app.post('/api/auth/signup', (req, res) => {
  const { username, email, password, captchaId, captchaAnswer } = req.body;
  if (!username || !email || !password || !captchaId || !captchaAnswer) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const captcha = captchas.get(captchaId);
  if (!captcha || captcha.expires < Date.now() || captcha.ans !== captchaAnswer.trim()) {
    if (captcha) captchas.delete(captchaId);
    return res.status(400).json({ error: 'Invalid or expired captcha' });
  }
  captchas.delete(captchaId);
  
  const users = readJSON(USERS_FILE, []);
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase() || u.username.toLowerCase() === username.toLowerCase())) {
     return res.status(400).json({ error: 'Username or email already in use' });
  }
  
  const id = Date.now().toString();
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  
  const newUser = { id, username: username.trim(), email: email.trim().toLowerCase(), passwordHash, createdAt: new Date().toISOString() };
  users.push(newUser);
  writeJSON(USERS_FILE, users);
  
  const players = readJSON(PLAYERS_FILE, []);
  if (!players.find(p => p.name.toLowerCase() === username.trim().toLowerCase())) {
     players.push({ id, name: username.trim(), userId: id });
     writeJSON(PLAYERS_FILE, players);
  }
  
  res.json({ success: true, username: newUser.username });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const users = readJSON(USERS_FILE, []);
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.passwordHash === passwordHash);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const tokenPayload = Buffer.from(JSON.stringify({ userId: user.id })).toString('base64');
  const tokenSig = crypto.createHash('sha256').update(tokenPayload + process.env.ADMIN_PASSWORD).digest('base64');
  res.json({ token: tokenPayload + '.' + tokenSig, username: user.username });
});

// ── Event Registrations ───────────────────────────────────────
app.get('/api/registrations/:id', (req, res) => {
  const authMsg = req.headers.authorization;
  if (!authMsg) return res.json({ registered: false });
  // Just decode token naive for this prototype (admin is basic, users use jwt-like payload)
  let userId = null;
  if (authMsg.startsWith('Bearer ')) {
    try {
      const parts = authMsg.substring(7).split('.');
      if (parts.length === 2) {
        const payload = JSON.parse(Buffer.from(parts[0], 'base64').toString());
        userId = payload.userId;
      }
    } catch { }
  }
  if (!userId) return res.json({ registered: false });
  
  const regs = readJSON(REGISTRATIONS_FILE, []);
  const exists = regs.find(r => r.eventId === req.params.id && r.userId === userId);
  res.json({ registered: !!exists });
});

app.post('/api/registrations/:id', (req, res) => {
  const authMsg = req.headers.authorization;
  if (!authMsg || !authMsg.startsWith('Bearer ')) return res.status(401).json({ error: 'Log in to register' });
  
  let userId = null;
  try {
    const parts = authMsg.substring(7).split('.');
    if (parts.length === 2) {
      const payload = JSON.parse(Buffer.from(parts[0], 'base64').toString());
      userId = payload.userId;
    }
  } catch { }
  if (!userId) return res.status(401).json({ error: 'Invalid token' });
  
  const regs = readJSON(REGISTRATIONS_FILE, []);
  const existing = regs.find(r => r.eventId === req.params.id && r.userId === userId);
  
  if (req.body.register) {
    if (!existing) {
      regs.push({ eventId: req.params.id, userId, registeredAt: new Date().toISOString() });
      writeJSON(REGISTRATIONS_FILE, regs);
    }
    res.json({ registered: true });
  } else {
    if (existing) {
      const filtered = regs.filter(r => !(r.eventId === req.params.id && r.userId === userId));
      writeJSON(REGISTRATIONS_FILE, filtered);
    }
    res.json({ registered: false });
  }
});

// ── Admin ping ────────────────────────────────────────────────
app.get('/api/admin/ping', (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json({ ok: true });
});

app.get('/api/admin/events/:id/registrations', (req, res) => {
  if (!checkAuth(req, res)) return;
  const regs = readJSON(REGISTRATIONS_FILE, []);
  const users = readJSON(USERS_FILE, []);
  
  const id = req.params.id;
  const eventRegs = regs.filter(r => r.eventId === id || r.eventId.startsWith(id + '_'));
  const populated = eventRegs.map(r => {
    const u = users.find(user => user.id === r.userId);
    return {
      eventId: r.eventId,
      userId: r.userId,
      registeredAt: r.registeredAt,
      username: u ? u.username : 'Unknown',
      email: u ? u.email : 'Unknown'
    };
  });
  res.json(populated);
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

app.put('/api/events/:id', (req, res) => {
  if (!checkAuth(req, res)) return;
  const events = readJSON(EVENTS_FILE, []);
  const idx = events.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Event not found' });
  
  const { date, title, description, type, startTime, endTime } = req.body;
  if (!date || !title) return res.status(400).json({ error: 'date and title are required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  
  const validTypes = ['community', 'family', 'private', 'special'];
  
  const updatedEvent = {
    ...events[idx],
    date,
    title: String(title).trim().slice(0, 100),
    description: String(description || '').trim().slice(0, 500),
    type: validTypes.includes(type) ? type : 'special',
    startTime: String(startTime || '').trim().slice(0, 8),
    endTime: String(endTime || '').trim().slice(0, 8),
    updatedAt: new Date().toISOString(),
  };
  
  events[idx] = updatedEvent;
  writeJSON(EVENTS_FILE, events);
  res.json(updatedEvent);
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

app.put('/api/recurring/:id', (req, res) => {
  if (!checkAuth(req, res)) return;
  const list = readJSON(RECURRING_FILE, []);
  const idx = list.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Recurring event not found' });
  
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
  
  const updatedRule = {
    ...list[idx],
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
    updatedAt: new Date().toISOString(),
  };
  list[idx] = updatedRule;
  writeJSON(RECURRING_FILE, list);
  res.json(updatedRule);
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

// ── Leaderboard (Admin Managed) ───────────────────────────────
const GAMES_FILE = path.join(DATA_DIR, 'games.json');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

app.get('/api/admin/players', (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(readJSON(PLAYERS_FILE, []));
});

app.post('/api/admin/players', (req, res) => {
  if (!checkAuth(req, res)) return;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Player name is required' });
  const players = readJSON(PLAYERS_FILE, []);
  let player = players.find(p => p.name.toLowerCase() === name.trim().toLowerCase());
  if (!player) {
    player = { id: Date.now().toString(), name: name.trim() };
    players.push(player);
    writeJSON(PLAYERS_FILE, players);
  }
  res.json(player);
});

app.delete('/api/admin/players/:id', (req, res) => {
  if (!checkAuth(req, res)) return;
  const players = readJSON(PLAYERS_FILE, []);
  const idx = players.findIndex(p => p.id === req.params.id);
  if (idx !== -1) {
    players.splice(idx, 1);
    writeJSON(PLAYERS_FILE, players);
    const lb = readJSON(LEADERBOARD_FILE, []);
    writeJSON(LEADERBOARD_FILE, lb.filter(l => l.playerId !== req.params.id));
  }
  res.json({ success: true });
});

app.get('/api/admin/games', (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(readJSON(GAMES_FILE, []));
});

app.post('/api/admin/games', (req, res) => {
  if (!checkAuth(req, res)) return;
  const { name, stats } = req.body;
  if (!name || !stats || !Array.isArray(stats)) return res.status(400).json({ error: 'Game name and stats array are required' });
  const games = readJSON(GAMES_FILE, []);
  let game = games.find(g => g.name.toLowerCase() === name.trim().toLowerCase());
  if (game) {
    game.stats = stats;
  } else {
    game = { id: Date.now().toString(), name: name.trim(), stats };
    games.push(game);
  }
  writeJSON(GAMES_FILE, games);
  res.json(game);
});

app.delete('/api/admin/games/:id', (req, res) => {
  if (!checkAuth(req, res)) return;
  const games = readJSON(GAMES_FILE, []);
  const idx = games.findIndex(g => g.id === req.params.id);
  if (idx !== -1) {
    games.splice(idx, 1);
    writeJSON(GAMES_FILE, games);
    const lb = readJSON(LEADERBOARD_FILE, []);
    writeJSON(LEADERBOARD_FILE, lb.filter(l => l.gameId !== req.params.id));
  }
  res.json({ success: true });
});

app.get('/api/admin/leaderboard', (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(readJSON(LEADERBOARD_FILE, []));
});

app.post('/api/admin/leaderboard', (req, res) => {
  if (!checkAuth(req, res)) return;
  const { gameId, playerId, statsValues } = req.body;
  if (!gameId || !playerId || !statsValues) return res.status(400).json({ error: 'gameId, playerId, and statsValues are required' });
  
  const lb = readJSON(LEADERBOARD_FILE, []);
  let entry = lb.find(l => l.gameId === gameId && l.playerId === playerId);
  if (entry) {
    entry.statsValues = statsValues;
    entry.updatedAt = new Date().toISOString();
  } else {
    entry = { id: Date.now().toString(), gameId, playerId, statsValues, createdAt: new Date().toISOString() };
    lb.push(entry);
  }
  writeJSON(LEADERBOARD_FILE, lb);
  res.json(entry);
});

app.delete('/api/admin/leaderboard/:id', (req, res) => {
  if (!checkAuth(req, res)) return;
  const lb = readJSON(LEADERBOARD_FILE, []);
  const idx = lb.findIndex(l => l.id === req.params.id);
  if (idx !== -1) {
    lb.splice(idx, 1);
    writeJSON(LEADERBOARD_FILE, lb);
  }
  res.json({ success: true });
});

// ── Public Leaderboard ─────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  res.json({
    players: readJSON(PLAYERS_FILE, []),
    games: readJSON(GAMES_FILE, []),
    entries: readJSON(LEADERBOARD_FILE, [])
  });
});

// ── Showcase ──────────────────────────────────────────────────
app.get('/api/showcase', (req, res) => {
  const items = readJSON(SHOWCASE_FILE, []);
  res.json(items.filter(i => !i.pending));
});

app.get('/api/admin/showcase', (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(readJSON(SHOWCASE_FILE, []));
});

// User submit showcase
app.post('/api/showcase/submit', (req, res) => {
  const { title, author, description, url } = req.body;
  
  if (!title || !author || !url) {
    return res.status(400).json({ error: 'title, author, and url are required' });
  }

  const items = readJSON(SHOWCASE_FILE, []);
  const item = {
    id: crypto.randomUUID(),
    title, url, author, description: description || '',
    featured: false,
    pending: true,
    createdAt: new Date().toISOString()
  };
  items.unshift(item);
  writeJSON(SHOWCASE_FILE, items);
  res.json({ success: true });
});

app.post('/api/admin/showcase', (req, res) => {
  if (!checkAuth(req, res)) return;
  const { title, url, author, description, featured } = req.body;
  if (!title || !url || !author) return res.status(400).json({ error: 'title, url, and author are required' });
  
  const items = readJSON(SHOWCASE_FILE, []);
  let item;
  if (req.body.id) {
    const idx = items.findIndex(i => i.id === req.body.id);
    if (idx !== -1) {
      items[idx] = { ...items[idx], title, url, author, description, featured: !!featured };
      if (req.body.pending !== undefined) {
        items[idx].pending = !!req.body.pending;
      }
      item = items[idx];
    }
  }
  
  if (!item) {
    item = {
      id: crypto.randomUUID(),
      title, url, author, description: description || '', featured: !!featured,
      createdAt: new Date().toISOString()
    };
    items.unshift(item);
  }
  
  writeJSON(SHOWCASE_FILE, items);
  res.json(item);
});

app.delete('/api/admin/showcase/:id', (req, res) => {
  if (!checkAuth(req, res)) return;
  const items = readJSON(SHOWCASE_FILE, []);
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx !== -1) {
    const [removed] = items.splice(idx, 1);
    writeJSON(SHOWCASE_FILE, items);
    res.json(removed);
  } else {
    res.status(404).json({ error: 'Item not found' });
  }
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hidden Level running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
