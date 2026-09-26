#!/bin/bash
# Run load test with real MemTrace instrumentation

set -e

# Ensure the project is built
if [ ! -d "sdk/python/.venv" ]; then
    echo "⚠️  Virtual environment not found. Run this from the project root:"
    echo "   cd /Users/marta/Proyectos/MemTrace"
    exit 1
fi

# Activate venv if needed
if [ -f "sdk/python/.venv/bin/activate" ]; then
    source sdk/python/.venv/bin/activate
fi

echo "🚀 Starting agent load test with real MemTrace instrumentation..."
python3 load-testing/agent_load_test.py "$@"
