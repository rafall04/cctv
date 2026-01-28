# Git Workflow & Auto-Push Rules

## Core Git Policy

### MANDATORY Auto-Push Rule
- **ALWAYS push to GitHub** after ANY file modification
- **NO exceptions** - every change must be immediately synchronized
- **Auto-commit** with descriptive messages
- **Push to main branch** unless working on specific feature branch

## Auto-Push Implementation

### Standard Auto-Push Sequence

#### Windows PowerShell
```powershell
# CRITICAL: Use semicolons (;) not && in PowerShell
git add .
git commit -m "[TYPE]: [Description]"
git push origin main

# Or one-liner with semicolons
git add . ; git commit -m "Fix: Description" ; git push origin main
```

#### Ubuntu 20.04 Bash
```bash
# Use && for sequential execution with error checking
git add . && \
git commit -m "[TYPE]: [Description]" && \
git push origin main
```

### Commit Message Types
- `Fix:` - Bug fixes and error corrections
- `Feature:` - New functionality or enhancements
- `Update:` - Configuration, dependency, or content updates
- `Deploy:` - Deployment-related changes
- `Docs:` - Documentation updates
- `Refactor:` - Code restructuring without functionality changes
- `Auto:` - Automated updates or maintenance

## Platform-Specific Auto-Push Functions

### Windows (PowerShell)
```powershell
# CRITICAL: PowerShell does NOT support && operator
# Use semicolons (;) to separate commands

# Simple one-liner (use semicolons, not &&)
git add . ; git commit -m "Your message" ; git push origin main

# Function for better error handling
function Git-Push {
    param([string]$msg = "Auto-update")
    git add .
    if ($?) { git commit -m $msg }
    if ($?) { git push origin main }
    if ($?) { Write-Host "✅ Pushed: $msg" -ForegroundColor Green }
}

# Usage
Git-Push "Fix: Updated configuration"
```

### Ubuntu 20.04 (Bash)
```bash
# Add to ~/.bashrc or use directly
git_auto_push() {
    local message="$1"
    local branch="${2:-main}"
    
    if [[ -z "$message" ]]; then
        echo "❌ Error: Commit message required"
        echo "Usage: git_auto_push 'Your commit message' [branch]"
        return 1
    fi
    
    echo "🔄 Auto-pushing changes..."
    
    git add . && \
    git commit -m "$message" && \
    git push origin "$branch"
    
    if [[ $? -eq 0 ]]; then
        echo "✅ Successfully pushed: $message"
    else
        echo "❌ Failed to push changes"
        return 1
    fi
}

# Usage examples
git_auto_push "Deploy: Ubuntu 20.04 production deployment completed"
git_auto_push "Update: Modified MediaMTX configuration"
```

## Integration with Development Workflow

### After Code Changes
```powershell
# Windows PowerShell - use semicolons
git add . ; git commit -m "Fix: Resolved camera streaming issue" ; git push origin main
git add . ; git commit -m "Feature: Added new admin dashboard component" ; git push origin main
git add . ; git commit -m "Update: Modified API endpoint for better error handling" ; git push origin main
```

```bash
# Ubuntu 20.04 - use &&
git add . && git commit -m "Fix: Resolved camera streaming issue" && git push origin main
git add . && git commit -m "Feature: Added new admin dashboard component" && git push origin main
```

### After Configuration Changes
```bash
# Environment files, configs, etc.
git_auto_push "Update: Modified backend environment configuration"
git_auto_push "Deploy: Updated nginx configuration for production"
git_auto_push "Fix: Corrected MediaMTX YAML settings"
```

### After Deployment Scripts
```bash
# Any script modifications
git_auto_push "Deploy: Updated Ubuntu 20.04 deployment script"
git_auto_push "Fix: Corrected permissions in installation script"
git_auto_push "Update: Enhanced error handling in deployment"
```

## NPM Scripts Integration

### Backend package.json
```json
{
  "scripts": {
    "dev": "nodemon server.js",
    "start": "node server.js",
    "setup-db": "node database/setup.js",
    "git-push": "git add . && git commit -m 'Auto: Backend development changes' && git push origin main",
    "deploy-push": "git add . && git commit -m 'Deploy: Backend production deployment' && git push origin main"
  }
}
```

