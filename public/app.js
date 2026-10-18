// App State
let allPolls = [];
let currentStatus = { status: 'INITIALIZING', qrCode: null, groupName: '' };
let statusPollingInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  fetchStatus();
  fetchPolls();

  // Poll status every 4 seconds to detect when user scans QR
  statusPollingInterval = setInterval(fetchStatus, 4000);
});

// Switch Tabs
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });
}

// Fetch WhatsApp Status & Group Name from Backend
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Status endpoint unavailable');
    const data = await res.json();
    currentStatus = data;
    renderStatus(data);
  } catch (err) {
    // If backend is not running, show friendly fallback
    renderStatusFallback();
  }
}

// Render Status Indicator and QR Code
function renderStatus(data) {
  const statusBadge = document.getElementById('statusBadge');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const displayGroupName = document.getElementById('displayGroupName');
  const qrImage = document.getElementById('qrImage');
  const qrLoading = document.getElementById('qrLoading');

  // Update target group display
  if (data.groupName) {
    displayGroupName.textContent = data.groupName;
  } else {
    displayGroupName.textContent = 'Not set in .env';
  }

  // Update Status Badge UI
  if (data.status === 'CONNECTED') {
    statusDot.className = 'status-dot dot-green';
    statusText.textContent = 'WhatsApp Connected';
    closeQrModal();
  } else if (data.status === 'QR_READY') {
    statusDot.className = 'status-dot dot-yellow';
    statusText.textContent = data.pairingCode ? 'Pairing Code Ready' : 'Link WhatsApp';
    if (data.pairingCode) {
      renderPairingCode(data.pairingCode);
    }
    if (data.qrCode) {
      qrImage.src = data.qrCode;
      qrImage.style.display = 'block';
      qrLoading.style.display = 'none';
    }
  } else if (data.status === 'AUTHENTICATED') {
    statusDot.className = 'status-dot dot-yellow';
    statusText.textContent = 'WhatsApp Authenticated...';
  } else if (data.status === 'ERROR') {
    statusDot.className = 'status-dot dot-red';
    statusText.textContent = 'WhatsApp Error';
  } else {
    statusDot.className = 'status-dot dot-yellow';
    statusText.textContent = 'Initializing WhatsApp...';
  }
}

// Fallback status if running statically without Node.js backend
function renderStatusFallback() {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const displayGroupName = document.getElementById('displayGroupName');

  statusDot.className = 'status-dot dot-yellow';
  statusText.textContent = 'Backend Offline';
  displayGroupName.textContent = 'Yuva Varg (via WhatsApp Web)';
}

// Fetch Polls
async function fetchPolls() {
  try {
    const res = await fetch('/api/polls');
    if (!res.ok) throw new Error('API failed');
    allPolls = await res.json();
  } catch (err) {
    // Attempt local relative fetch for static viewing
    try {
      const fallbackRes = await fetch('../data/polls.json');
      allPolls = await fallbackRes.json();
    } catch (e) {
      console.error('Failed to load polls:', e);
      allPolls = [];
    }
  }
  renderPolls();
}

// Render Polls into Daily Polls and Sent History tabs
function renderPolls() {
  const availableContainer = document.getElementById('availablePollsGrid');
  const sentContainer = document.getElementById('sentPollsGrid');
  const availableCount = document.getElementById('availableCount');
  const sentCount = document.getElementById('sentCount');

  // Daily Polls tab displays all active polls so they are always accessible every day
  const dailyPolls = allPolls;
  const sentPolls = allPolls.filter(p => p.lastSentAt);

  availableCount.textContent = dailyPolls.length;
  sentCount.textContent = sentPolls.length;

  // Render Daily Polls
  if (dailyPolls.length === 0) {
    availableContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <h3>No Polls Found</h3>
        <p>You can create a new poll in the "Create Poll" tab.</p>
      </div>
    `;
  } else {
    availableContainer.innerHTML = dailyPolls.map(poll => createPollCardHtml(poll, !!poll.lastSentAt)).join('');
  }

  // Render Sent History
  if (sentPolls.length === 0) {
    sentContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>No Sent Polls Yet</h3>
        <p>Polls sent to your WhatsApp group will appear here.</p>
      </div>
    `;
  } else {
    sentContainer.innerHTML = sentPolls.map(poll => createPollCardHtml(poll, true)).join('');
  }
}

