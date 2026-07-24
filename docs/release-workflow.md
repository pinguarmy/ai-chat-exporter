# v1.2.0 Release and Browser-Store Workflow

This policy defines how AI Chat Exporter changes become verified, release-ready
v1.2.0 deliverables. It separates source-controlled inputs from generated
packages and does not assume authenticated provider testing.

## 1. Scope and source-control policy

1. Start from a current branch and inspect existing working-tree changes before
   editing. Preserve unrelated work.
2. Add focused regression coverage when practical, and update user-facing
   documentation when behavior, permissions, or release steps change.
3. Commit source, tests, workflows, documentation, and curated store assets
   only. Do not commit generated browser packages, build output, unpacked
   mirrors, caches, or private notes.
4. `store-assets/` is the canonical, tracked source for browser-store images.
   The generated root `/ai-chat-exporter/` directory is never committed.

Provider-specific rules:

- Retain API pagination and user-visible message order.
- Keep regenerated or abandoned message branches out of exports.
- Do not log cookies, tokens, account identifiers, or private chat contents.
- Describe a provider as live-tested only when a user-scoped authenticated
  session was actually exercised.

## 2. Set the release version

For v1.2.0, set the exact release version before creating store archives:

~~~bash
npm version 1.2.0 --no-git-tag-version
~~~

For subsequent releases, select the next semantic version deliberately. The
version in `package.json` is the source of truth; confirm that
`package-lock.json` changes to the same version. Browser stores require each
uploaded manifest version to be strictly newer than the published version.

## 3. Complete release gate

Run the full gate from a clean dependency install:

~~~bash
npm ci
npm test
npm run lint
npm run build
npm audit --omit=dev --json

unzip -t ai-chat-exporter.zip
unzip -t ai-chat-exporter-firefox.zip
unzip -p ai-chat-exporter.zip manifest.json
unzip -p ai-chat-exporter-firefox.zip manifest.json
~~~

The expected results are:

- Dependency installation, tests, lint, and both browser builds pass.
- The production dependency audit reports zero vulnerabilities, or each
  remaining finding is explicitly dispositioned before release.
- Both archive integrity checks pass.
- Each packaged manifest has the intended version and manifest version 3.

The PDF suite can report jsdom limitations around `getComputedStyle` or
`scrollTo`; those messages are acceptable only when the relevant test passes.

## 4. CI and release automation

`.github/workflows/ci.yml` runs `npm ci`, tests, lint, and the browser build on
pull requests and pushes to `main` using Node 20.

`.github/workflows/release.yml` supports either a manual dispatch or a `v*`
tag push. A tag-triggered release fails unless the tag exactly equals
`v${package.json version}`. Manual dispatch resolves that same tag, creates it
only when absent, and fails if an existing tag points at another commit. The
workflow serializes releases to prevent concurrent manual and tag-triggered
runs from publishing the same version.

## 5. Produce and publish browser packages

`npm run build` produces the two browser-store upload artifacts:

| Store | Upload artifact |
| --- | --- |
| Chrome Web Store | `ai-chat-exporter.zip` |
| Microsoft Edge Add-ons | `ai-chat-exporter.zip` |
| Firefox Add-ons | `ai-chat-exporter-firefox.zip` |

`ai-chat-exporter-source.zip` is a source archive, not a browser-store upload
artifact. Before an upload, compare the version embedded in each ZIP with the
current store listing. Upload only a strictly newer, fully verified package.

Browser-store upload is a production deployment. Upload through the applicable
developer dashboard only when it is explicitly in scope, and never expose
dashboard credentials or session data in commits, logs, or PR text.

## 6. Handoff

Report the version; changed provider/export paths; full gate results; generated
package filenames; store-upload status; and providers that were not live-tested
with the reason.
