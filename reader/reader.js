// reader.js — PDF reader logic (extracted from inline for Chrome CSP compliance)

// ── Config ──
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

let settings = { host: 'http://localhost:11434', model: 'qwen2.5:14b' };
let fullDocText = '';
let cardCounter = 0;
const streamBuffers = {};
let currentSelection = '';
let currentRange = null;
let currentDepth = 0;
let savedBlock = null;

// Load settings from extension storage
chrome.storage.sync.get({ host: 'http://localhost:11434', model: 'qwen2.5:14b' }, (res) => {
  if (res) settings = res;
});

// Listen for stream chunks from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STREAM_CHUNK') handleChunk(msg);
  if (msg.type === 'STREAM_ERROR') handleError(msg);
});

// ── Load PDF ──
const params = new URLSearchParams(window.location.search);
const pdfUrl = params.get('pdf');

if (!pdfUrl) {
  document.getElementById('status-text').textContent = 'No PDF URL provided.';
} else {
  document.getElementById('pdf-title').textContent = decodeURIComponent(pdfUrl.split('/').pop());
  loadPDF(pdfUrl);
}

async function loadPDF(url) {
  setStatus('Fetching PDF…');
  try {
    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'FETCH_PDF', url }, resolve);
    });

    if (!result || !result.ok) {
      setStatus(`Failed to fetch PDF: ${result?.error || 'Unknown error'}`);
      return;
    }

    setStatus('Parsing PDF…');

    // Convert plain Array back to Uint8Array (Uint8Array doesn't survive Chrome messages)
    const uint8 = new Uint8Array(result.data);
    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
    const totalPages = pdf.numPages;
    document.getElementById('page-info').textContent = `${totalPages} pages`;

    const readerEl = document.getElementById('reader');
    readerEl.innerHTML = '';
    const allText = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      setStatus(`Reading page ${pageNum} of ${totalPages}…`);
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      // Group text items into lines by Y position
      const lines = [];
      let currentLine = [];
      let lastY = null;

      content.items.forEach(item => {
        if (!item.str.trim() && item.str !== ' ') return;
        const y = Math.round(item.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 5) {
          if (currentLine.length) lines.push(currentLine.join(''));
          currentLine = [];
        }
        currentLine.push(item.str);
        lastY = y;
      });
      if (currentLine.length) lines.push(currentLine.join(''));

      // Group lines into paragraphs
      const paragraphs = [];
      let curPara = [];
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) {
          if (curPara.length) { paragraphs.push(curPara.join(' ')); curPara = []; }
          return;
        }
        curPara.push(trimmed);
        const next = lines[i + 1]?.trim();
        if (next && /[a-z]$/.test(trimmed) === false && /^[A-Z0-9]/.test(next) && curPara.length > 1) {
          paragraphs.push(curPara.join(' '));
          curPara = [];
        }
      });
      if (curPara.length) paragraphs.push(curPara.join(' '));

      // Page divider
      if (pageNum > 1) {
        const div = document.createElement('div');
        div.className = 'page-divider';
        div.textContent = `PAGE ${pageNum}`;
        readerEl.appendChild(div);
      }

      // Render paragraphs
      paragraphs.forEach(para => {
        if (para.trim().length < 3) return;
        const block = document.createElement('div');
        block.className = 'pdf-page-block';

        const p = document.createElement('p');
        p.className = 'pdf-para';
        const isHeading = para.length < 120 && !/\.$/.test(para) &&
          (para === para.toUpperCase() || /^[A-Z][^a-z]{0,3}[A-Z]/.test(para));
        if (isHeading) p.classList.add('heading');
        p.textContent = para;
        block.appendChild(p);

        const nested = document.createElement('div');
        nested.className = 'deepread-nested-root';
        block.appendChild(nested);

        readerEl.appendChild(block);
        allText.push(para);
      });
    }

    fullDocText = allText.join('\n\n');

    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.innerHTML = 'Select any text to ask DeepRead — <span>full paper sent as context</span>';
    readerEl.appendChild(tip);

    document.getElementById('status').style.display = 'none';
    readerEl.style.display = 'block';

    initSelection();

  } catch (e) {
    setStatus(`Error loading PDF: ${e.message}`);
  }
}

function setStatus(text) {
  document.getElementById('status-text').textContent = text;
}

// ── Selection + bubble ──
function initSelection() {
  const bubble = document.getElementById('deepread-bubble');

  bubble.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleAsk();
  });

  document.addEventListener('mouseup', (e) => {
    if (e.target === bubble) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { hideBubble(); return; }
      const text = sel.toString().trim();
      if (text.length < 2) { hideBubble(); return; }

      currentSelection = text;
      try { currentRange = sel.getRangeAt(0).cloneRange(); } catch (e) { return; }

      let node = currentRange.startContainer;
      if (node.nodeType === 3) node = node.parentElement;

      currentDepth = 0;
      let p = node;
      while (p) {
        if (p.classList?.contains('deepread-card')) currentDepth++;
        p = p.parentElement;
      }

      savedBlock = findBlock(node, currentDepth);

      const rect = sel.getRangeAt(0).getBoundingClientRect();
      bubble.style.display = 'block';
      bubble.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - 70, window.innerWidth - 160)) + 'px';
      bubble.style.top = Math.max(8, rect.top - 44) + 'px';
    }, 10);
  });

  document.addEventListener('mousedown', (e) => {
    if (e.target === bubble) return;
    hideBubble();
  });
}

function hideBubble() {
  document.getElementById('deepread-bubble').style.display = 'none';
}

