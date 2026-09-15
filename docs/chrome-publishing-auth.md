# Chrome publishing authorization

The Google Cloud project is `chrome-extension-publish`
(`rugged-matrix-507004-h6`). Its OAuth app, AI Chat Exporter Publisher, is
**In production** as of 2026-09-15. Keep it in production.

Google issues seven-day refresh tokens for external apps in Testing when they
request the Chrome Web Store scope. Production removes that testing deadline;
it does not make a token irrevocable. Google may still invalidate a token after
revocation, six months without use, or other account/token policy changes.

The app homepage and privacy policy point to this repository and `PRIVACY.md`.
This is an owner-operated publishing utility, not an OAuth login offered to
extension users. Production status is separate from Google's app verification.
The owner's consent flow may still show an unverified-app notice.

## Check and publish

```sh
npm run check:cws
npm run publish:cws
```

The first command exchanges the refresh token and reads the extension's draft
status. It does not upload or publish anything. The second uploads the prepared
release ZIP and submits it for review. Use the release workflow's verified ZIP;
do not replace an existing release with a build from a different commit.

The GitHub Release workflow reads the four `PLASMO_CHROME_*` repository secrets.
Local publishing reads the same names from the environment or ignored
`.env.local`. A `gcloud auth login` session is a different authorization and
does not replace the Chrome Web Store grant.

To verify the GitHub copy without starting a release:

```sh
gh workflow run chrome-auth.yml --ref main
```

## Renew only when needed

```sh
npm run auth:cws
npm run check:cws
npm run sync:cws
```

Use the publisher Google account in the printed consent link. The helper binds
to localhost, validates OAuth state, expires after ten minutes, and saves the
new offline refresh token without printing it. The local file is owner-readable
and writable only. The sync command sends values through stdin to GitHub Actions
secrets for `pinguarmy/ai-chat-exporter`, never through command-line arguments.
Do not regenerate a token before each release.

If Google returns `invalid_grant`, confirm Production status and renew once.
If a store permission check fails, confirm that the consenting account can
manage this extension. Repeating uploads cannot fix an authorization failure.

Reference: [Google OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).