// Helper to get today's date in Marathi numerals (e.g. १९.१०.२०२६)
function getTodayMarathiDate() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());
  const standardDate = `${day}.${month}.${year}`;
  const marathiDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
  return standardDate.replace(/\d/g, d => marathiDigits[d]);
}

// Helper to replace {{date}} or {{today}} placeholder with current Marathi date
function formatPollQuestion(q) {
  if (!q) return '';
  const mDate = getTodayMarathiDate();
  return q
    .replace(/\{\{date\}\}/gi, mDate)
    .replace(/\{\{today\}\}/gi, mDate);
}

// Create Card HTML for a Poll
function createPollCardHtml(poll, isSent) {
  const optionsHtml = poll.options
    .map(opt => `
      <li class="poll-option-item">
        <span class="option-bullet"></span>
        <span>${escapeHtml(opt)}</span>
      </li>
    `)
    .join('');

  const formattedDate = poll.date || 'Today';
  const sentMeta = isSent && poll.lastSentAt 
    ? `<div class="sent-info">✅ Sent on ${new Date(poll.lastSentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</div>` 
    : '';

  return `
    <article class="poll-card" id="card-${poll.id}">
      <div>
        <div class="poll-top-meta">
          <span class="tag-category">${escapeHtml(poll.category || 'General')}</span>
          <span class="tag-date">${formattedDate}</span>
        </div>
        <h3 class="poll-question">${escapeHtml(formatPollQuestion(poll.question))}</h3>
        <ul class="poll-options-list">
          ${optionsHtml}
        </ul>
      </div>

      <div class="poll-footer-container">
        ${sentMeta}
        <div class="poll-card-actions">
          <button class="btn-edit-poll" onclick="openEditModal('${poll.id}')" title="Edit Poll">
            ✏️ Edit
          </button>
          <button 
            class="btn-send-poll ${isSent ? 'btn-resend' : ''}" 
            id="btn-${poll.id}"
            onclick="handleSendPoll('${poll.id}')"
          >
            <span>📲</span>
            <span>${isSent ? 'Re-send' : 'Send Poll'}</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

// Send Poll Action
async function handleSendPoll(pollId) {
  const poll = allPolls.find(p => p.id === pollId);
  if (!poll) return;

  const btn = document.getElementById(`btn-${pollId}`);
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span>⏳</span> <span>Sending to WhatsApp...</span>`;

  try {
    const response = await fetch('/api/send-poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollId })
    });

    const result = await response.json();

    if (result.success) {
      showToast(`✅ ${result.message}`, 'success');
      await fetchPolls();
    } else if (result.notConnected) {
      showToast('⚠️ WhatsApp is not linked yet. Scan the QR code!', 'error');
      showQrModal();
      btn.disabled = false;
      btn.innerHTML = originalText;
    } else {
      showToast(`❌ ${result.error || 'Failed to send poll.'}`, 'error');
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  } catch (err) {
    // Fallback: If backend is not running, open WhatsApp Web directly with pre-formatted message
    console.warn('Backend unavailable, triggering WhatsApp Web fallback:', err);
    triggerWhatsAppWebFallback(poll);
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Fallback: Direct WhatsApp Web link if backend is offline
function triggerWhatsAppWebFallback(poll) {
  let msg = `📊 *POLL OF THE DAY*\n\n*${formatPollQuestion(poll.question)}*\n\n`;
  poll.options.forEach((opt, idx) => {
    msg += `${idx + 1}️⃣ ${opt}\n`;
  });
  msg += `\n_Category: ${poll.category} | Date: ${poll.date}_`;

  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
  window.open(waUrl, '_blank');
  showToast('Opened WhatsApp with formatted poll!', 'success');
}

// Create New Poll Form Handler
async function handleCreatePoll(event) {
  event.preventDefault();
  const category = document.getElementById('pollCategory').value.trim();
  const question = document.getElementById('pollQuestion').value.trim();
  const optionInputs = document.querySelectorAll('#optionsContainer .option-input');
  const options = Array.from(optionInputs)
    .map(input => input.value.trim())
    .filter(Boolean);

  if (options.length < 2) {
    showToast('Please provide at least 2 options for the poll.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/polls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, question, options })
    });

    if (res.ok) {
      showToast('🎉 New poll added to collection!', 'success');
      document.getElementById('createPollForm').reset();
      await fetchPolls();
      switchTab('available');
    } else {
      showToast('Failed to save poll.', 'error');
    }
  } catch (err) {
    showToast('Failed to save poll: Server offline.', 'error');
  }
}

// Dynamic Option Input Field
function addOptionField() {
  const container = document.getElementById('optionsContainer');
  const count = container.children.length + 1;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'option-input';
  input.placeholder = `Option ${count}`;
  input.required = true;
  container.appendChild(input);
}

// Edit Poll Modal Controls
function openEditModal(pollId) {
  const poll = allPolls.find(p => p.id === pollId);
  if (!poll) return;

  document.getElementById('editPollId').value = poll.id;
  document.getElementById('editPollCategory').value = poll.category || '';
  document.getElementById('editPollDate').value = poll.date || new Date().toISOString().split('T')[0];
  document.getElementById('editPollQuestion').value = poll.question || '';

  const optionsContainer = document.getElementById('editOptionsContainer');
  optionsContainer.innerHTML = '';
  (poll.options || []).forEach(opt => {
    addEditOptionRow(opt);
  });

  document.getElementById('editModal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('open');
}

function addEditOptionRow(val = '') {
  const container = document.getElementById('editOptionsContainer');
  const count = container.children.length + 1;
  const row = document.createElement('div');
  row.className = 'edit-option-row';
  row.innerHTML = `
    <input type="text" class="option-input" placeholder="Option ${count}" value="${escapeHtml(val)}" required>
    <button type="button" class="btn-remove-option" onclick="removeEditOptionRow(this)" title="Remove option">&times;</button>
  `;
  container.appendChild(row);
}

function removeEditOptionRow(btn) {
  const container = document.getElementById('editOptionsContainer');
  if (container.children.length <= 2) {
    showToast('A poll must have at least 2 options.', 'error');
    return;
  }
  btn.closest('.edit-option-row').remove();
}

async function handleSaveEditedPoll(event) {
  event.preventDefault();
  const pollId = document.getElementById('editPollId').value;
  const category = document.getElementById('editPollCategory').value.trim();
  const date = document.getElementById('editPollDate').value;
  const question = document.getElementById('editPollQuestion').value.trim();

  const optionInputs = document.querySelectorAll('#editOptionsContainer .option-input');
  const options = Array.from(optionInputs).map(inp => inp.value.trim()).filter(Boolean);

  if (options.length < 2) {
    showToast('Please provide at least 2 options.', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/polls/${pollId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, date, question, options })
    });

    const result = await res.json();
    if (result.success) {
      showToast('✅ Poll updated successfully!', 'success');
      closeEditModal();
      await fetchPolls();
    } else {
      showToast(`❌ ${result.error || 'Failed to update poll.'}`, 'error');
    }
  } catch (err) {
    showToast('Failed to update poll: Server offline.', 'error');
  }
}

