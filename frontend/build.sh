#!/bin/bash
# Simple build script for frontend
cd "$(dirname "$0")"
mkdir -p dist

# Build Tailwind CSS
echo "Building Tailwind CSS..."
npx tailwindcss -i ./src/style.css -o ./dist/style.css --minify

# Copy other files
cp -r src/*.html dist/ 2>/dev/null || true
cp -r src/js dist/ 2>/dev/null || true
echo "Frontend build complete"
