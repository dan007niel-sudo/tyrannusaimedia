#!/usr/bin/env bash
# Tyrannus AI Media — Render Build Script
# Builds the React frontend and installs Python backend dependencies.

set -o errexit  # Exit on error

echo "═══════════════════════════════════════════════"
echo "  Tyrannus AI Media — Build"
echo "═══════════════════════════════════════════════"

# 1. Install Node.js dependencies & build frontend
echo "→ Installing Node.js dependencies..."
npm install

echo "→ Building React frontend..."
npm run build

echo "✓ Frontend built → dist/"

# 2. Install Python dependencies
echo "→ Installing Python dependencies..."
pip install -r requirements.txt

echo "✓ Python dependencies installed"
echo "═══════════════════════════════════════════════"
echo "  Build complete!"
echo "═══════════════════════════════════════════════"
