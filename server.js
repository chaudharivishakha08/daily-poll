const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Client, LocalAuth, Poll } = require('whatsapp-web.js');

// Load environment variables from .env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'polls.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// WhatsApp Client State Tracking
let whatsappStatus = 'INITIALIZING'; // 'INITIALIZING', 'QR_READY', 'AUTHENTICATED', 'CONNECTED', 'DISCONNECTED', 'ERROR'
let latestQrDataUrl = null;
let lastError = null;

// Initialize WhatsApp Web Client with persistent session
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(__dirname, '.wwebjs_auth')
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

// Event: QR Code generated
client.on('qr', async (qr) => {
  whatsappStatus = 'QR_READY';
  lastError = null;
  console.log('\n======================================================');
  console.log('📲 SCAN THIS QR CODE WITH WHATSAPP TO CONNECT:');
  console.log('======================================================\n');
  qrcodeTerminal.generate(qr, { small: true });

  try {
    latestQrDataUrl = await QRCode.toDataURL(qr);
  } catch (err) {
    console.error('Error generating QR data URL:', err);
  }
});

// Event: Authenticated successfully
client.on('authenticated', () => {
  whatsappStatus = 'AUTHENTICATED';
  console.log('✅ WhatsApp authenticated successfully!');
});

// Event: Client is ready to send messages
client.on('ready', () => {
  whatsappStatus = 'CONNECTED';
  latestQrDataUrl = null;
  lastError = null;
  console.log('🚀 WhatsApp Client is ready! You can now send polls to your group.');
});

// Event: Authentication failure
client.on('auth_failure', (msg) => {
  whatsappStatus = 'ERROR';
  lastError = `Authentication failed: ${msg}`;
  console.error('❌ WhatsApp Auth failure:', msg);
});

// Event: Disconnected
client.on('disconnected', (reason) => {
  whatsappStatus = 'DISCONNECTED';
  latestQrDataUrl = null;
  lastError = `Disconnected: ${reason}`;
  console.log('⚠️ WhatsApp Client disconnected:', reason);
});

// Initialize client asynchronously
client.initialize().catch((err) => {
  whatsappStatus = 'ERROR';
  lastError = err.message;
  console.error('Failed to initialize WhatsApp client:', err.message);
});

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

