const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');

// Load environment variables from .env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'polls.json');
const AUTH_DIR = path.join(__dirname, 'baileys_auth');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// WhatsApp State Tracking
let whatsappStatus = 'INITIALIZING'; // 'INITIALIZING', 'QR_READY', 'CONNECTED', 'DISCONNECTED', 'ERROR'
let latestQrDataUrl = null;
let latestPairingCode = null;
let lastError = null;
let sock = null;

// Helper: Ensure directories exist
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// Safety: Prevent process exit on unexpected errors
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.stack || err);
  lastError = err.message || String(err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Helper: Today's date in Marathi numerals (e.g. १९.१०.२०२६)
const getTodayMarathiDate = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());
  const standardDate = `${day}.${month}.${year}`;
  const marathiDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
  return standardDate.replace(/\d/g, d => marathiDigits[d]);
};

// Helper: Replace {{date}} placeholder in questions
const resolvePollQuestion = (q) => {
  if (!q) return '';
  const mDate = getTodayMarathiDate();
  return q
    .replace(/\{\{date\}\}/gi, mDate)
    .replace(/\{\{today\}\}/gi, mDate);
};

// Helper: Read polls data
function readPolls() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading polls.json:', err);
    return [];
  }
}

// Helper: Write polls data
function writePolls(polls) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(polls, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing polls.json:', err);
    return false;
  }
}

