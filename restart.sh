#!/bin/bash

echo "🔄 Starting server restart process..."

# Kill any existing dev server processes
echo "⏹️  Stopping development server..."
pkill -f "vite" || true
sleep 2

# Clear node_modules cache (optional, uncomment if needed)
# echo "🧹 Clearing node_modules cache..."
# rm -rf node_modules/.vite

# Clear browser cache files if any exist
echo "🧹 Clearing cache..."
rm -rf dist
rm -rf .vite

# Restart the development server
echo "🚀 Restarting development server..."
pnpm run dev