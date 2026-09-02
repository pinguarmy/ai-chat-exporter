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

- `chrome.storage.local`: Export settings, temporary conversation cache (auto-cleaned after 1 hour)
- Auth tokens are stored in `chrome.storage.session` (memory-backed, never written to disk and cleared when the browser session ends) where the browser supports it, and never synced across devices

## Remote Content During Preview and PDF Export

When a conversation contains images hosted by the AI platform, the preview page and
PDF export render those images from their original URLs. Loading them issues HTTPS
requests from your browser to that platform's servers — the same requests the chat
page itself would make. No image content passes through extension-operated servers.
Disable "Include images" in the export options to prevent these requests.

## Data Transmission

The extension makes network requests only to the AI platform APIs you are already authenticated to, and only to perform export actions you request:

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

To delete all stored data:
1. Right-click the extension icon → "Options"
2. Reset all settings to defaults
3. Or uninstall the extension — this removes all stored data automatically

## Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Store your export preferences |
| `activeTab` | Access the current tab when you click export |
| `downloads` | Save exported files to your computer |
| `alarms` | Clean up temporary export data |

## Contact

For privacy questions, open an issue on our GitHub repository:
https://github.com/pinguarmy/ai-chat-exporter/issues

## Changes

We will update this policy if our practices change. Check the "Last updated" date above.
