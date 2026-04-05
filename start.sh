#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:$PATH"
echo "Starting X2RedNote..."
npx concurrently "cd server && node --watch index.js" "cd client && npx vite"
