# AI Chat Exporter Delivery Defaults

## Autonomous change flow

- For a scoped implementation or dependency change, inspect the relevant code,
  implement the fix, add regression coverage where practical, and run the
  narrowest relevant checks.
- After checks pass, create a focused branch, commit only the scoped files,
  push it, and merge it into main automatically. Do not wait for a manual PR
  click unless the user requests a draft, review, or hold.
- Treat shipping code or dependency changes as a patch release by default:
  bump package.json and package-lock.json before building. Documentation-only
  changes do not require a version bump.

## Release preparation

- Run npm test, npm run lint, npm run build, and npm audit --omit=dev --json
  for release-prep changes.
- Verify ai-chat-exporter.zip and ai-chat-exporter-firefox.zip with unzip -t,
  and ensure their manifests carry the bumped version.
- Use ai-chat-exporter.zip for Chrome Web Store and Edge Add-ons; use
  ai-chat-exporter-firefox.zip for Firefox Add-ons. Do not upload the source
  archive to a browser store.
- Store uploads and public release tagging are production deployments. Prepare
  the packages by default, but perform those external publishing steps only
  when the task explicitly asks to publish to the stores or create a release.

## Provider and data safety

- Preserve provider pagination, message order, and export completeness.
- Do not claim a provider export is complete from UI state alone.
- Do not read authenticated sessions, export cookies/tokens, or include private
  conversations in logs or fixtures unless the user has explicitly scoped a
  session for live testing.

See [docs/release-workflow.md](docs/release-workflow.md) for the complete
audit-to-release procedure.
