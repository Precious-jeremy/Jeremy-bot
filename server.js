// server.js — Express web dashboard server for JEREMY BOT multi-user platform
// Runs as a SEPARATE process from index.js (the bot itself). Does not touch bot logic.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const mailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'lilcagey557@gmail.com',
    pass: 'npaqzanlcylrzvie'
  }
});

async function sendEmail(to, subject, html) {
  try {
    await mailTransporter.sendMail({
      from: '"JEREMY BOT" <lilcagey557@gmail.com>',
      to,
      subject,
      html
    });
    return true;
  } catch (err) {
    console.log('Email send failed:', err.message);
    return false;
  }
}
const { db, initDb } = require('./db');
const { startBot } = require('./index');
const activeSessions = {}; // in-memory map: userId -> { sock, phoneNumber, status, connectedAt }

const app = express();
const PORT = 1331;
const JWT_SECRET = 'change-this-secret-later'; // TODO: move to env var before production

app.use(express.json());
app.use(express.static('public'));

// Middleware: verify JWT token on protected routes
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

/// POST /api/register — create a new user account (requires email)
app.post('/api/register', async (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password || !email) return res.status(400).json({ error: 'Username, password, and email required' });

  await db.read();
  const existing = db.data.users.find(u => u.username === username);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const existingEmail = db.data.users.find(u => u.email === email);
  if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: Date.now().toString(),
    username,
    email,
    passwordHash,
    role: db.data.users.length === 0 ? 'admin' : 'user',
    createdAt: new Date().toISOString()
  };
  db.data.users.push(newUser);
  await db.write();

  sendEmail(email, 'Welcome to JEREMY BOT', `<h2>Welcome, ${username}!</h2><p>Your account has been created. You can now log in and pair your WhatsApp bot.</p>`);

  res.json({ success: true, message: 'User registered', role: newUser.role });
});
// POST /api/login — authenticate and return JWT
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  await db.read();
  const user = db.data.users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, role: user.role });
});

// GET /api/me — test protected route, returns current user info
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/pair — connect a new WhatsApp number for the logged-in user
app.post('/api/pair', authMiddleware, async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });

  const userId = req.user.id;
  let realSessions = {};
  try { realSessions = JSON.parse(fs.readFileSync('sessions.json', 'utf8')); } catch (e) {}
  const isReallyConnected = Object.values(realSessions).some(s => s.status === 'connected');
  if (isReallyConnected) {
    return res.status(409).json({ error: 'You already have a connected session' });
  }

  const authFolder = `sessions/${phoneNumber.replace(/[^0-9]/g, '')}`;
    activeSessions[userId] = { phoneNumber, status: 'pairing', connectedAt: null };

  try {
    await startBot(authFolder, phoneNumber, (code) => {
      activeSessions[userId].pairingCode = code;
    });

    await db.read();
    db.data.sessions.push({
      id: Date.now().toString(),
      userId,
      phoneNumber,
      status: 'connected',
      connectedAt: activeSessions[userId].connectedAt,
      folderPath: authFolder
    });
    await db.write();

    res.json({ success: true, pairingCode: activeSessions[userId].pairingCode || null, message: 'Pairing initiated' });
  } catch (err) {
    activeSessions[userId].status = 'error';
    res.status(500).json({ error: 'Failed to start pairing', details: err.message });
  }
});

// GET /api/status — check current session status + pairing code for the logged-in user
app.get('/api/status', authMiddleware, (req, res) => {
  const session = activeSessions[req.user.id];
  if (!session) return res.json({ status: 'not_connected' });
  res.json(session);
});

async function reconnectSavedSessions() {
  await db.read();
  const sessions = db.data.sessions.filter(s => s.status === 'connected');
  for (const s of sessions) {
    console.log('Reconnecting saved dashboard session for user:', s.userId, s.phoneNumber);
    activeSessions[s.userId] = { phoneNumber: s.phoneNumber, status: 'reconnecting', connectedAt: s.connectedAt };
    try {
      await startBot(s.folderPath, s.phoneNumber, (code) => {
        activeSessions[s.userId].pairingCode = code;
      });
      activeSessions[s.userId].status = 'connected';
    } catch (err) {
      console.log('Failed to reconnect session for', s.userId, err.message);
      activeSessions[s.userId].status = 'error';
    }
  }
}
const fs = require('fs');
const path = require('path');

// GET /api/stats — returns commandsUsed/groupsJoined for the logged-in user's session
app.get('/api/stats', authMiddleware, (req, res) => {
  const session = activeSessions[req.user.id];
  if (!session) return res.json({ commandsUsed: 0, groupsJoined: 0 });

  const statsPath = path.join(`sessions/${req.user.id}`, 'stats.json');
  if (!fs.existsSync(statsPath)) return res.json({ commandsUsed: 0, groupsJoined: 0 });

  try {
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    res.json(stats);
  } catch (e) {
    res.json({ commandsUsed: 0, groupsJoined: 0 });
  }
});

async function start() {
  await initDb();
  await reconnectSavedSessions();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Dashboard server running on http://localhost:${PORT}`);
  });
}

start();
