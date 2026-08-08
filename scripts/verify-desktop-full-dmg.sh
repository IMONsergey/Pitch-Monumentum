#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Desktop Full DMG verification requires macOS." >&2
  exit 2
fi

RELEASE_DIR="${1:-release-full}"
if [[ ! -d "$RELEASE_DIR" ]]; then
  echo "Release directory does not exist: $RELEASE_DIR" >&2
  exit 3
fi

DMG="$(find "$RELEASE_DIR" -maxdepth 1 -type f -name '*.dmg' -print | sort | head -n 1)"
if [[ -z "$DMG" ]]; then
  echo "No DMG found in $RELEASE_DIR" >&2
  exit 4
fi

MOUNT="$(mktemp -d /tmp/pitch-monumentum-dmg.XXXXXX)"
ATTACHED=0
cleanup() {
  if [[ "$ATTACHED" == "1" ]]; then
    hdiutil detach "$MOUNT" -quiet || hdiutil detach "$MOUNT" -force -quiet || true
  fi
  rmdir "$MOUNT" 2>/dev/null || true
}
trap cleanup EXIT

hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT" -quiet
ATTACHED=1

APP="$(find "$MOUNT" -maxdepth 1 -type d -name '*.app' -print | sort | head -n 1)"
if [[ -z "$APP" ]]; then
  echo "Mounted DMG does not contain an .app bundle" >&2
  exit 5
fi

BIN="$APP/Contents/MacOS/Pitch Monumentum"
PLIST="$APP/Contents/Info.plist"
APP_ROOT="$APP/Contents/Resources/app"

[[ -f "$BIN" ]] || { echo "Missing packaged executable: $BIN" >&2; exit 6; }
[[ -f "$PLIST" ]] || { echo "Missing packaged Info.plist" >&2; exit 7; }
[[ -f "$APP_ROOT/dist/apps/desktop-full/src/main.js" ]] || { echo "DMG contains no Desktop Full compiled entry" >&2; exit 8; }
[[ -f "$APP_ROOT/dist/apps/desktop-runtime/src/main.js" ]] || { echo "DMG contains no stable Desktop Runtime" >&2; exit 9; }
[[ -f "$APP_ROOT/dist/apps/workspace/src/full-server.js" ]] || { echo "DMG contains no Full Workspace" >&2; exit 10; }
[[ -f "$APP_ROOT/dist/apps/system-health/src/runtime.js" ]] || { echo "DMG contains no System Health runtime" >&2; exit 11; }
[[ -f "$APP_ROOT/dist/apps/pitch-mcp-full/src/server.js" ]] || { echo "DMG contains no Full MCP entry" >&2; exit 12; }
[[ -f "$APP_ROOT/apps/workspace/public/delivery-ui.js" ]] || { echo "DMG contains no Delivery UI" >&2; exit 13; }
[[ -f "$APP_ROOT/apps/workspace/public/system-health-ui.js" ]] || { echo "DMG contains no System Health UI" >&2; exit 14; }

FILE_OUTPUT="$(file "$BIN")"
if ! grep -q 'x86_64' <<<"$FILE_OUTPUT"; then
  echo "Packaged executable is not x86_64: $FILE_OUTPUT" >&2
  exit 15
fi

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST" 2>/dev/null || true)"
SHORT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null || true)"
BUNDLE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PLIST" 2>/dev/null || true)"
DMG_SHA="$(shasum -a 256 "$DMG" | awk '{print $1}')"
BIN_SHA="$(shasum -a 256 "$BIN" | awk '{print $1}')"

REPORT="$RELEASE_DIR/DMG-VERIFICATION.txt"
{
  echo "Pitch Monumentum Desktop Full DMG verification"
  echo "dmg=$DMG"
  echo "dmg_sha256=$DMG_SHA"
  echo "app=$APP"
  echo "bundle_id=$BUNDLE_ID"
  echo "short_version=$SHORT_VERSION"
  echo "bundle_version=$BUNDLE_VERSION"
  echo "binary=$BIN"
  echo "binary_file=$FILE_OUTPUT"
  echo "binary_sha256=$BIN_SHA"
  echo "desktop_full_entry=present"
  echo "desktop_runtime=present"
  echo "full_workspace=present"
  echo "system_health=present"
  echo "full_mcp=present"
  echo "delivery_ui=present"
  echo "health_ui=present"
  echo "verified_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$REPORT"

printf '%s  %s\n' "$DMG_SHA" "$(basename "$DMG")" > "$RELEASE_DIR/SHA256SUMS.txt"
printf '%s\n' "$FILE_OUTPUT" > "$RELEASE_DIR/ARCHITECTURE.txt"

echo "Verified Desktop Full DMG: $DMG"
echo "$FILE_OUTPUT"
echo "SHA-256: $DMG_SHA"
echo "Report: $REPORT"
