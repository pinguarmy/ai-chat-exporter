#!/bin/bash
# Build extension for all browsers
# Chrome/Edge: clean Plasmo manifest
# Firefox: patched with gecko-specific fields

set -e
cd "$(dirname "$0")/.."

# Release packages must all describe the same committed tree. A dirty source
# tree would let Plasmo include local edits in browser ZIPs while git archive
# silently packages HEAD instead.
BUILD_SOURCE_ARCHIVE=1
if [[ -z "${ALLOW_DIRTY_BUILD:-}" ]]; then
  if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
    echo "Refusing release build from a dirty Git worktree. Commit the source changes first (or set ALLOW_DIRTY_BUILD=1 for a local dev build without a source archive)." >&2
    exit 1
  fi
else
  BUILD_SOURCE_ARCHIVE=0
fi

echo "=== Building with Plasmo ==="
# Plasmo 0.90.5 starts an unawaited npm-registry version check. Disable that
# non-build network request so release builds stay deterministic offline.
PLASMO_NO_UPDATE_CHECK=1 npx plasmo build

echo ""
echo "=== Verifying Chrome/Edge build ==="
node scripts/verify-build.js chrome

echo ""
echo "=== Refreshing unpacked Chrome extension ==="
rsync -a --delete build/chrome-mv3-prod/ ai-chat-exporter/
node scripts/verify-build.js unpacked

echo ""
echo "=== Creating Chrome/Edge ZIP (clean manifest) ==="
cd build/chrome-mv3-prod
rm -f ../../ai-chat-exporter.zip
zip -r ../../ai-chat-exporter.zip . > /dev/null
echo "Chrome/Edge: $(ls -lh ../../ai-chat-exporter.zip | awk '{print $5}')"

echo ""
echo "=== Preparing isolated Firefox build ==="
cd ../..
FIREFOX_BUILD_DIR="build/firefox-mv3-prod"
rm -rf "$FIREFOX_BUILD_DIR"
rsync -a --delete build/chrome-mv3-prod/ "$FIREFOX_BUILD_DIR/"
BUILD_DIR="$FIREFOX_BUILD_DIR" node scripts/patch-firefox-manifest.js
BUILD_DIR="$FIREFOX_BUILD_DIR" node scripts/verify-build.js firefox

echo ""
echo "=== Creating Firefox ZIP (patched manifest) ==="
cd "$FIREFOX_BUILD_DIR"
rm -f ../../ai-chat-exporter-firefox.zip
zip -r ../../ai-chat-exporter-firefox.zip . > /dev/null
echo "Firefox: $(ls -lh ../../ai-chat-exporter-firefox.zip | awk '{print $5}')"

# Keep the Chrome build and unpacked mirror available for local development;
# Firefox-specific manifest fields live only in the isolated staging directory.
cd ../..
node scripts/verify-build.js chrome
node scripts/verify-build.js unpacked

# Source packaging uses repository-relative paths and the selected ref's metadata.

if [[ "$BUILD_SOURCE_ARCHIVE" -eq 1 ]]; then
  echo ""
  echo "=== Creating source archive from tracked Git content ==="
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Cannot create source archive: build must run inside a Git working tree." >&2
    exit 1
  fi
  SOURCE_ARCHIVE_REF="${SOURCE_ARCHIVE_REF:-HEAD}"
  PACKAGE_VERSION="$(git show "${SOURCE_ARCHIVE_REF}:package.json" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")"
  SOURCE_ARCHIVE_PREFIX="ai-chat-exporter-${PACKAGE_VERSION}-source/"
  rm -f ai-chat-exporter-source.zip
  git archive \
    --format=zip \
    --prefix="${SOURCE_ARCHIVE_PREFIX}" \
    "${SOURCE_ARCHIVE_REF}" \
    -o ai-chat-exporter-source.zip
  bash scripts/verify-source-archive.sh \
    ai-chat-exporter-source.zip \
    "${PACKAGE_VERSION}" \
    "${SOURCE_ARCHIVE_PREFIX}"
  SOURCE_OUTPUT="ai-chat-exporter-source.zip (ref: ${SOURCE_ARCHIVE_REF})"
else
  rm -f ai-chat-exporter-source.zip
  SOURCE_OUTPUT="skipped for ALLOW_DIRTY_BUILD=1 (development build)"
fi

echo ""
echo "=== Done ==="
echo "Chrome/Edge: ai-chat-exporter.zip"
echo "Firefox:     ai-chat-exporter-firefox.zip"
echo "Source:      ${SOURCE_OUTPUT}"
