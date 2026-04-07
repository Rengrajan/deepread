# DeepRead

**Select any text on any webpage or PDF. Ask your local AI about it. Go as deep as you want.**

DeepRead is a Chrome extension that lets you highlight any word, sentence, or paragraph while reading — and instantly get an explanation from a local AI model running on your machine. Ask follow-up questions on the answers themselves, drilling down recursively without ever leaving the page.

No API keys. No subscriptions. No data leaving your computer.

---

## How it works

1. Select any text on any webpage
2. Click the **⬡ Ask DeepRead** bubble that appears
3. An answer card appears inline, right below the paragraph you selected
4. Select text inside the answer to go deeper — recursively, as many levels as you want
5. Use suggested follow-ups or type your own questions

Works on articles, Wikipedia, Substack, news, research papers, and any PDF via URL.

---

## Features

- **Inline answers** — cards appear right where you're reading, not in a sidebar
- **Recursive drilling** — select text inside any answer to go deeper (depth 1 → 2 → 3)
- **PDF support** — paste any PDF URL into the popup to open it in DeepRead's reader
- **Full page context** — the entire article is sent with every question, not just the selected words
- **Streaming responses** — answers appear word by word as the model generates
- **Collapsible cards** — collapse any answer to keep your reading view clean
- **100% local** — runs on [Ollama](https://ollama.com), nothing leaves your machine
- **Free** — no API keys, no accounts, no cost

---

## Installation

### Prerequisites

- [Ollama](https://ollama.com) installed and running
- Chrome browser
- A pulled model (recommended: `qwen2.5:7b`)

### Step 1 — Pull a model

```bash
ollama pull qwen2.5:7b
```

### Step 2 — Start Ollama with CORS enabled

```bash
OLLAMA_ORIGINS=* ollama serve
```

This is required so the extension can talk to Ollama. Run this every time before using DeepRead.

### Step 3 — Download pdf.js locally

Chrome extensions cannot load scripts from external CDNs. Run the setup script once to download pdf.js into the extension folder:

```bash
cd deepread-extension
bash setup.sh
```

### Step 4 — Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer mode** ON (top right)
3. Click **Load unpacked**
4. Select the `deepread-extension` folder

### Step 5 — Configure

1. Click the DeepRead icon in your Chrome toolbar
2. Set **Host** to `http://localhost:11434`
3. Set **Model** to `qwen2.5:7b`
4. Click **test connection** — the dot should turn green
5. Click **save**

---

## Using DeepRead

### On any webpage

Navigate to any article, blog post, Wikipedia page, or Substack. Select any text and click the bubble.

### On a PDF

1. Click the DeepRead icon in the toolbar
2. Paste a PDF URL into the **Open a PDF** field
3. Click **open →**
4. A new tab opens with the paper rendered as readable text
5. Select and ask as usual

On any page with PDF links, a **📖** button appears next to each link — click it to open directly in DeepRead.

---

## Recommended models

| Model | Size | Speed | Quality | Best for |
|-------|------|-------|---------|----------|
| `qwen2.5:7b` | 4.7 GB | ⚡⚡⚡ | ★★★★ | Daily reading, articles |
| `qwen2.5:14b` | 9.7 GB | ⚡⚡ | ★★★★★ | Research papers, technical content |
| `llama3.2:3b` | 2.0 GB | ⚡⚡⚡⚡ | ★★★ | Quick lookups, slow machines |
| `mistral:7b` | 4.1 GB | ⚡⚡⚡ | ★★★★ | General reading |

---

## Performance tips

- **Use a GPU** — Ollama automatically uses your GPU if available. Check with `ollama ps`
- **Set context size explicitly**:
  ```bash
  OLLAMA_NUM_CTX=8192 OLLAMA_ORIGINS=* ollama serve
  ```

---

## Project structure

```
deepread-extension/
├── manifest.json        — Chrome extension config (Manifest V3)
├── background.js        — Service worker: Ollama API calls and PDF fetching
├── content.js           — Injected into pages: selection, bubble, answer cards
├── content.css          — Styles for inline answer cards
├── popup/
│   ├── popup.html       — Extension popup (settings)
│   └── popup.js
├── reader/
│   ├── reader.html      — PDF reader page
│   └── reader.js        — PDF parsing and DeepRead logic
├── lib/
│   ├── pdf.min.js       — downloaded by setup.sh
│   └── pdf.worker.min.js
├── icons/icon.png
└── setup.sh             — One-time setup script
```

---

## Why local?

Every other AI reading tool sends your text to a remote server. DeepRead runs entirely on your machine — your reading habits stay private, it works offline, no rate limits, no fees, swap models anytime.

---

## Roadmap

- [ ] Highlight persistence across sessions
- [ ] Export Q&A threads as markdown notes
- [ ] Right-click context menu trigger
- [ ] Support for Anthropic / OpenAI API as optional backend
- [ ] Firefox support

---

## Contributing

Pull requests welcome. Open an issue first for major changes.

---

## License

MIT — do whatever you want with it.

---

*Built with [Ollama](https://ollama.com) and [pdf.js](https://mozilla.github.io/pdf.js/). Inspired by the frustration of reading something interesting and losing track of every question it raised.*
