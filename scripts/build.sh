#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$ROOT_DIR/dist"
ENTRY="$ROOT_DIR/packages/server/src/cli.ts"
VERSION="${CAR_VERSION:-dev}"

echo "Building Chat Agent Relay Server v${VERSION}..."
mkdir -p "$OUT_DIR"

targets=(
  "bun-linux-x64"
  "bun-linux-arm64"
  "bun-darwin-x64"
  "bun-darwin-arm64"
  "bun-windows-x64"
)

for target in "${targets[@]}"; do
  platform="${target#bun-}"
  outname="car-server-${VERSION}-${platform}"
  if [[ "$target" == *"windows"* ]]; then
    outname="${outname}.exe"
  fi
  echo "  Building ${outname}..."
  bun build --compile --target="$target" "$ENTRY" --outfile "$OUT_DIR/$outname" 2>&1 || {
    echo "  Warning: Failed to build for $target (may not be supported on this host)"
  }
done

echo ""
echo "Build complete. Binaries in $OUT_DIR/"
ls -lh "$OUT_DIR/" 2>/dev/null || true