function findBlock(node, depth) {
  if (depth > 0) {
    let n = node;
    while (n) {
      if (n.classList?.contains('deepread-card')) return n;
      n = n.parentElement;
    }
  }
  let n = node;
  const blockTags = ['P', 'DIV', 'SECTION', 'BLOCKQUOTE', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
  while (n && n !== document.body) {
    if (blockTags.includes(n.tagName)) {
      const hasBlock = [...(n.children || [])].some(c => blockTags.includes(c.tagName));
      if (!hasBlock) return n;
    }
    n = n.parentElement;
  }
  return node;
}

function handleAsk() {
  if (!currentSelection || !currentRange || !savedBlock) return;
  hideBubble();

  try {
    const hl = document.createElement('mark');
    hl.className = 'deepread-hl';
    hl.textContent = currentSelection;
    currentRange.deleteContents();
    currentRange.insertNode(hl);
  } catch (e) {}

  window.getSelection()?.removeAllRanges();

  const wrapper = getOrCreateWrapper(savedBlock, currentDepth);
  createCard(currentSelection, wrapper, currentDepth + 1, fullDocText);
}

function getOrCreateWrapper(block, depth) {
  if (depth > 0) {
    let nested = block.querySelector(':scope > .deepread-nested');
    if (!nested) {
      nested = document.createElement('div');
      nested.className = 'deepread-nested';
      block.appendChild(nested);
    }
    return nested;
  }
  const next = block.nextElementSibling;
  if (next && next.classList.contains('deepread-wrapper')) return next;
  const wrapper = document.createElement('div');
  wrapper.className = 'deepread-wrapper';
  block.after(wrapper);
  return wrapper;
}

// ── Card ──
function createCard(question, container, depth, context) {
  const cardId = `dr-${++cardCounter}`;
  streamBuffers[cardId] = '';

  const depthClass = depth >= 3 ? 'depth-3' : depth === 2 ? 'depth-2' : '';
  const card = document.createElement('div');
  card.className = `deepread-card ${depthClass}`;
  card.dataset.cardId = cardId;

  card.innerHTML = `
    <div class="deepread-card-header">
      <div class="deepread-chip">Q${depth}</div>
      <div class="deepread-q">${esc(question)}</div>
      <button class="deepread-collapse">−</button>
    </div>
    <div class="deepread-body">
      <div class="deepread-dots"><span></span><span></span><span></span></div>
    </div>
    <div class="deepread-footer"></div>
    <div class="deepread-ask-row">
      <input class="deepread-ask-input" type="text" placeholder="Ask a follow-up…" />
      <button class="deepread-ask-btn">ask →</button>
    </div>
    <div class="deepread-nested"></div>
  `;

  container.appendChild(card);
  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30);

  card.querySelector('.deepread-collapse').addEventListener('click', () => {
    card.classList.toggle('collapsed');
    card.querySelector('.deepread-collapse').textContent = card.classList.contains('collapsed') ? '+' : '−';
  });

  const input = card.querySelector('.deepread-ask-input');
  const askBtn = card.querySelector('.deepread-ask-btn');
  const submit = () => {
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    createCard(q, card.querySelector(':scope > .deepread-nested'), depth + 1, fullDocText);
  };
  askBtn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

  streamCard(question, context, depth, cardId);
}

function streamCard(question, context, depth, cardId) {
  const system = `You are a research paper reading companion. The user selected something to understand better.

Answer in 2-4 focused paragraphs. Flowing prose, no bullet points. Don't restate the question. Be specific. Ground your answer in the paper. At depth 2-3, go more technical. End in a way that invites the next question.

Depth: ${depth}/3.`;

  const prompt = `${system}

FULL PAPER:
"""
${context.slice(0, 3000)}
"""

Reader wants to understand: "${question}"

Answer clearly:`;

  chrome.runtime.sendMessage({
    type: 'OLLAMA_STREAM',
    host: settings.host,
    model: settings.model,
    prompt,
    cardId
  });
}

function handleChunk({ cardId, text, done }) {
  streamBuffers[cardId] = (streamBuffers[cardId] || '') + text;
  const card = document.querySelector(`[data-card-id="${cardId}"]`);
  if (!card) return;
  const body = card.querySelector('.deepread-body');

  if (!done) {
    body.innerHTML = streamBuffers[cardId]
      .split(/\n{2,}/).filter(p => p.trim())
      .map(p => `<p>${esc(p.trim())}</p>`).join('')
      + '<span class="deepread-cursor"></span>';
  } else {
    const fullText = streamBuffers[cardId];
    body.innerHTML = fullText.split(/\n{2,}/).filter(p => p.trim())
      .map(p => `<p>${esc(p.trim())}</p>`).join('') || '<p style="color:#555">No response.</p>';

    const footer = card.querySelector('.deepread-footer');
    const d = parseInt(card.querySelector('.deepread-chip').textContent.replace('Q', ''));
    footer.style.display = 'flex';
    pickSuggestions().forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'deepread-sug';
      btn.textContent = s;
      btn.addEventListener('click', () => {
        btn.disabled = true;
        createCard(s, card.querySelector(':scope > .deepread-nested'), d + 1, fullDocText);
      });
      footer.appendChild(btn);
    });
    card.querySelector('.deepread-ask-row').style.display = 'flex';
  }
}

function handleError({ cardId, error }) {
  const card = document.querySelector(`[data-card-id="${cardId}"]`);
  if (!card) return;
  card.querySelector('.deepread-body').innerHTML =
    `<p style="color:#ff6655;font-size:12px;font-family:monospace">${esc(error)}</p>`;
}

const SUGS = [
  'Why is this significant?', 'Give me an intuitive example',
  "How does this connect to the paper's main contribution?",
  'What is the technical detail behind this?',
  'What are the limitations here?', 'Go deeper on this'
];
function pickSuggestions() {
  const i = Math.floor(Math.random() * (SUGS.length - 1));
  return [SUGS[i], SUGS[i + 1]];
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