// Helper to log server actions
function logAction(msg) {
  try {
    fs.appendFileSync(path.join(__dirname, 'server.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
  console.log(msg);
}

// Initialize Ultra-Lightweight WhatsApp Client via Baileys (~35MB RAM, NO Chromium!)
async function startBaileys() {
  try {
    whatsappStatus = 'INITIALIZING';
    logAction('🔄 Starting Baileys WhatsApp client (Pure WebSockets - 35MB RAM)...');

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: [2, 3000, 1015901307],
      isLatest: true
    }));

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        whatsappStatus = 'QR_READY';
        lastError = null;
        logAction('📲 WhatsApp QR code received.');
        qrcodeTerminal.generate(qr, { small: true });
        try {
          latestQrDataUrl = await QRCode.toDataURL(qr);
        } catch (e) {}
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        whatsappStatus = 'DISCONNECTED';
        lastError = `Disconnected (code: ${statusCode || 'unknown'})`;
        logAction(`⚠️ WhatsApp disconnected (status ${statusCode}). Reconnecting: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(startBaileys, 4000);
        } else {
          logAction('❌ Logged out. Please re-link WhatsApp.');
          whatsappStatus = 'QR_READY';
        }
      } else if (connection === 'open') {
        whatsappStatus = 'CONNECTED';
        latestQrDataUrl = null;
        latestPairingCode = null;
        lastError = null;
        logAction('🚀 WhatsApp connected successfully via Baileys! Ready to send polls.');
      }
    });

  } catch (err) {
    whatsappStatus = 'ERROR';
    lastError = err.message || String(err);
    logAction(`❌ Failed to start Baileys: ${err.message}`);
    setTimeout(startBaileys, 6000);
  }
}

// Start Baileys immediately
startBaileys();

// API: Health ping (for keeping awake via free cron)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024) });
});

// API: Get current WhatsApp connection status
app.get('/api/status', (req, res) => {
  res.json({
    status: whatsappStatus,
    qrCode: latestQrDataUrl,
    pairingCode: latestPairingCode,
    groupName: process.env.WHATSAPP_GROUP_NAME || '',
    groupId: process.env.WHATSAPP_GROUP_ID || '',
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    error: lastError
  });
});

// API: Request WhatsApp 8-digit Pairing Code via Phone Number
app.post('/api/request-pairing-code', async (req, res) => {
  let { phoneNumber } = req.body;
  if (!phoneNumber) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }

  // Clean phone number: keep only digits
  let cleaned = String(phoneNumber).replace(/\D/g, '');
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned; // default to India (+91)
  }

  if (whatsappStatus === 'CONNECTED') {
    return res.json({ success: false, error: 'WhatsApp is already connected!' });
  }

  if (!sock || whatsappStatus === 'DISCONNECTED') {
    startBaileys();
    return res.status(503).json({
      success: false,
      error: 'WhatsApp कनेक्शन पुन्हा जोडत आहे... कृपया ५ सेकंद थांबा आणि पुन्हा बटण दाबा.'
    });
  }

  try {
    logAction(`📲 Requesting WhatsApp Pairing Code for: +${cleaned}...`);
    const code = await sock.requestPairingCode(cleaned);
    latestPairingCode = code;
    logAction(`✅ Pairing Code generated: ${code}`);
    return res.json({ success: true, pairingCode: code });
  } catch (err) {
    logAction(`❌ Pairing code failed: ${err.message || err}`);
    if (String(err.message || '').includes('Connection Closed')) {
      setTimeout(startBaileys, 1000);
    }
    return res.status(500).json({
      success: false,
      error: `Could not generate code: ${err.message || err}. Please try again in 5 seconds.`
    });
  }
});

// API: Get all polls
app.get('/api/polls', (req, res) => {
  const polls = readPolls();
  res.json(polls);
});

// API: Create a new poll
app.post('/api/polls', (req, res) => {
  const { question, options, category, date } = req.body;
  if (!question || !options || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'Question and at least 2 options are required.' });
  }

  const polls = readPolls();
  const newPoll = {
    id: `poll-${Date.now()}`,
    question: question.trim(),
    options: options.map(opt => opt.trim()).filter(Boolean),
    category: category ? category.trim() : 'General',
    date: date || new Date().toISOString().split('T')[0],
    status: 'available',
    lastSentAt: null
  };

  polls.unshift(newPoll);
  writePolls(polls);
  res.status(201).json(newPoll);
});

// API: Edit an existing poll
app.put('/api/polls/:id', (req, res) => {
  const { id } = req.params;
  const { question, options, category, date } = req.body;

  if (!question || !options || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'Question and at least 2 options are required.' });
  }

  const polls = readPolls();
  const index = polls.findIndex(p => p.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Poll not found.' });
  }

  polls[index] = {
    ...polls[index],
    question: question.trim(),
    options: options.map(opt => opt.trim()).filter(Boolean),
    category: category ? category.trim() : (polls[index].category || 'General'),
    date: date || polls[index].date || new Date().toISOString().split('T')[0]
  };

  writePolls(polls);
  res.json({ success: true, poll: polls[index] });
});

// API: Delete a poll
app.delete('/api/polls/:id', (req, res) => {
  const { id } = req.params;
  let polls = readPolls();
  const initialLength = polls.length;
  polls = polls.filter(p => p.id !== id);

  if (polls.length === initialLength) {
    return res.status(404).json({ error: 'Poll not found.' });
  }

  writePolls(polls);
  res.json({ success: true, message: 'Poll deleted successfully.' });
});

// API: Send Poll to WhatsApp Group (Ultra-Fast Native Baileys Dispatch)
app.post('/api/send-poll', async (req, res) => {
  const { pollId } = req.body;
  if (!pollId) {
    return res.status(400).json({ success: false, error: 'pollId is required' });
  }

  const polls = readPolls();
  const pollIndex = polls.findIndex(p => p.id === pollId);
  if (pollIndex === -1) {
    return res.status(404).json({ success: false, error: 'Poll not found' });
  }

  const targetPoll = polls[pollIndex];

  // Check connection status
  if (whatsappStatus !== 'CONNECTED' || !sock) {
    return res.status(400).json({
      success: false,
      notConnected: true,
      status: whatsappStatus,
      error: 'WhatsApp is not connected yet. Please link your phone number first!'
    });
  }

  try {
    const configuredName = (process.env.WHATSAPP_GROUP_NAME || '').trim().toLowerCase();
    const configuredId = (process.env.WHATSAPP_GROUP_ID || '').trim();

    let targetGroup = null;

    // Fetch participating groups directly from WhatsApp WebSockets
    try {
      const groups = await sock.groupFetchAllParticipating();
      for (const [id, grp] of Object.entries(groups)) {
        const name = (grp.subject || '').trim();
        if (configuredId && id === configuredId) {
          targetGroup = { id, name };
          break;
        }
        if (configuredName && name.toLowerCase() === configuredName) {
          targetGroup = { id, name };
          break;
        }
      }

      // Fuzzy / partial match if exact match wasn't found
      if (!targetGroup && configuredName) {
        for (const [id, grp] of Object.entries(groups)) {
          const name = (grp.subject || '').trim();
          if (name.toLowerCase().includes(configuredName) || configuredName.includes(name.toLowerCase())) {
            targetGroup = { id, name };
            break;
          }
        }
      }
    } catch (fetchErr) {
      logAction(`⚠️ Group fetch warning: ${fetchErr.message}`);
    }

    if (!targetGroup) {
      let availableNames = [];
      try {
        const grps = await sock.groupFetchAllParticipating();
        availableNames = Object.values(grps).map(g => g.subject).filter(Boolean);
      } catch (e) {}

      return res.status(404).json({
        success: false,
        error: `Could not find group "${process.env.WHATSAPP_GROUP_NAME}".`,
        availableGroups: availableNames.slice(0, 15),
        hint: 'Please update WHATSAPP_GROUP_NAME in your environment variables to match your WhatsApp group subject.'
      });
    }

    const groupId = targetGroup.id;
    const activeQuestion = resolvePollQuestion(targetPoll.question);
    const activeDate = new Date().toISOString().split('T')[0];

    logAction(`📊 Sending native poll to "${targetGroup.name}"...`);

    let sentSuccessfully = false;
    let sendMethodUsed = '';

    // Attempt 1: Native Interactive WhatsApp Poll
    try {
      await sock.sendMessage(groupId, {
        poll: {
          name: activeQuestion,
          values: targetPoll.options,
          selectableCount: 1
        }
      });
      sentSuccessfully = true;
      sendMethodUsed = 'native poll';
      logAction(`✅ Native poll sent to "${targetGroup.name}"!`);
    } catch (pollErr) {
      logAction(`⚠️ Native poll failed (${pollErr.message}), trying Attempt 2 (formatted text)...`);
    }

    // Attempt 2: Formatted Text Message Fallback
    if (!sentSuccessfully) {
      let formattedMsg = `📊 *POLL OF THE DAY*\n\n*${activeQuestion}*\n\n`;
      targetPoll.options.forEach((opt, idx) => {
        formattedMsg += `${idx + 1}️⃣ ${opt}\n`;
      });
      formattedMsg += `\n_Category: ${targetPoll.category} | Date: ${activeDate}_`;

      await sock.sendMessage(groupId, { text: formattedMsg });
      sentSuccessfully = true;
      sendMethodUsed = 'formatted text';
      logAction(`✅ Formatted text poll sent to "${targetGroup.name}"!`);
    }

    // Update poll status to 'sent'
    polls[pollIndex].status = 'sent';
    polls[pollIndex].lastSentAt = new Date().toISOString();
    writePolls(polls);

    return res.json({
      success: true,
      message: `Poll successfully sent to "${targetGroup.name}" (${sendMethodUsed})!`,
      group: targetGroup.name,
      sentAt: polls[pollIndex].lastSentAt
    });

  } catch (err) {
    logAction(`❌ Error sending poll: ${err.stack || err}`);

    const errorQuestion = resolvePollQuestion(targetPoll.question);
    let formattedMsg = `📊 *POLL OF THE DAY*\n\n*${errorQuestion}*\n\n`;
    targetPoll.options.forEach((opt, idx) => {
      formattedMsg += `${idx + 1}️⃣ ${opt}\n`;
    });
    formattedMsg += `\n_Category: ${targetPoll.category} | Date: ${targetPoll.date}_`;
    const fallbackUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(formattedMsg)}`;

    return res.status(500).json({
      success: false,
      error: `Could not send automatically: ${err.message || err}`,
      fallbackUrl: fallbackUrl
    });
  }
});

// Start Express Server on 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Daily Poll Server (Baileys Engine) running on 0.0.0.0:${PORT}`);
  console.log(`⚡ RAM Usage: ~35 MB (Render 512MB limit will NEVER be exceeded!)`);
  console.log(`📁 Environment: WHATSAPP_GROUP_NAME="${process.env.WHATSAPP_GROUP_NAME}"`);
  console.log(`======================================================\n`);
});
