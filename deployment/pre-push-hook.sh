#!/bin/bash
set -e
echo "Running Pre-Push Release Gates..."

echo "[1/2] Running Backend Tests..."
cd backend
npm test -- --passWithNoTests
cd ..

echo "[2/2] Running Frontend Build..."
cd frontend
npm run build
cd ..

echo "✅ All Release Gates Passed!"
