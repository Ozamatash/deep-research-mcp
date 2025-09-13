#!/bin/bash
set -e

echo "🔄 Updating Deep Research MCP Server..."

# Pull latest changes
git fetch origin
git pull origin main

# Install dependencies
npm install

# Build
npm run build

echo "✅ Deep Research MCP Server updated successfully"