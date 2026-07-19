# Audit, Delivery, and Browser-Store Workflow

This is the default workflow for AI Chat Exporter changes. Its purpose is to
turn a scoped request into a verified, merged, store-ready change without
needing separate prompts for routine Git and release-preparation steps.

## Default decisions

| Situation | Default action |
| --- | --- |
| Code or production dependency change | Use a patch version bump unless the change is clearly a feature (minor) or a breaking change (major). |
| Documentation-only change | Do not bump the extension version or rebuild packages. |
| Checks pass | Commit, push, open a focused PR if needed, and merge it into main automatically. |
| Checks fail | Fix the scoped failure, rerun the affected checks, and do not merge until they pass. |
| Authenticated provider testing | Skip unless the user explicitly places a logged-in session in scope. |
| Chrome, Edge, or Firefox store upload | Prepare and verify packages by default; upload only when a task explicitly asks to publish to the stores. |

## 1. Inspect and scope

1. Start from a clean, current main branch.
2. Check for existing working-tree changes before editing; preserve unrelated
   work.
3. Inspect the direct provider, export, scheduler, or UI path involved. Do not
   infer export completeness from the visible page alone.
4. State a narrow success condition, then make only the changes needed to meet
   it.

Provider-specific rules:

- Retain API pagination and user-visible message order.
- Keep regenerated or abandoned message branches out of exports.
- Do not log cookies, tokens, account identifiers, or private chat contents.
- A provider is only live-tested when a user-scoped authenticated session was
  actually exercised.

## 2. Implement and cover regressions

1. Add or update a focused regression test for a fixed bug when practical.
2. Keep generated build outputs and local caches out of commits.
3. Update user-facing documentation when behavior, permissions, or release
   steps change.

## 3. Set the release version

For changes that ship in the extension, choose the next semantic version before
creating store archives:

~~~bash
# Patch release by default
npm version patch --no-git-tag-version

# Use these only for a clear user-facing feature or breaking change
npm version minor --no-git-tag-version
npm version major --no-git-tag-version
~~~

The version in package.json is the source of truth. Confirm that
package-lock.json updates to the same version. Browser stores reject an upload
whose manifest version is not greater than the currently published version.

## 4. Verify

Run the complete release-preparation checks:

~~~bash
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

- Tests, TypeScript, and both browser builds pass.
- The production dependency audit reports zero vulnerabilities, or any
  remaining result is explicitly dispositioned before merge.
- Both archive integrity checks pass.
- Each packaged manifest has the new version and manifest version 3.

The PDF test suite may report jsdom limitations around getComputedStyle or
scrollTo; those messages are expected only when the test still passes.

## 5. Merge the verified change

For a clean working tree, use a focused branch and stage only in-scope files:

~~~bash
git switch main
git pull --ff-only origin main
git switch -c codex/<short-description>
git add <explicit files>
git commit -m "<concise description>"
git push -u origin codex/<short-description>
~~~

Create a PR describing the changed providers or export paths, root cause,
validation, and any provider not live-tested. Once the checks pass, merge it
into main automatically. A draft or review hold is used only when the user asks
for one.

## 6. Produce and publish browser packages

npm run build produces the two store artifacts:

| Store | Upload artifact |
| --- | --- |
| Chrome Web Store | ai-chat-exporter.zip |
| Microsoft Edge Add-ons | ai-chat-exporter.zip |
| Firefox Add-ons | ai-chat-exporter-firefox.zip |

ai-chat-exporter-source.zip is an archive of source code, not a browser store
upload artifact.

Before an upload, compare the version embedded in each ZIP with the current
Chrome Web Store and Firefox Add-ons listings. Upload only a strictly newer
version. The repository's .github/workflows/release.yml can create a GitHub
release with the two packages when triggered manually or by a v* tag; it does
not itself upload to browser stores.

Browser-store upload is a production deployment. When it is explicitly in
scope, upload the verified ZIPs through the appropriate developer dashboard
and record the resulting version/status. Do not expose dashboard credentials
or session material in commits, logs, or PR text.

## 7. Handoff format

Report only the material state:

1. Version, commit, and merge status.
2. Changed provider/export paths.
3. Test, lint, build, archive, and production-audit results.
4. Package filenames and whether they are store-uploaded or merely prepared.
5. Providers not live-tested and why.