// API: Get current WhatsApp connection status
app.get('/api/status', (req, res) => {
  res.json({
    status: whatsappStatus,
    qrCode: latestQrDataUrl,
    groupName: process.env.WHATSAPP_GROUP_NAME || '',
    groupId: process.env.WHATSAPP_GROUP_ID || '',
    error: lastError
  });
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


// API: Send Poll to WhatsApp Group
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

  // Check if WhatsApp is connected
  if (whatsappStatus !== 'CONNECTED') {
    return res.status(400).json({
      success: false,
      notConnected: true,
      status: whatsappStatus,
      error: 'WhatsApp is not connected yet. Please scan the QR code first!'
    });
  }

  try {
    const configuredName = (process.env.WHATSAPP_GROUP_NAME || '').trim().toLowerCase();
    const configuredId = (process.env.WHATSAPP_GROUP_ID || '').trim();

    let targetGroup = null;

    // Fast, resilient lookup directly from WhatsApp Web memory (bypasses fragile getChats)
    try {
      targetGroup = await client.pupPage.evaluate((cfgId, cfgName) => {
        const chats = window.require('WAWebCollections').Chat.getModelsArray();
        for (const c of chats) {
          const id = c.id ? c.id._serialized : '';
          const name = (c.name || c.formattedTitle || '').trim();
          const isGrp = c.isGroup || (c.id && typeof c.id.isGroup === 'function' && c.id.isGroup()) || id.endsWith('@g.us');

          if (cfgId && id === cfgId) {
            return { id, name };
          }
          if (isGrp && cfgName && name.toLowerCase() === cfgName) {
            return { id, name };
          }
        }
        return null;
      }, configuredId, configuredName);
    } catch (e) {
      console.warn('Direct chat lookup warning:', e.message);
    }

    // Fallback: If direct memory lookup didn't find it, try client.getChats() safely
    if (!targetGroup) {
      try {
        const chats = await client.getChats();
        if (configuredId) {
          const found = chats.find(c => c.id && c.id._serialized === configuredId);
          if (found) targetGroup = { id: found.id._serialized, name: found.name };
        }
        if (!targetGroup && configuredName) {
          const found = chats.find(c => c.isGroup && c.name && c.name.trim().toLowerCase() === configuredName);
          if (found) targetGroup = { id: found.id._serialized, name: found.name };
        }
      } catch (getChatsErr) {
        console.warn('Fallback getChats warning:', getChatsErr.message || getChatsErr);
      }
    }

    if (!targetGroup) {
      let availableGroups = [];
      try {
        availableGroups = await client.pupPage.evaluate(() => {
          const chats = window.require('WAWebCollections').Chat.getModelsArray();
          return chats
            .filter(c => c.isGroup || (c.id && typeof c.id.isGroup === 'function' && c.id.isGroup()) || (c.id && c.id._serialized && c.id._serialized.endsWith('@g.us')))
            .map(c => c.name || c.formattedTitle)
            .filter(Boolean);
        });
      } catch (e) {}

      return res.status(404).json({
        success: false,
        error: `Could not find group "${process.env.WHATSAPP_GROUP_NAME}".`,
        availableGroups: availableGroups.slice(0, 15),
        hint: 'Please update WHATSAPP_GROUP_NAME in your .env file with one of your existing group names.'
      });
    }

    const groupId = targetGroup.id;

    // Helper to log to server.log
    const logAction = (msg) => {
      try {
        fs.appendFileSync(path.join(__dirname, 'server.log'), `[${new Date().toISOString()}] ${msg}\n`);
      } catch (e) {}
      console.log(msg);
    };

    // Optional: Pre-focus the chat window
    try {
      if (client.interface && typeof client.interface.openChatWindow === 'function') {
        await client.interface.openChatWindow(groupId);
        await new Promise(r => setTimeout(r, 600));
      }
    } catch (openErr) {
      logAction(`Could not pre-open chat window (safe to ignore): ${openErr.message || openErr}`);
    }

    // Helper to get today's date in Marathi numerals (e.g. १९.१०.२०२६)
    const getTodayMarathiDate = () => {
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = String(now.getFullYear());
      const standardDate = `${day}.${month}.${year}`;
      const marathiDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
      return standardDate.replace(/\d/g, d => marathiDigits[d]);
    };

    const resolvePollQuestion = (q) => {
      if (!q) return '';
      const mDate = getTodayMarathiDate();
      return q
        .replace(/\{\{date\}\}/gi, mDate)
        .replace(/\{\{today\}\}/gi, mDate);
    };

    const activeQuestion = resolvePollQuestion(targetPoll.question);
    const activeDate = new Date().toISOString().split('T')[0];

    let sentSuccessfully = false;
    let sendMethodUsed = '';

    // Attempt 1: Send Native WhatsApp Poll
    try {
      logAction(`Attempt 1: Sending native poll to "${targetGroup.name}" with question: "${activeQuestion.substring(0, 50)}..."`);
      const pollPayload = new Poll(activeQuestion, targetPoll.options);
      await client.sendMessage(groupId, pollPayload, { sendSeen: false });
      sentSuccessfully = true;
      sendMethodUsed = 'native poll';
      logAction(`✅ Sent native poll to "${targetGroup.name}"!`);
    } catch (pollErr) {
      logAction(`⚠️ Native poll failed (${pollErr.message || pollErr}), trying Attempt 2 (API formatted text)...`);
    }

    // Prepare formatted text message
    let formattedMsg = `📊 *POLL OF THE DAY*\n\n*${activeQuestion}*\n\n`;
    targetPoll.options.forEach((opt, idx) => {
      formattedMsg += `${idx + 1}️⃣ ${opt}\n`;
    });
    formattedMsg += `\n_Category: ${targetPoll.category} | Date: ${activeDate}_`;

    // Attempt 2: Fallback to Formatted Text via Client API
    if (!sentSuccessfully) {
      try {
        logAction(`Attempt 2: Sending text poll to "${targetGroup.name}"...`);
        await client.sendMessage(groupId, formattedMsg, { sendSeen: false });
        sentSuccessfully = true;
        sendMethodUsed = 'formatted text';
        logAction(`✅ Sent formatted text poll to "${targetGroup.name}" via API!`);
      } catch (textErr) {
        logAction(`⚠️ API text failed (${textErr.message || textErr}), switching to Attempt 3 (Direct UI typing)...`);
      }
    }

    // Attempt 3: Direct UI typing via Puppeteer DOM (bypasses any broken internal Store/modules)
    if (!sentSuccessfully && client.pupPage) {
      try {
        logAction(`Attempt 3: Sending via direct WhatsApp Web UI to "${targetGroup.name}"...`);
        await sendViaUI(client.pupPage, targetGroup.name, formattedMsg, logAction);
        sentSuccessfully = true;
        sendMethodUsed = 'direct UI typing';
        logAction(`✅ Sent formatted text poll to "${targetGroup.name}" via Direct UI typing!`);
      } catch (uiErr) {
        logAction(`❌ Attempt 3 UI send failed: ${uiErr.message || uiErr}`);
        throw uiErr;
      }
    }

    if (!sentSuccessfully) {
      throw new Error('All automated send attempts failed.');
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
    console.error('Error sending poll to WhatsApp:', err);
    try {
      fs.appendFileSync(path.join(__dirname, 'server.log'), `[${new Date().toISOString()}] ERROR: ${err.stack || err}\n`);
    } catch (e) {}

    const errorQuestion = resolvePollQuestion ? resolvePollQuestion(targetPoll.question) : targetPoll.question;
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

// Helper: Direct UI typing via Puppeteer page (100% resilient against WA internal changes)
async function sendViaUI(pupPage, targetName, text, logFn) {
  // 1. Search or click the group in the chat list
  const opened = await pupPage.evaluate((name) => {
    const currentHeader = document.querySelector('header span[title]');
    if (currentHeader && currentHeader.title.trim().toLowerCase() === name.trim().toLowerCase()) {
      return true;
    }
    const spans = Array.from(document.querySelectorAll('#pane-side span[title]'));
    const match = spans.find(s => s.title && s.title.trim().toLowerCase() === name.trim().toLowerCase());
    if (match) {
      const item = match.closest('div[role="listitem"], div[data-testid="cell-frame-container"]') || match;
      item.click();
      return true;
    }
    return false;
  }, targetName);

  if (!opened) {
    // Search using WhatsApp search bar
    logFn && logFn(`Searching chat list for "${targetName}"...`);
    await pupPage.evaluate((name) => {
      const searchBox = document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
                        document.querySelector('#side div[contenteditable="true"]');
      if (searchBox) {
        searchBox.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, name);
      }
    }, targetName);

    await new Promise(r => setTimeout(r, 1200));

    await pupPage.evaluate(() => {
      const first = document.querySelector('#pane-side div[role="listitem"]');
      if (first) first.click();
    });
  }

  // Wait 1 second for chat to load
  await new Promise(r => setTimeout(r, 1000));

  // Find message input box
  const inputSelector = 'footer div[contenteditable="true"]';
  await pupPage.waitForSelector(inputSelector, { timeout: 8000 });
  await pupPage.focus(inputSelector);

  // Insert message text
  await pupPage.evaluate((msg) => {
    const input = document.querySelector('footer div[contenteditable="true"]');
    if (!input) throw new Error('WhatsApp message input box not found');
    input.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, msg);
  }, text);

  await new Promise(r => setTimeout(r, 400));

  // Press Enter key to send
  await pupPage.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 600));
}

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Daily Poll Server is running at http://localhost:${PORT}`);
  console.log(`📁 Environment: WHATSAPP_GROUP_NAME="${process.env.WHATSAPP_GROUP_NAME}"`);
  console.log(`======================================================\n`);
});
