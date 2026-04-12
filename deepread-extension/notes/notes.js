// notes.js — DeepRead notes viewer

let allNotes = [];

// ── Load notes — read directly from storage, no middleman ──
function loadNotes() {
  chrome.storage.local.get({ notes: [] }, (data) => {
    allNotes = data.notes || [];
    render(allNotes);
    updateCount(allNotes.length);
  });
}
loadNotes();

// ── Render ──
function render(notes) {
  const list = document.getElementById('notes-list');
  const empty = document.getElementById('empty');
  const noResults = document.getElementById('no-results');

  list.innerHTML = '';

  if (allNotes.length === 0) {
    empty.style.display = 'block';
    noResults.style.display = 'none';
    return;
  }

  empty.style.display = 'none';

  if (notes.length === 0) {
    noResults.style.display = 'block';
    return;
  }

  noResults.style.display = 'none';

  // Group by date
  const groups = {};
  notes.forEach(note => {
    const label = dateLabel(note.savedAt);
    if (!groups[label]) groups[label] = [];
    groups[label].push(note);
  });

  Object.entries(groups).forEach(([label, groupNotes]) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'date-group-label';
    groupEl.textContent = label;
    list.appendChild(groupEl);

    groupNotes.forEach(note => {
      list.appendChild(buildCard(note));
    });
  });
}

function buildCard(note) {
  const card = document.createElement('div');
  card.className = 'note-card';
  card.dataset.id = note.id;

  const answerHtml = (note.answer || '')
    .split(/\n{2,}/).filter(p => p.trim())
    .map(p => `<p>${esc(p.trim())}</p>`).join('');

  const shortUrl = note.url ? note.url.replace(/^https?:\/\//, '').slice(0, 60) : 'unknown source';
  const timeStr = note.savedAt ? new Date(note.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  card.innerHTML = `
    <div class="note-header">
      <div class="note-meta">
        <div class="note-source">
          <a href="${esc(note.url || '#')}" target="_blank" title="${esc(note.url || '')}">${esc(shortUrl)}</a>
          <span class="note-date">${timeStr}</span>
        </div>
        <div class="note-selected">"${esc(note.selected || '')}"</div>
      </div>
      <div class="note-toggle">▶</div>
    </div>
    <div class="note-answer">
      ${answerHtml || '<p style="color:#333">No answer saved.</p>'}
      <div class="note-actions">
        <button class="note-action-btn copy-btn">copy answer</button>
        <button class="note-action-btn delete delete-btn">delete</button>
      </div>
    </div>
  `;

  // Toggle expand
  card.querySelector('.note-header').addEventListener('click', () => {
    card.classList.toggle('expanded');
  });

  // Copy answer
  card.querySelector('.copy-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(note.answer || '').then(() => {
      const btn = card.querySelector('.copy-btn');
      btn.textContent = '✓ copied';
      setTimeout(() => btn.textContent = 'copy answer', 1500);
    });
  });

  // Delete
  card.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm('Delete this note?')) return;
    allNotes = allNotes.filter(n => n.id !== note.id);
    chrome.storage.local.set({ notes: allNotes }, () => {
      card.style.opacity = '0';
      card.style.transform = 'translateX(20px)';
      card.style.transition = 'all 0.2s';
      setTimeout(() => {
        render(filterNotes(document.getElementById('search').value));
        updateCount(allNotes.length);
      }, 200);
    });
  });

  return card;
}

// ── Search ──
document.getElementById('search').addEventListener('input', (e) => {
  const filtered = filterNotes(e.target.value);
  render(filtered);
});

function filterNotes(query) {
  if (!query.trim()) return allNotes;
  const q = query.toLowerCase();
  return allNotes.filter(n =>
    (n.selected || '').toLowerCase().includes(q) ||
    (n.answer || '').toLowerCase().includes(q) ||
    (n.url || '').toLowerCase().includes(q) ||
    (n.title || '').toLowerCase().includes(q)
  );
}

// ── Count ──
function updateCount(n) {
  document.getElementById('note-count').textContent = n === 0 ? '' : `${n} note${n === 1 ? '' : 's'}`;
}

// ── Export Markdown ──
document.getElementById('export-md').addEventListener('click', () => {
  if (allNotes.length === 0) return;

  const lines = ['# DeepRead Notes', ''];
  allNotes.forEach(note => {
    lines.push(`## "${note.selected || 'Note'}"`);
    lines.push(`**Source:** ${note.url || 'unknown'}`);
    lines.push(`**Saved:** ${note.savedAt ? new Date(note.savedAt).toLocaleString() : ''}`);
    lines.push('');
    lines.push('**Answer:**');
    lines.push(note.answer || '');
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  download('deepread-notes.md', lines.join('\n'), 'text/markdown');
});

// ── Export JSON ──
document.getElementById('export-json').addEventListener('click', () => {
  if (allNotes.length === 0) return;
  download('deepread-notes.json', JSON.stringify(allNotes, null, 2), 'application/json');
});

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Helpers ──
function dateLabel(isoStr) {
  if (!isoStr) return 'Unknown date';
  const date = new Date(isoStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Refresh button ──
document.getElementById('refresh-btn').addEventListener('click', () => {
  loadNotes();
});

// ── Auto-refresh when tab becomes visible (e.g. you switch back to notes tab) ──
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadNotes();
});
