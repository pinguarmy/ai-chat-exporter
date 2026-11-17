#!/bin/bash
# Build extension for all browsers with WXT (wxt.config.ts)
# Chrome/Edge: build/chrome-mv3 (optional unlimitedStorage, no gecko settings)
# Firefox:     build/firefox-mv3 (MV3 background.scripts, gecko id, install-time
#              unlimitedStorage, data collection declaration)

set -e
cd "$(dirname "$0")/.."

# Release packages must all describe the same committed tree. A dirty source
# tree would let WXT include local edits in browser ZIPs while git archive
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

echo "=== Checking generated i18n chunks ==="
node scripts/generate-i18n-chunks.mjs --check

echo "=== Building Chrome/Edge with WXT ==="
npx wxt build -b chrome

echo ""
echo "=== Verifying Chrome/Edge build ==="
node scripts/verify-build.js chrome
node scripts/write-build-provenance.mjs . build/chrome-mv3

echo ""
echo "=== Refreshing unpacked Chrome extension ==="
rsync -a --delete build/chrome-mv3/ ai-chat-exporter/
node scripts/verify-build.js unpacked

echo ""
echo "=== Creating Chrome/Edge ZIP ==="
cd build/chrome-mv3
rm -f ../../ai-chat-exporter.zip
zip -r ../../ai-chat-exporter.zip . > /dev/null
echo "Chrome/Edge: $(ls -lh ../../ai-chat-exporter.zip | awk '{print $5}')"

echo ""
echo "=== Building Firefox with WXT ==="
cd ../..
FIREFOX_BUILD_DIR="build/firefox-mv3"
npx wxt build -b firefox
BUILD_DIR="$FIREFOX_BUILD_DIR" node scripts/verify-build.js firefox
node scripts/write-build-provenance.mjs . "$FIREFOX_BUILD_DIR"

echo ""
echo "=== Creating Firefox ZIP ==="
cd "$FIREFOX_BUILD_DIR"
rm -f ../../ai-chat-exporter-firefox.zip
zip -r ../../ai-chat-exporter-firefox.zip . > /dev/null
echo "Firefox: $(ls -lh ../../ai-chat-exporter-firefox.zip | awk '{print $5}')"

# Keep the Chrome build and unpacked mirror available for local development;
# the Firefox package lives in its own build directory.
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
