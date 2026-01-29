#!/bin/bash
# RAF NET CCTV - Security Cleanup Script
# Removes sensitive files that should not be in production

echo "🔒 RAF NET CCTV - Security Cleanup"
echo "=================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counter
REMOVED=0

# Function to remove file if exists
remove_if_exists() {
    if [ -f "$1" ]; then
        echo -e "${YELLOW}Removing: $1${NC}"
        rm -f "$1"
        REMOVED=$((REMOVED + 1))
    fi
}

# Function to remove directory if exists
remove_dir_if_exists() {
    if [ -d "$1" ]; then
        echo -e "${YELLOW}Removing directory: $1${NC}"
        rm -rf "$1"
        REMOVED=$((REMOVED + 1))
    fi
}

echo "Scanning for sensitive files..."
echo ""

# Remove backup files
echo "🔍 Checking for backup files..."
find /var/www/rafnet-cctv -type f \( -name "*.bak" -o -name "*.backup" -o -name "*.old" -o -name "*.orig" -o -name "*.save" \) -exec rm -f {} \; 2>/dev/null
echo -e "${GREEN}✓ Backup files cleaned${NC}"

# Remove SQL dumps
echo "🔍 Checking for SQL dumps..."
find /var/www/rafnet-cctv -type f -name "*.sql" -exec rm -f {} \; 2>/dev/null
echo -e "${GREEN}✓ SQL dumps cleaned${NC}"

# Remove swap files
echo "🔍 Checking for swap files..."
find /var/www/rafnet-cctv -type f \( -name "*.swp" -o -name "*.swo" -o -name "*~" \) -exec rm -f {} \; 2>/dev/null
echo -e "${GREEN}✓ Swap files cleaned${NC}"

# Remove .env files from public directories (keep in backend root)
echo "🔍 Checking for exposed .env files..."
find /var/www/rafnet-cctv/frontend/dist -type f -name ".env*" -exec rm -f {} \; 2>/dev/null
echo -e "${GREEN}✓ Exposed .env files cleaned${NC}"

# Remove node_modules from dist (should never be there)
echo "🔍 Checking for node_modules in dist..."
remove_dir_if_exists "/var/www/rafnet-cctv/frontend/dist/node_modules"
echo -e "${GREEN}✓ node_modules cleaned${NC}"

# Remove .git from dist (should never be there)
echo "🔍 Checking for .git in dist..."
remove_dir_if_exists "/var/www/rafnet-cctv/frontend/dist/.git"
echo -e "${GREEN}✓ .git cleaned${NC}"

# Remove package files from dist
echo "🔍 Checking for package files in dist..."
remove_if_exists "/var/www/rafnet-cctv/frontend/dist/package.json"
remove_if_exists "/var/www/rafnet-cctv/frontend/dist/package-lock.json"
echo -e "${GREEN}✓ Package files cleaned${NC}"

# Set proper permissions
echo ""
echo "🔒 Setting proper permissions..."
chmod 600 /var/www/rafnet-cctv/backend/.env 2>/dev/null
chmod 600 /var/www/rafnet-cctv/frontend/.env 2>/dev/null
chmod 600 /var/www/rafnet-cctv/backend/data/*.db 2>/dev/null
echo -e "${GREEN}✓ Permissions set${NC}"

echo ""
echo "=================================="
echo -e "${GREEN}✅ Security cleanup completed!${NC}"
echo ""
echo "Summary:"
echo "- Backup files: cleaned"
echo "- SQL dumps: cleaned"
echo "- Swap files: cleaned"
echo "- Exposed .env: cleaned"
echo "- node_modules in dist: cleaned"
echo "- .git in dist: cleaned"
echo "- Package files in dist: cleaned"
echo "- Permissions: secured"
echo ""
echo "⚠️  Remember to:"
echo "1. Reload Nginx: systemctl reload nginx"
echo "2. Test sensitive file access"
echo "3. Check application still works"
