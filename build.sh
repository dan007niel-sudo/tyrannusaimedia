#!/usr/bin/env bash
# Tyrannus AI Media — Render Build Script
# Builds the React frontend and installs Python backend dependencies.

set -o errexit  # Exit on error

echo "═══════════════════════════════════════════════"
echo "  Tyrannus AI Media — Build"
echo "═══════════════════════════════════════════════"

# 1. Install Node.js dependencies & build frontend
echo "→ Installing Node.js dependencies..."
npm ci

echo "→ Building React frontend..."
npm run build

echo "✓ Frontend built → dist/"

# 2. Install Python dependencies
echo "→ Installing Python dependencies..."
pip install -r requirements.txt

echo "✓ Python dependencies installed"

# 3. Vendor a static ffmpeg/ffprobe for the motion renderer.
#
# Render's native Python runtime has no ffmpeg and no apt access, so the
# binaries come in as a static build. Local development is unaffected:
# motion_render.py prefers $FFMPEG_BIN, then ./bin/, then PATH (Homebrew).
#
# Deliberately non-fatal. Without ffmpeg the app must still start and report
# the motion feature as unavailable — a failed download should not take the
# whole deploy down.
FFMPEG_RELEASE="${FFMPEG_RELEASE_URL:-https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz}"

if [ -x "bin/ffmpeg" ] && [ -x "bin/ffprobe" ]; then
  echo "✓ ffmpeg already vendored — skipping download"
elif [ "${SKIP_FFMPEG_DOWNLOAD:-0}" = "1" ]; then
  echo "⚠ SKIP_FFMPEG_DOWNLOAD=1 — motion rendering will be unavailable"
else
  echo "→ Fetching static ffmpeg…"
  mkdir -p bin
  tmp_dir="$(mktemp -d)"
  if curl -fsSL --retry 3 --retry-delay 2 "$FFMPEG_RELEASE" -o "$tmp_dir/ffmpeg.tar.xz"; then
    # sha256sum ist der Linux-Name (Render), shasum der von macOS. Fehlt das
    # gewaehlte Werkzeug, bliebe die Variable leer — und weil `cut` in der Pipe
    # erfolgreich ist, greift `set -o errexit` nicht. Mit gesetztem
    # FFMPEG_SHA256 wuerde der Vergleich dann IMMER fehlschlagen und die
    # Bewegtbild-Funktion waere in Produktion still verschwunden.
    if command -v sha256sum >/dev/null 2>&1; then
      actual_sha="$(sha256sum "$tmp_dir/ffmpeg.tar.xz" | cut -d' ' -f1)"
    else
      actual_sha="$(shasum -a 256 "$tmp_dir/ffmpeg.tar.xz" | cut -d' ' -f1)"
    fi
    if [ -z "$actual_sha" ]; then
      echo "⚠ konnte keine Prüfsumme bilden — Prüfung wird übersprungen"
    fi
    echo "  sha256: $actual_sha"

    # Der Tarball wird entpackt und AUSGEFUEHRT auf einer Instanz, in deren
    # Umgebung GEMINI_API_KEY und SUPABASE_KEY stehen. Ist FFMPEG_SHA256
    # gesetzt, wird gegen diesen Wert geprueft und bei Abweichung abgebrochen.
    # Ohne die Variable laeuft es wie bisher weiter — die Alternative waere ein
    # fest verdrahteter Hash, der bei jedem Upstream-Release still den Deploy
    # bricht. Der Hash wird oben ausgegeben, damit er sich pinnen laesst.
    if [ -n "${FFMPEG_SHA256:-}" ] && [ -n "$actual_sha" ] && [ "$actual_sha" != "$FFMPEG_SHA256" ]; then
      echo "⚠ ffmpeg checksum mismatch — erwartet $FFMPEG_SHA256, nicht installiert"
    elif tar -xJf "$tmp_dir/ffmpeg.tar.xz" -C "$tmp_dir" --strip-components=1 \
         && mv "$tmp_dir/ffmpeg" "$tmp_dir/ffprobe" bin/; then
      chmod +x bin/ffmpeg bin/ffprobe
      echo "✓ ffmpeg vendored → bin/ ($(bin/ffmpeg -version | head -1))"
    else
      echo "⚠ ffmpeg extraction failed — motion rendering will be unavailable"
    fi
  else
    echo "⚠ ffmpeg download failed — motion rendering will be unavailable"
  fi
  rm -rf "$tmp_dir"
fi

echo "═══════════════════════════════════════════════"
echo "  Build complete!"
echo "═══════════════════════════════════════════════"
