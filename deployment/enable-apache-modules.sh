#!/bin/bash
# Enable Apache Modules for aaPanel
# Run as root: bash enable-apache-modules.sh

set -e

echo "🔧 Enabling Apache Modules for aaPanel"
echo "========================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Check root
if [ "$EUID" -ne 0 ]; then 
    print_error "Please run as root"
    exit 1
fi

# Find Apache config
APACHE_CONF="/www/server/apache/conf/httpd.conf"

if [ ! -f "$APACHE_CONF" ]; then
    print_error "Apache config not found at: $APACHE_CONF"
    print_info "Looking for alternative locations..."
    
    # Try alternative paths
    if [ -f "/etc/apache2/apache2.conf" ]; then
        APACHE_CONF="/etc/apache2/apache2.conf"
        print_info "Found at: $APACHE_CONF"
    elif [ -f "/etc/httpd/conf/httpd.conf" ]; then
        APACHE_CONF="/etc/httpd/conf/httpd.conf"
        print_info "Found at: $APACHE_CONF"
    else
        print_error "Cannot find Apache config file"
        exit 1
    fi
fi

print_success "Apache config: $APACHE_CONF"

# Backup config
BACKUP_FILE="${APACHE_CONF}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$APACHE_CONF" "$BACKUP_FILE"
print_success "Backup created: $BACKUP_FILE"

# Required modules
MODULES=(
    "proxy_module modules/mod_proxy.so"
    "proxy_http_module modules/mod_proxy_http.so"
    "proxy_wstunnel_module modules/mod_proxy_wstunnel.so"
    "headers_module modules/mod_headers.so"
    "rewrite_module modules/mod_rewrite.so"
)

echo ""
print_info "Enabling required modules..."

CHANGES_MADE=0

for module_line in "${MODULES[@]}"; do
    MODULE_NAME=$(echo $module_line | cut -d' ' -f1)
    MODULE_PATH=$(echo $module_line | cut -d' ' -f2)
    
    # Check if module line exists (commented or not)
    if grep -q "LoadModule $MODULE_NAME $MODULE_PATH" "$APACHE_CONF"; then
        # Check if it's commented
        if grep -q "^#.*LoadModule $MODULE_NAME $MODULE_PATH" "$APACHE_CONF"; then
            # Uncomment it
            sed -i "s|^#.*LoadModule $MODULE_NAME $MODULE_PATH|LoadModule $MODULE_NAME $MODULE_PATH|g" "$APACHE_CONF"
            print_success "Enabled: $MODULE_NAME"
            CHANGES_MADE=1
        else
            print_info "Already enabled: $MODULE_NAME"
        fi
    else
        # Module line doesn't exist, add it
        # Find the LoadModule section and add after last LoadModule
        LAST_LOAD_MODULE=$(grep -n "^LoadModule" "$APACHE_CONF" | tail -1 | cut -d: -f1)
        if [ -n "$LAST_LOAD_MODULE" ]; then
            sed -i "${LAST_LOAD_MODULE}a LoadModule $MODULE_NAME $MODULE_PATH" "$APACHE_CONF"
            print_success "Added: $MODULE_NAME"
            CHANGES_MADE=1
        else
            print_error "Cannot find LoadModule section in config"
        fi
    fi
done

if [ $CHANGES_MADE -eq 0 ]; then
    print_info "No changes needed - all modules already enabled"
else
    echo ""
    print_info "Testing Apache configuration..."
    
    # Test config
    if apache2 -t 2>/dev/null || httpd -t 2>/dev/null; then
        print_success "Apache configuration is valid"
        
        echo ""
        print_info "Restarting Apache..."
        systemctl restart apache2 2>/dev/null || systemctl restart httpd 2>/dev/null
        
        if systemctl is-active --quiet apache2 2>/dev/null || systemctl is-active --quiet httpd 2>/dev/null; then
            print_success "Apache restarted successfully"
        else
            print_error "Apache failed to restart"
            print_info "Restoring backup..."
            cp "$BACKUP_FILE" "$APACHE_CONF"
            systemctl restart apache2 2>/dev/null || systemctl restart httpd 2>/dev/null
            exit 1
        fi
    else
        print_error "Apache configuration test failed"
        print_info "Restoring backup..."
        cp "$BACKUP_FILE" "$APACHE_CONF"
        exit 1
    fi
fi

echo ""
print_info "Verifying modules..."
apache2 -M 2>/dev/null | grep -E "proxy|headers|rewrite" || httpd -M 2>/dev/null | grep -E "proxy|headers|rewrite"

echo ""
echo "========================================"
print_success "Apache modules enabled successfully!"
echo "========================================"
echo ""
echo "Backup saved at: $BACKUP_FILE"
echo ""
echo "Next steps:"
echo "  1. Continue with: bash deployment/aapanel-install.sh"
echo "  2. Or configure Apache via aaPanel UI"
echo ""