async function handleDeletePoll() {
  const pollId = document.getElementById('editPollId').value;
  if (!pollId) return;

  if (!confirm('Are you sure you want to delete this poll?')) {
    return;
  }

  try {
    const res = await fetch(`/api/polls/${pollId}`, {
      method: 'DELETE'
    });
    const result = await res.json();
    if (result.success) {
      showToast('🗑️ Poll deleted successfully.', 'success');
      closeEditModal();
      await fetchPolls();
    } else {
      showToast(`❌ ${result.error || 'Failed to delete poll.'}`, 'error');
    }
  } catch (err) {
    showToast('Failed to delete poll: Server offline.', 'error');
  }
}

// QR Code Modal Controls
function showQrModal() {
  document.getElementById('qrModal').classList.add('open');
}

function closeQrModal() {
  document.getElementById('qrModal').classList.remove('open');
}

// Refresh Data manually
function refreshData() {
  fetchStatus();
  fetchPolls();
  showToast('Refreshed data!', 'success');
}

// Toast Notification
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

// Helper: Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ==========================================================================
   PWA Installation & Mobile Support
   ========================================================================== */

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('ServiceWorker registration error:', err);
    });
  });
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('btnInstallApp');
  if (btn) btn.style.display = 'flex';
});

async function triggerInstallApp() {
  if (!deferredInstallPrompt) {
    showToast('To install: Open browser menu (⋮) > Add to Home screen', 'info');
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice && choice.outcome === 'accepted') {
    showToast('🎉 Daily Poll app installed successfully!', 'success');
    const btn = document.getElementById('btnInstallApp');
    if (btn) btn.style.display = 'none';
  }
  deferredInstallPrompt = null;
}

