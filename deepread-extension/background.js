// background.js — service worker
// Handles Ollama API calls + PDF fetching (both bypass CORS from here)

// Store full document text per tab: tabId -> fullText
const tabContexts = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'OLLAMA_STREAM') {
    handleOllamaStream(message, sender.tab.id);
    return false;
  }

  if (message.type === 'OLLAMA_CHECK') {
    checkOllama(message.host, message.model).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    chrome.storage.sync.get({ host: 'http://localhost:11434', model: 'qwen2.5:14b' }, sendResponse);
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.sync.set({ host: message.host, model: message.model }, () => sendResponse({ ok: true }));
    return true;
  }

  // Store full page/PDF text from content script
  if (message.type === 'STORE_CONTEXT') {
    tabContexts[sender.tab.id] = message.text;
    sendResponse({ ok: true });
    return true;
  }

  // Fetch PDF bytes from background (no CORS issues here)
  if (message.type === 'FETCH_PDF') {
    fetchPDF(message.url).then(sendResponse);
    return true;
  }

  // Save a note
  if (message.type === 'SAVE_NOTE') {
    chrome.storage.local.get({ notes: [] }, (data) => {
      const notes = [message.note, ...(data.notes || [])];
      chrome.storage.local.set({ notes }, () => {
        console.log('[DeepRead] Note saved. Total notes:', notes.length);
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  // Get all notes
  if (message.type === 'GET_NOTES') {
    chrome.storage.local.get({ notes: [] }, (data) => sendResponse(data.notes));
    return true;
  }

  // Delete a note
  if (message.type === 'DELETE_NOTE') {
    chrome.storage.local.get({ notes: [] }, (data) => {
      const notes = data.notes.filter(n => n.id !== message.id);
      chrome.storage.local.set({ notes }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  // Open notes viewer
  if (message.type === 'OPEN_NOTES') {
    const url = chrome.runtime.getURL('notes/notes.html');
    // tabs.query doesn't work with chrome-extension:// URLs, just create new tab
    chrome.tabs.create({ url });
    sendResponse({ ok: true });
    return true;
  }

  // Open PDF in our reader tab
  if (message.type === 'OPEN_PDF_READER') {
    const readerUrl = chrome.runtime.getURL('reader/reader.html') + '?pdf=' + encodeURIComponent(message.url);
    chrome.tabs.create({ url: readerUrl });
    sendResponse({ ok: true });
    return true;
  }
});

async function checkOllama(host, model) {
  try {
    const res = await fetch(`${host}/api/tags`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    const found = models.find(m => m.startsWith(model));
    if (!found) return { ok: false, error: `Model not found. Available: ${models.join(', ') || 'none'}` };
    return { ok: true, model: found, models };
  } catch (e) {
    return { ok: false, error: `Cannot reach Ollama at ${host}. Run: OLLAMA_ORIGINS=* ollama serve` };
  }
}

async function fetchPDF(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buffer = await res.arrayBuffer();
    // Uint8Array doesn't survive Chrome message passing — convert to plain Array
    return { ok: true, data: Array.from(new Uint8Array(buffer)) };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

async function handleOllamaStream(message, tabId) {
  const { host, model, prompt, cardId } = message;

  const sendChunk = (text, done = false) => {
    chrome.tabs.sendMessage(tabId, { type: 'STREAM_CHUNK', cardId, text, done });
  };
  const sendError = (error) => {
    chrome.tabs.sendMessage(tabId, { type: 'STREAM_ERROR', cardId, error });
  };

  try {
    const res = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: true, options: { num_predict: 300 } })
    });

    if (!res.ok) { sendError(`Ollama returned HTTP ${res.status}`); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.response) sendChunk(json.response);
          if (json.done) { sendChunk('', true); return; }
        } catch (e) {}
      }
    }
    sendChunk('', true);
  } catch (e) {
    sendError(e.message);
  }
}
