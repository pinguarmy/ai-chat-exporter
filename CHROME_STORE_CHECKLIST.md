# Chrome Web Store Submission Checklist

## Account Setup
- [ ] Create Chrome Web Store developer account at https://chrome.google.com/webstore/devconsole
- [ ] Pay $5 USD one-time registration fee
- [ ] Verify email address

## Required Assets
- [x] Extension icon 128x128 (assets/icon128.png)
- [x] Extension icon 48x48 (assets/icon48.png)
- [x] Extension icon 32x32 (assets/icon32.png)
- [x] Extension icon 16x16 (assets/icon16.png)
- [x] Screenshots (1-5 images, 1280x800 or 640x400) in `store-assets/screenshots/`
  - Screenshot 1: Extension popup showing export options
  - Screenshot 2: Settings page with filename templates
  - Screenshot 3: Bulk export in progress
  - Screenshot 4: Exported PDF preview
  - Screenshot 5: Exported Markdown preview
- [x] Small promotional tile (440x280) in `store-assets/promotional/`
- [x] Large promotional tile (920x680) in `store-assets/promotional/`
- [x] Marquee promotional tile (1400x560) in `store-assets/promotional/`

## Listing Text
- [x] Extension name: "AI Chat Exporter: Free, No Limits"
- [ ] Short description (max 132 chars):
  "Free AI chat export for ChatGPT, Gemini, Claude, DeepSeek & Grok. Save clean PDF/Markdown. No accounts."
- [ ] Detailed description (max 16,384 chars):
  Use expanded version of README.md content
- [ ] Category: Productivity
- [ ] Language: English

## Privacy & Permissions
- [x] Privacy policy URL (host PRIVACY.md on GitHub Pages)
- [ ] Permission justifications:
  - storage: "Store user export preferences and settings"
  - activeTab: "Access current tab when user clicks export button"
  - downloads: "Save exported PDF and Markdown files to user's computer"
  - alarms: "Automatically clean up temporary export data after 1 hour"
  - host_permissions: "Parse conversations from AI platform pages for export"

## Single Purpose Statement
"This extension exports the user's AI chat conversations to PDF and Markdown files."

## Technical Requirements (all met)
- [x] Manifest V3
- [x] No remotely hosted code
- [x] No eval() or inline scripts
- [x] Proper content_security_policy
- [x] All permissions justified
- [x] No analytics/tracking code

## Review Timeline
- First submission: 1-3 business days (may take up to 7 days with broad host_permissions)
- Updates: typically within 24 hours

## After Approval
- [ ] Set up GitHub Pages for privacy policy URL
- [ ] Submit to Firefox Add-ons (AMO) — free
- [ ] Submit to Edge Add-ons — free