### Frontend package.json
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "git-push": "git add . && git commit -m 'Auto: Frontend development changes' && git push origin main",
    "build-push": "npm run build && git add . && git commit -m 'Deploy: Frontend production build' && git push origin main"
  }
}
```

## Automated Push in Scripts

### Deployment Script Template
```bash
#!/bin/bash
# Any deployment or fix script should end with auto-push

# ... deployment logic here ...

# MANDATORY: Auto-push at the end
echo ""
echo "🔄 Auto-pushing deployment changes to GitHub..."
git add .
git commit -m "Deploy: $(basename $0) completed - $(date '+%Y-%m-%d %H:%M:%S')"
git push origin main

if [[ $? -eq 0 ]]; then
    echo "✅ Deployment changes successfully pushed to GitHub"
else
    echo "❌ Failed to push deployment changes"
    exit 1
fi
```

### Development Script Template
```bash
#!/bin/bash
# Any development or fix script

# ... script logic here ...

# MANDATORY: Auto-push changes
echo ""
echo "🔄 Auto-pushing script changes to GitHub..."
git add .
git commit -m "Fix: $(basename $0) - $(date '+%Y-%m-%d %H:%M:%S')"
git push origin main

echo "✅ Changes pushed to GitHub"
```

## Pre-Push Validation

### Git Configuration Check
```bash
# Ensure git is properly configured
check_git_config() {
    if [[ -z $(git config user.name) ]] || [[ -z $(git config user.email) ]]; then
        echo "❌ Git user configuration missing"
        echo "Run: git config --global user.name 'Your Name'"
        echo "Run: git config --global user.email 'your.email@example.com'"
        return 1
    fi
    
    if [[ -z $(git remote get-url origin 2>/dev/null) ]]; then
        echo "❌ Git remote origin not configured"
        echo "Run: git remote add origin https://github.com/username/repository.git"
        return 1
    fi
    
    return 0
}
```

### Safe Push with Validation
```bash
safe_auto_push() {
    local message="$1"
    
    # Validate git configuration
    if ! check_git_config; then
        return 1
    fi
    
    # Check for changes
    if [[ -z $(git status --porcelain) ]]; then
        echo "ℹ️ No changes to push"
        return 0
    fi
    
    # Perform push
    git add . && \
    git commit -m "$message" && \
    git push origin main
    
    if [[ $? -eq 0 ]]; then
        echo "✅ Successfully pushed: $message"
    else
        echo "❌ Failed to push changes"
        return 1
    fi
}
```

## Error Recovery

### Push Failure Handling
```bash
# If push fails, try to resolve common issues
recover_push() {
    echo "🔄 Attempting to recover from push failure..."
    
    # Pull latest changes first
    git pull origin main --rebase
    
    if [[ $? -eq 0 ]]; then
        # Retry push
        git push origin main
        if [[ $? -eq 0 ]]; then
            echo "✅ Push recovered successfully"
        else
            echo "❌ Push still failing - manual intervention required"
        fi
    else
        echo "❌ Pull failed - manual intervention required"
    fi
}
```

## Mandatory Push Points

### 1. After File Modifications
- Any source code changes
- Configuration file updates
- Documentation changes
- Script modifications

### 2. After Testing
- Successful test completion
- Bug fixes verification
- Feature testing completion

### 3. After Deployment
- Production deployment completion
- Configuration updates
- Service restarts

### 4. End of Work Session
- Before closing development environment
- Before switching tasks
- Before system shutdown

## Repository Maintenance

### Regular Cleanup
```bash
# Weekly repository maintenance
git_maintenance() {
    echo "🧹 Performing repository maintenance..."
    
    # Clean up local branches
    git branch --merged | grep -v "\*\|main\|master" | xargs -n 1 git branch -d
    
    # Garbage collection
    git gc --prune=now
    
    # Push maintenance
    git_auto_push "Maintenance: Repository cleanup - $(date)"
    
    echo "✅ Repository maintenance completed"
}
```

This comprehensive Git workflow ensures that all changes are immediately synchronized with GitHub, maintaining a complete history of all modifications and deployments.