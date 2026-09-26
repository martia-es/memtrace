#!/bin/bash
# Quick start script for load testing

set -e

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3."
    exit 1
fi

# Check if dependencies are installed
if ! python3 -c "import httpx" 2>/dev/null; then
    echo "📦 Installing dependencies..."
    pip install -r requirements.txt
fi

echo "🚀 Starting load test..."
python3 load_test.py "$@"
