#!/bin/bash

# =================================================================
# RAF NET CCTV - Ubuntu 20.04 Complete Fix Master Script
# =================================================================
# 
# This master script runs all 5 phases of Ubuntu 20.04 fixes
# 
# Usage (as root):
#   bash deployment/ubuntu-20.04-complete-fix.sh
# 
# Or run individual phases:
#   bash deployment/ubuntu-20.04-fix-phase1.sh
#   bash deployment/ubuntu-20.04-fix-phase2.sh
#   bash deployment/ubuntu-20.04-fix-phase3.sh
#   bash deployment/ubuntu-20.04-fix-phase4.sh
#   bash deployment/ubuntu-20.04-fix-phase5.sh
# 
# =================================================================

set -e

echo "🚀 RAF NET CCTV - Ubuntu 20.04 Complete Fix"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Running all 5 phases of Ubuntu 20.04 compatibility fixes"
echo ""

# Check if running as root (REQUIRED)
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script MUST be run as root"
   echo "   Run with: sudo bash deployment/ubuntu-20.04-complete-fix.sh"
   exit 1
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "📋 Phase Overview:"
echo "   Phase 1: System Dependencies & Build Environment"
echo "   Phase 2: Backend Dependencies & Database Setup"
echo "   Phase 3: Frontend Build & Configuration"
echo "   Phase 4: MediaMTX Configuration & Setup"
echo "   Phase 5: Nginx & PM2 Final Configuration"
echo ""

read -p "Continue with all phases? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted by user"
    exit 1
fi

# Run Phase 1
echo "🚀 Starting Phase 1..."
bash "$SCRIPT_DIR/ubuntu-20.04-fix-phase1.sh"

# Run Phase 2
echo "🚀 Starting Phase 2..."
bash "$SCRIPT_DIR/ubuntu-20.04-fix-phase2.sh"

# Run Phase 3
echo "🚀 Starting Phase 3..."
bash "$SCRIPT_DIR/ubuntu-20.04-fix-phase3.sh"

# Run Phase 4
echo "🚀 Starting Phase 4..."
bash "$SCRIPT_DIR/ubuntu-20.04-fix-phase4.sh"

# Run Phase 5
echo "🚀 Starting Phase 5..."
bash "$SCRIPT_DIR/ubuntu-20.04-fix-phase5.sh"

echo ""
echo "🎉 ALL PHASES COMPLETED SUCCESSFULLY!"
echo "   Your RAF NET CCTV system is now Ubuntu 20.04 compatible"