/* ==========================================================================
   Phone Number Pairing Code Handlers
   ========================================================================== */

function switchPairingMethod(method) {
  const isCode = method === 'code';
  const tabBtnPairing = document.getElementById('tabBtnPairing');
  const tabBtnQr = document.getElementById('tabBtnQr');
  const phoneContainer = document.getElementById('methodPhoneContainer');
  const qrContainer = document.getElementById('methodQrContainer');

  if (tabBtnPairing) tabBtnPairing.classList.toggle('active', isCode);
  if (tabBtnQr) tabBtnQr.classList.toggle('active', !isCode);
  if (phoneContainer) phoneContainer.style.display = isCode ? 'block' : 'none';
  if (qrContainer) qrContainer.style.display = isCode ? 'none' : 'block';
}

async function handleRequestPairingCode(event) {
  event.preventDefault();
  const phoneInput = document.getElementById('pairingPhoneInput');
  const btn = document.getElementById('btnGetPairingCode');
  const phoneNumber = phoneInput.value.trim();

  if (!phoneNumber || phoneNumber.length < 10) {
    showToast('कृपया वैध 10-अंकी मोबाईल नंबर टाका', 'error');
    return;
  }

  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'कोड मिळवत आहे...';

  try {
    const res = await fetch('/api/request-pairing-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber })
    });
    const data = await res.json();

    if (data.success && data.pairingCode) {
      renderPairingCode(data.pairingCode);
      showToast('✅ व्हॉट्सॲप कोड तयार झाला!', 'success');
    } else {
      showToast(`❌ ${data.error || 'Failed to get pairing code'}`, 'error');
    }
  } catch (err) {
    showToast('सर्व्हरशी संपर्क होऊ शकला नाही: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function renderPairingCode(code) {
  const box = document.getElementById('pairingCodeDisplayBox');
  const val = document.getElementById('pairingCodeValue');
  if (!box || !val) return;

  // Format code (e.g. ABCD-1234 or ABCD 1234)
  let formatted = String(code).trim();
  if (formatted.length === 8 && !formatted.includes('-') && !formatted.includes(' ')) {
    formatted = `${formatted.substring(0, 4)} - ${formatted.substring(4)}`;
  }
  val.textContent = formatted;
  box.style.display = 'block';
}

function copyPairingCode() {
  const valEl = document.getElementById('pairingCodeValue');
  if (!valEl) return;
  const rawCode = valEl.textContent.replace(/[\s-]/g, '');
  if (!rawCode) return;

  navigator.clipboard.writeText(rawCode).then(() => {
    showToast('📋 कोड कॉपी झाला! व्हॉट्सॲपमध्ये पेस्ट करा.', 'success');
  }).catch(() => {
    showToast('Copy failed, please enter the code manually.', 'error');
  });
}

