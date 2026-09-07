# Privacy Policy — AI Chat Exporter

**Last updated: June 2026**

## Overview

AI Chat Exporter is a browser extension that helps you export your AI chat conversations
to PDF and Markdown files. All processing happens locally in your browser.

## Data Collection

**We do not collect, sell, or store any of your data on extension-operated servers.**

The extension accesses the following data solely to perform exports:

- **Conversation content**: The text, code blocks, and metadata of conversations you choose to export from ChatGPT, Gemini, Claude, DeepSeek, and Grok.
- **Authentication tokens**: Session tokens from AI platforms (stored locally) to access conversation APIs for user-initiated exports. These tokens are used only with the platform you are already signed in to and are never sent to extension-operated servers.
- **User preferences**: Your export settings (filename format, download folder, format preferences) stored in your browser's local storage.

## Data Storage

All data is stored locally in your browser using the `chrome.storage` API:

- `chrome.storage.local`: Export settings, recent export records, scheduled-export status, and temporary conversation snapshots. Snapshots expire after one hour and are removed by an hourly cleanup task while the browser and extension are running. Cleanup may occur later if the browser is closed or storage operations fail.
- Gemini credentials use `chrome.storage.session` when the content script can access it. This area is memory-backed and cleared when the browser session ends. If it is unavailable or inaccessible, Gemini falls back to `chrome.storage.local`, which is stored on disk. Credentials are never synced across devices.

## Remote Content During Preview and PDF Export

Preview and PDF export may load images from URLs included in a conversation.
These requests go to the image host, which may be the AI platform, its CDN, or
another website referenced in the conversation. No image content passes through
extension-operated servers. Disable "Include images" to prevent the extension
from rendering these remote images. Markdown files can retain remote image URLs;
opening them in another application may cause that application to fetch the images.

## Data Transmission

The extension accesses the following AI platforms using your existing signed-in session for exports and schedules you enable. Remote image rendering is described above:

- `chatgpt.com` / `chat.openai.com`
- `gemini.google.com`
- `claude.ai`
- `deepseek.com` / `chat.deepseek.com`
- `grok.com` / `www.grok.com`

No export data is sent to extension-operated servers. No analytics, telemetry, or tracking.

## Third-Party Services

None. The extension does not integrate with any third-party analytics, advertising,
or data processing services.

## Data Deletion

Uninstall the extension to remove its browser-managed settings, cached snapshots,
credentials, and export records. Changing settings or clearing export history does
not delete all extension data. Files you have already downloaded remain on your
computer; delete those files separately if you no longer want them.

## Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Store your export preferences |
| `activeTab` | Access the current tab when you click export |
| `downloads` | Save exported files to your computer |
| `alarms` | Check enabled export schedules and clean up temporary snapshots |

## Contact

For privacy questions, open an issue on our GitHub repository:
https://github.com/pinguarmy/ai-chat-exporter/issues

## Changes

We will update this policy if our practices change. Check the "Last updated" date above.
