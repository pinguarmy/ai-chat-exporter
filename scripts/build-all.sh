#!/bin/bash
# Build extension for all browsers
# Chrome/Edge: clean Plasmo manifest
# Firefox: patched with gecko-specific fields

set -e
cd "$(dirname "$0")/.."

echo "=== Building with Plasmo ==="
npx plasmo build

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
echo "=== Applying Firefox patches ==="
cd ../..
node scripts/patch-firefox-manifest.js
node scripts/verify-build.js firefox

echo ""
echo "=== Creating Firefox ZIP (patched manifest) ==="
cd build/chrome-mv3-prod
rm -f ../../ai-chat-exporter-firefox.zip
zip -r ../../ai-chat-exporter-firefox.zip . > /dev/null
echo "Firefox: $(ls -lh ../../ai-chat-exporter-firefox.zip | awk '{print $5}')"

echo ""
echo "=== Done ==="
echo "Chrome/Edge: ai-chat-exporter.zip"
echo "Firefox:     ai-chat-exporter-firefox.zip"
