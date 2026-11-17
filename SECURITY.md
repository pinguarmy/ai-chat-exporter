# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do not open a public issue or pull request for them.

1. Preferred: use GitHub [private vulnerability reporting](https://github.com/pinguarmy/ai-chat-exporter/security/advisories/new) ("Report a vulnerability" on the repository's Security tab).
2. Alternative: email [extensions@pengyuhao.com](mailto:extensions@pengyuhao.com). No GitHub account is needed.

Include the affected version, steps to reproduce, and the impact you observed. Do not send private chats, credentials, tokens, cookies, or unredacted exports; a minimal synthetic reproduction is enough.

We aim to acknowledge reports within 7 days and to share a remediation plan or status after triage. Please allow time for a fix and store review before public disclosure; we will credit reporters who want credit.

## Scope

In scope:

- The browser extension (Chrome, Firefox and Edge packages built from this repository), including content scripts, export code, and extension pages.
- The feedback worker in [`services/feedback`](services/feedback) that receives optional uninstall feedback.

Out of scope:

- Vulnerabilities in the AI chat providers' own sites or APIs (report those to the provider).
- Issues in third-party browsers, browser stores, or GitHub itself.
- Reports that need a compromised device or browser profile, or social engineering of maintainers.
- Automated scanner output without a demonstrated impact.

## Supported versions

Only the latest release published to the browser stores receives security fixes.

## Bounty

This is a volunteer project and does not offer a bug bounty.
