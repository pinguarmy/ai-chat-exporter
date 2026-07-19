<div align="center">

# AI Chat Exporter

**Export ChatGPT, Gemini, Claude, DeepSeek & Grok to clean PDF or Markdown. 100% free. No paywalls. No accounts. No tracking.**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/ai-chat-exporter/kdafdajkiljhghecdkeogldafhjgmgpk)
[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/pinguarmy-ai-chat-exporter/)
[![Edge Extension](https://img.shields.io/badge/Edge-Extension-blue?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/ai-chat-exporter/ndjcmigocoflghenpchbldpkaccechpg)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-495%20passing-brightgreen)](https://github.com/pinguarmy/ai-chat-exporter/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Plasmo](https://img.shields.io/badge/Built_with-Plasmo-purple.svg)](https://plasmo.com)

<br/>

Built by [pinguarmy](https://github.com/pinguarmy). Free forever. One-click export. Bulk download. Custom filenames. Beautiful output.

[Install](#installation) · [Features](#features) · [Usage](#usage) · [Development](#development) · [Release workflow](docs/release-workflow.md)

</div>

---

## Why?

ChatGPT, Gemini, Claude, DeepSeek, and Grok don't let you export your conversations in a clean, portable format. Your conversations are trapped inside their platforms. **AI Chat Exporter** fixes that, for free.

Export any conversation to **PDF** or **Markdown** with proper formatting, code blocks, LaTeX equations, images, and metadata. Perfect for:

- **Archiving** important conversations before they get deleted
- **Sharing** AI-generated content with colleagues or classmates
- **Building a personal knowledge base** from your best AI interactions
- **Migrating** conversations between platforms
- **Printing** long research sessions or coding tutorials

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Platform** | Works on ChatGPT, Gemini, Claude, DeepSeek, and Grok |
| **PDF Export** | Clean, print-ready PDF with headings, lists, code blocks, LaTeX, and proper page breaks |
| **Markdown Export** | Structured `.md` files with code blocks, headers, LaTeX equations, and formatting |
| **Bulk Export** | Fetch ALL your conversations via API and export multiple at once |
| **Custom Filenames** | Template system with `{date}`, `{title}`, `{platform}`, `{conv_date}`, `{msgcount}` |
| **Auto-Download** | No save dialogs — files go straight to your configured folder |
| **Organized Folders** | Auto-sort exports into `ChatGPT/`, `Gemini/`, `Claude/`, `DeepSeek/`, or `Grok/` subfolders |
| **LaTeX Support** | Mathematical equations preserved as-is in Markdown, rendered in PDF |
| **Unicode Filenames** | Chinese, Japanese, Korean, Arabic titles preserved in filenames |
| **Free Forever** | No paywalls, no subscriptions, no extension accounts, and no paid export caps |
| **Zero Tracking** | No analytics, no extension accounts, and no export data sent to third-party servers |
| **Open Source** | MIT licensed — inspect, fork, and contribute |

## Installation

### Chrome Web Store
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/kdafdajkiljhghecdkeogldafhjgmgpk?label=Install&style=for-the-badge)](https://chromewebstore.google.com/detail/ai-chat-exporter/kdafdajkiljhghecdkeogldafhjgmgpk)

### Firefox Add-ons
[![Firefox Add-on](https://img.shields.io/amo/v/ai-chat-exporter?label=Install&style=for-the-badge)](https://addons.mozilla.org/en-US/firefox/addon/pinguarmy-ai-chat-exporter/)

### Edge Add-ons
[![Edge Add-on](https://img.shields.io/badge/Edge-Install-blue?style=for-the-badge)](https://microsoftedge.microsoft.com/addons/detail/ai-chat-exporter/ndjcmigocoflghenpchbldpkaccechpg)

### From Source (2 minutes)

```bash
# Clone
git clone https://github.com/pinguarmy/ai-chat-exporter.git
cd ai-chat-exporter

# Install
npm install

# Build (creates both Chrome/Edge and Firefox ZIPs)
npm run build

# Load in Chrome:
# 1. Open chrome://extensions/
# 2. Enable "Developer mode" (top right)
# 3. Click "Load unpacked"
# 4. Select the build/chrome-mv3-prod/ folder
```

## Usage

### Export Current Conversation

1. Open any conversation on **ChatGPT**, **Gemini**, **Claude**, **DeepSeek**, or **Grok**
2. Click the **AI Chat Exporter** icon in your toolbar
3. Choose **PDF** or **Markdown**
4. Click **Export** — file downloads automatically

### Bulk Export

1. Navigate to ChatGPT, Gemini, Claude, DeepSeek, or Grok
2. Click the extension icon → **Bulk** tab
3. Wait for conversations to load (uses API — gets ALL, not just visible)
4. Select conversations with checkboxes
5. Click **Export Selected**

### Custom Filenames

Configure filename patterns in Settings:

| Token | Output | Example |
|-------|--------|---------|
| `{date}` | Current/export date | `2026-06-11` |
| `{datetime}` | Current date & time | `2026-06-11T143022` |
| `{conv_date}` | Conversation start date | `2026-06-08` |
| `{conv_datetime}` | Conversation start date & time | `2026-06-08T093000` |
| `{end_date}` | Export date (alias) | `2026-06-11` |
| `{title}` | Session title | `how-to-learn-python` |
| `{platform}` | Platform name | `chatgpt` |
| `{index}` | Number (bulk) | `001` |
| `{msgcount}` | Message count | `24` |

Default pattern: `{conv_date}-{title}` → `2026-06-08-how-to-learn-python.pdf`

### Download Folders

Choose where files are saved in Settings:

- **Default** → `Downloads/` root
- **By Platform** → `Downloads/ChatGPT/`, `Downloads/Gemini/`, `Downloads/Claude/`, `Downloads/DeepSeek/`, or `Downloads/Grok/`
- **Custom** → Any folder name you choose (Unicode supported)

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Content     │────▶│  DOM Parser  │────▶│  Conversation │
│  Script      │     │  (messages)  │     │  Object       │
└─────────────┘     └──────────────┘     └───────┬───────┘
                                                  │
┌─────────────┐     ┌──────────────┐              ▼
│  Hook        │────▶│  Credential  │     ┌───────────────┐
│  Script      │     │  Capture     │     │  Export Engine │
└─────────────┘     └──────────────┘     │  (PDF / MD)   │
                                          └───────┬───────┘
                                                  │
                                                  ▼
                                          ┌───────────────┐
                                          │  Download      │
                                          │  (auto-save)   │
                                          └───────────────┘
```

- **Content scripts** parse conversations from the page DOM
- **API detail fetcher** retrieves full conversation via platform API (preferred over DOM for better formatting)
- **Parser fallback** compares DOM vs API results and picks the more complete one
- **Export engine** converts to PDF (html2canvas + jsPDF) or Markdown
- **Auto-download** saves to configured folder without prompts

## Development

```bash
# Install
npm install

# Development mode (watch + hot reload)
npx plasmo dev

# Run tests
npm test

# Production build (creates Chrome/Edge + Firefox ZIPs)
npm run build
```

### Project Structure

```
ai-chat-exporter/
├── src/
│   ├── popup.tsx              # Main UI (Current + Bulk tabs)
│   ├── options.tsx            # Settings page
│   ├── background.ts          # Service worker
│   ├── contents/
│   │   ├── chatgpt-parser.ts  # ChatGPT DOM + API parser
│   │   ├── claude-parser.ts   # Claude API parser
│   │   ├── deepseek-parser.ts # DeepSeek DOM + API parser
│   │   ├── gemini-parser.ts   # Gemini hook + API parser
│   │   └── grok-parser.ts     # Grok DOM parser
│   ├── lib/
│   │   ├── types.ts           # TypeScript interfaces
│   │   ├── export-markdown.ts # Markdown generator (LaTeX support)
│   │   ├── export-pdf.ts      # PDF generator (markdown-to-HTML)
│   │   ├── filename.ts        # Filename templates (Unicode-safe)
│   │   ├── download-path.ts   # Download folder logic
│   │   ├── parser-fallback.ts # DOM vs API comparison
│   │   └── dom-utils.ts       # DOM helpers
│   ├── components/            # React UI components
│   ├── styles/                # CSS (Gemini design system)
│   └── tabs/                  # Preview page
├── tests/                     # Vitest + jsdom test suite
├── scripts/
│   ├── build-all.sh           # Build for Chrome/Edge + Firefox
│   └── patch-firefox-manifest.js  # Firefox MV3 compatibility
├── promo/                     # Store promotional images
├── PRIVACY.md                 # Privacy policy
├── CHROME_STORE_CHECKLIST.md  # Submission checklist
├── GUIDE.md                   # Full development guide
└── package.json
```

### Testing

```bash
npm test                # Run the full test suite
npx vitest run          # Same
npx vitest watch        # Watch mode
```

### Build Outputs

```bash
npm run build
# Creates:
#   ai-chat-exporter.zip          → Chrome Web Store + Edge Add-ons
#   ai-chat-exporter-firefox.zip  → Firefox Add-ons
```

For the audit, merge, versioning, and browser-store preparation process, see
[the release workflow](docs/release-workflow.md).

## Contributing

Contributions welcome! Here's how:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/awesome`)
3. **Commit** your changes (`git commit -m 'Add awesome feature'`)
4. **Push** to the branch
5. **Open** a Pull Request

### Good First Issues

- Add conversation search/filter in bulk mode
- Add HTML export format
- Add Notion/Obsidian integration
- Improve PDF styling with syntax highlighting
- Add conversation date range filter

## Privacy

This extension:

- ✅ Runs entirely in your browser
- ✅ Sends export data only to the AI platforms you are already using when needed for export
- ✅ Uses NO analytics or tracking
- ✅ Stores settings locally in chrome.storage
- ✅ Source code is fully auditable

Privacy policy: https://pinguarmy.github.io/ai-chat-exporter/PRIVACY.md

## License

[MIT](LICENSE) — use it however you want.

## Acknowledgments

- Built with [Plasmo](https://plasmo.com/) — the browser extension framework
- UI design inspired by [Linear](https://linear.app/) and [Notion](https://notion.so/)
- PDF generation via [jsPDF](https://github.com/parallax/jsPDF) + [html2canvas](https://github.com/niklasvh/html2canvas)

---

<div align="center">

Built and maintained by [pinguarmy](https://github.com/pinguarmy).

If this saved you time, a GitHub star helps others find it.

</div>
