// popup.js

const hostEl   = document.getElementById('host');
const modelEl  = document.getElementById('model');
const msgEl    = document.getElementById('msg');
const dot      = document.getElementById('dot');
const checkBtn = document.getElementById('checkBtn');
const saveBtn  = document.getElementById('saveBtn');
const modelsWrap = document.getElementById('models-wrap');
const modelsList = document.getElementById('modelsList');

// Load saved settings
chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
  if (res) {
    hostEl.value  = res.host  || 'http://localhost:11434';
    modelEl.value = res.model || 'qwen2.5:14b';
  }
});

// Test connection
checkBtn.addEventListener('click', async () => {
  const host  = hostEl.value.trim().replace(/\/$/, '');
  const model = modelEl.value.trim();

  dot.className = 'status-dot checking';
  msg('checking…', '');

  const res = await chrome.runtime.sendMessage({ type: 'OLLAMA_CHECK', host, model });

  if (res.ok) {
    dot.className = 'status-dot online';
    msg(`✓ ${res.model} ready`, 'ok');

    // Show available models
    if (res.models && res.models.length) {
      modelsWrap.style.display = 'block';
      modelsList.innerHTML = '';
      res.models.forEach(m => {
        const chip = document.createElement('span');
        chip.textContent = m;
        chip.addEventListener('click', () => {
          modelEl.value = m;
          msg(`Selected: ${m}`, 'ok');
        });
        modelsList.appendChild(chip);
      });
    }
  } else {
    dot.className = 'status-dot error';
    msg(res.error, 'err');
    modelsWrap.style.display = 'none';
  }
});

// Save settings
saveBtn.addEventListener('click', async () => {
  const host  = hostEl.value.trim().replace(/\/$/, '');
  const model = modelEl.value.trim();

  if (!host || !model) { msg('Host and model are required', 'err'); return; }

  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', host, model });

  // Notify all active tabs so content.js picks up new settings live
  const tabs = await chrome.tabs.query({ active: true });
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', host, model }).catch(() => {});
  });

  msg('✓ Saved', 'ok');
  setTimeout(() => msg('', ''), 1500);
});

// Open PDF reader
document.getElementById('openPdfBtn').addEventListener('click', () => {
  const url = document.getElementById('pdf-url').value.trim();
  if (!url) { msg('Paste a PDF URL first', 'err'); return; }
  chrome.runtime.sendMessage({ type: 'OPEN_PDF_READER', url });
  window.close();
});

function msg(text, type) {
  msgEl.textContent = text;
  msgEl.className = `msg ${type}`;
}
