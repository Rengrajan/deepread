// content.js — injected into every page

(() => {
  // ── State ──
  let currentSelection = '';
  let currentRange = null;
  let currentDepth = 0;
  let savedParaBlock = null; // the element right before where we'll insert
  let settings = { host: 'http://localhost:11434', model: 'qwen2.5:14b' };
  let cardCounter = 0;
  const streamBuffers = {}; // cardId -> accumulated text

  // Load settings
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
    if (res) settings = res;
  });

  // Listen for settings updates from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SETTINGS_UPDATED') settings = { host: msg.host, model: msg.model };
    if (msg.type === 'STREAM_CHUNK') handleChunk(msg);
    if (msg.type === 'STREAM_ERROR') handleError(msg);
  });

  // ── Bubble ──
  const bubble = document.createElement('div');
  bubble.id = 'deepread-bubble';
  bubble.textContent = 'Ask DeepRead';
  document.body.appendChild(bubble);

  bubble.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleAsk();
  });

  // ── Selection detection ──
  document.addEventListener('mouseup', (e) => {
    if (e.target === bubble) return;

    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { hideBubble(); return; }
      const text = sel.toString().trim();
      if (text.length < 2) { hideBubble(); return; }

      currentSelection = text;
      try { currentRange = sel.getRangeAt(0).cloneRange(); } catch(e) { return; }

      // ── Save parent block BEFORE any DOM changes ──
      let node = currentRange.startContainer;
      if (node.nodeType === 3) node = node.parentElement; // text node → element

      // Find depth (how many deepread-cards deep are we?)
      currentDepth = 0;
      let p = node;
      while (p) {
        if (p.classList?.contains('deepread-card')) currentDepth++;
        p = p.parentElement;
      }

      // Find the block element to insert after
      // Walk up until we hit a block-level element that's a direct child of the page content
      savedParaBlock = findBlockAncestor(node, currentDepth);

      // Position bubble above selection
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

  function hideBubble() {
    bubble.style.display = 'none';
  }

  // ── Find where to insert the card ──
  function findBlockAncestor(node, depth) {
    if (depth > 0) {
      // Inside an answer card — find that card
      let n = node;
      while (n) {
        if (n.classList?.contains('deepread-card')) return n;
        n = n.parentElement;
      }
    }

    // Top-level: find the nearest block element
    // Walk up until we find something that's a direct child of a content container
    let n = node;
    const blockTags = ['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI', 'H1','H2','H3','H4','H5','H6'];
    while (n && n !== document.body) {
      if (blockTags.includes(n.tagName) && n.parentElement && n.parentElement !== document.body) {
        // Make sure this element doesn't contain other block elements (i.e. it's leaf-ish)
        const hasBlockChildren = [...n.children].some(c => blockTags.includes(c.tagName));
        if (!hasBlockChildren) return n;
      }
      n = n.parentElement;
    }
    return node;
  }

  // ── Handle Ask ──
  function handleAsk() {
    if (!currentSelection || !currentRange || !savedParaBlock) return;
    hideBubble();

    // Highlight the selection
    try {
      const hl = document.createElement('mark');
      hl.className = 'deepread-hl';
      hl.textContent = currentSelection;
      currentRange.deleteContents();
      currentRange.insertNode(hl);
    } catch(e) {}

    window.getSelection()?.removeAllRanges();

    // Find or create the wrapper div that sits right after the block
    const wrapper = getOrCreateWrapper(savedParaBlock, currentDepth);
    const context = getPageContext();
    createCard(currentSelection, wrapper, currentDepth + 1, context);
  }

  function getOrCreateWrapper(block, depth) {
    if (depth > 0) {
      // Inserting inside an answer card
      let nested = block.querySelector(':scope > .deepread-nested');
      if (!nested) {
        nested = document.createElement('div');
        nested.className = 'deepread-nested';
        block.appendChild(nested);
      }
      return nested;
    }

    // Check if next sibling is already our wrapper
    let next = block.nextElementSibling;
    if (next && next.classList.contains('deepread-wrapper')) return next;

    // Create wrapper and insert after block
    const wrapper = document.createElement('div');
    wrapper.className = 'deepread-wrapper';
    block.after(wrapper);
    return wrapper;
  }

  function getPageContext() {
    // Grab as much meaningful text as possible — full article/main content
    const selectors = [
      'article', 'main', '[role="main"]',
      '.post-content', '.article-body', '.entry-content',
      '.content', '#content', '.story-body',
      '.post', '.blog-post', '.page-content'
    ];
    let el = null;
    for (const s of selectors) {
      el = document.querySelector(s);
      if (el && el.innerText.trim().length > 200) break;
      el = null;
    }
    if (!el) el = document.body;

    // Remove script/style noise
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, style, nav, footer, header, .sidebar, #sidebar, .ads, .comments').forEach(n => n.remove());

    const text = clone.innerText.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
    // Send up to 12000 chars — enough for a full article or paper section
    return text.slice(0, 3000);
  }

  // ── Detect PDF links on the page and add "Open in DeepRead" button ──
  function detectPDFLinks() {
    const links = document.querySelectorAll('a[href$=".pdf"], a[href*=".pdf?"]');
    links.forEach(link => {
      if (link.dataset.deepreadAttached) return;
      link.dataset.deepreadAttached = 'true';

      const btn = document.createElement('span');
      btn.textContent = '📖';
      btn.title = 'Open in DeepRead';
      btn.style.cssText = `
        cursor:pointer; margin-left:5px; font-size:14px;
        opacity:0.7; transition:opacity 0.15s;
        display:inline-block; vertical-align:middle;
      `;
      btn.addEventListener('mouseenter', () => btn.style.opacity = '1');
      btn.addEventListener('mouseleave', () => btn.style.opacity = '0.7');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'OPEN_PDF_READER', url: link.href });
      });
      link.after(btn);
    });
  }

  // Run PDF detection on load and observe DOM changes (for dynamic pages)
  detectPDFLinks();
  const pdfObserver = new MutationObserver(() => detectPDFLinks());
  pdfObserver.observe(document.body, { childList: true, subtree: true });

  // ── Create answer card ──
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
        <button class="deepread-collapse" title="collapse">−</button>
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

    // Scroll into view — right where the card is, not jumping to bottom
    setTimeout(() => {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 30);

    // Collapse button
    card.querySelector('.deepread-collapse').addEventListener('click', () => {
      card.classList.toggle('collapsed');
      card.querySelector('.deepread-collapse').textContent = card.classList.contains('collapsed') ? '+' : '−';
    });

    // Custom question
    const input = card.querySelector('.deepread-ask-input');
    const askBtn = card.querySelector('.deepread-ask-btn');
    const submitCustom = () => {
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      const nested = card.querySelector(':scope > .deepread-nested');
      createCard(q, nested, depth + 1, streamBuffers[cardId].slice(0, 1500) + '\n\n' + context.slice(0, 800));
    };
    askBtn.addEventListener('click', submitCustom);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submitCustom(); });

    // Start streaming
    streamFromOllama(question, context, depth, cardId);
  }

  // ── Stream via background ──
  function streamFromOllama(question, context, depth, cardId) {
    const system = `You are a sharp reading companion helping someone deeply understand what they're reading.

The user has selected a specific phrase or sentence they want to understand. You have the full document context available.

Instructions:
- Answer in 2-4 focused paragraphs of flowing prose. No bullet points.
- Don't restate the question or selected text.
- Use the full document context to give a grounded, accurate answer.
- Be specific and insightful, not generic.
- At depth 2-3, go more technical and precise.
- End in a way that naturally invites the next question.

Depth level: ${depth}/3.`;

    const prompt = `${system}

FULL DOCUMENT CONTEXT:
"""
${context.slice(0, 3000)}
"""

The reader selected and wants to understand: "${question}"

Answer clearly and insightfully, grounded in the document above:`;

    chrome.runtime.sendMessage({
      type: 'OLLAMA_STREAM',
      host: settings.host,
      model: settings.model,
      prompt,
      cardId
    });
  }

  // ── Handle streaming chunks ──
  function handleChunk({ cardId, text, done }) {
    streamBuffers[cardId] = (streamBuffers[cardId] || '') + text;
    const card = document.querySelector(`[data-card-id="${cardId}"]`);
    if (!card) return;
    const body = card.querySelector('.deepread-body');

    if (!done) {
      const rendered = streamBuffers[cardId]
        .split(/\n{2,}/)
        .filter(p => p.trim())
        .map(p => `<p>${esc(p.trim())}</p>`)
        .join('');
      body.innerHTML = rendered + '<span class="deepread-cursor"></span>';
    } else {
      // Final render
      const fullText = streamBuffers[cardId];
      body.innerHTML = fullText
        .split(/\n{2,}/)
        .filter(p => p.trim())
        .map(p => `<p>${esc(p.trim())}</p>`)
        .join('') || '<p style="color:#666">No response.</p>';

      // Show suggestions + custom question row
      const footer = card.querySelector('.deepread-footer');
      const depth = parseInt(card.querySelector('.deepread-chip').textContent.replace('Q', ''));
      footer.style.display = 'flex';
      pickSuggestions(fullText).forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'deepread-sug';
        btn.textContent = s;
        btn.addEventListener('click', () => {
          btn.disabled = true;
          const nested = card.querySelector(':scope > .deepread-nested');
          createCard(s, nested, depth + 1, fullText.slice(0, 1200));
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

  // ── Suggestions ──
  const SUGS = [
    'Why does this matter?',
    'Give me a concrete example',
    'Simplest way to think about this?',
    'What are the implications?',
    'Common misconception here?',
    'How does this connect to the bigger picture?',
    'What should I read next on this?',
    'Go deeper on this',
  ];
  function pickSuggestions(text) {
    const i = (text.length + (text.charCodeAt(0) || 0)) % SUGS.length;
    return [SUGS[i], SUGS[(i + 3) % SUGS.length]];
  }

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

})();
