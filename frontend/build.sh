#!/bin/bash
# Simple build script for frontend
cd "$(dirname "$0")"
mkdir -p dist
cp -r src/* dist/ 2>/dev/null || true
echo "Frontend files copied to dist"
