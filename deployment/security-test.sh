#!/bin/bash
# RAF NET CCTV - Security Test Script
# Tests if sensitive files are properly blocked

echo "🔒 RAF NET CCTV - Security Test"
echo "================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Base URL (change this to your domain)
BASE_URL="${1:-https://cctv.raf.my.id}"

echo "Testing URL: $BASE_URL"
echo ""

# Counter
PASSED=0
FAILED=0

# Function to test URL
test_url() {
    local url="$1"
    local description="$2"
    
    echo -n "Testing: $description... "
    
    # Use curl to test (follow redirects, show HTTP code)
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -L "$url" 2>/dev/null)
    
    # Should return 404 or 403 (blocked)
    if [ "$HTTP_CODE" = "404" ] || [ "$HTTP_CODE" = "403" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $HTTP_CODE - Blocked)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $HTTP_CODE - NOT Blocked!)"
        FAILED=$((FAILED + 1))
    fi
}

echo "🔍 Testing sensitive file access..."
echo ""

# Test .env files
test_url "$BASE_URL/.env" ".env file"
test_url "$BASE_URL/backend/.env" "backend/.env file"
test_url "$BASE_URL/frontend/.env" "frontend/.env file"

# Test .git directory
test_url "$BASE_URL/.git/config" ".git/config file"
test_url "$BASE_URL/.git/HEAD" ".git/HEAD file"

# Test backup files
test_url "$BASE_URL/config.php.bak" "config.php.bak file"
test_url "$BASE_URL/database.sql" "database.sql file"
test_url "$BASE_URL/backup.old" "backup.old file"

# Test .htaccess
test_url "$BASE_URL/.htaccess" ".htaccess file"

# Test node_modules
test_url "$BASE_URL/node_modules/package.json" "node_modules access"

# Test package files
test_url "$BASE_URL/package.json" "package.json file"
test_url "$BASE_URL/package-lock.json" "package-lock.json file"

# Test database files
test_url "$BASE_URL/backend/data/cctv.db" "database file"

# Test source directories
test_url "$BASE_URL/src/index.js" "src directory access"
test_url "$BASE_URL/backend/server.js" "backend source access"

echo ""
echo "================================"
echo "Test Results:"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All security tests passed!${NC}"
    echo "Your application is properly secured."
    exit 0
else
    echo -e "${RED}❌ Some security tests failed!${NC}"
    echo "Please check Nginx configuration and reload:"
    echo "  sudo nginx -t"
    echo "  sudo systemctl reload nginx"
    exit 1
fi
