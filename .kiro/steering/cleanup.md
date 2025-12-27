# Cleanup Rules & Test File Management

## Test File Cleanup Policy

### MANDATORY: Delete Test Files After Planning Complete
- **ALWAYS delete all test files** when spec/planning phase is complete
- Test files are for validation during development only
- Production code should be clean without test artifacts
- No test files should remain in the repository after feature completion

### When to Delete Test Files
1. After all tasks in a spec are marked complete
2. After property-based tests have validated the implementation
3. Before final commit/push of a completed feature
4. When cleaning up after any development phase

### Test File Patterns to Delete
```bash
# Frontend test files
frontend/src/__tests__/*.test.js
frontend/src/__tests__/*.property.test.js

# Backend test files
backend/__tests__/*.test.js
backend/__tests__/*.property.test.js

# Any other test directories
**/__tests__/
**/*.test.js
**/*.spec.js
**/*.property.test.js
```

### Cleanup Commands

#### Windows (PowerShell)
```powershell
# Delete frontend test files
Remove-Item -Recurse -Force frontend/src/__tests__

# Delete backend test files
Remove-Item -Recurse -Force backend/__tests__

# Verify cleanup
Get-ChildItem -Recurse -Filter "*.test.js"
Get-ChildItem -Recurse -Filter "*.property.test.js"
```

#### Ubuntu 20.04 (Bash)
```bash
# Delete frontend test files
rm -rf frontend/src/__tests__

# Delete backend test files
rm -rf backend/__tests__

# Verify cleanup
find . -name "*.test.js" -type f
find . -name "*.property.test.js" -type f
```

## Unused File Cleanup Policy

### Files to Remove After Development
- Temporary fix scripts (*.sh in root that are one-time fixes)
- Debug/diagnostic files created during troubleshooting
- Backup files (*.backup, *.bak, *.old)
- Generated documentation not explicitly requested
- Empty or placeholder files

### Files to KEEP
- Source code files (*.js, *.jsx, *.ts, *.tsx)
- Configuration files (.env, *.config.js, *.yml)
- Documentation explicitly requested (README.md, SECURITY.md)
- Deployment scripts in deployment/ folder
- Steering rules in .kiro/steering/

### Cleanup Checklist
Before marking a feature complete:
- [ ] All test files deleted
- [ ] No temporary scripts remaining
- [ ] No backup files in repository
- [ ] No debug/console.log statements in production code
- [ ] No commented-out code blocks
- [ ] No TODO comments for completed tasks

## Auto-Cleanup Integration

### After Spec Completion
```bash
# Standard cleanup sequence after completing a spec
rm -rf frontend/src/__tests__
rm -rf backend/__tests__
git add .
git commit -m "Cleanup: Remove test files after spec completion"
git push origin main
```

### NPM Scripts for Cleanup
```json
{
  "scripts": {
    "cleanup:tests": "rm -rf src/__tests__",
    "cleanup:all": "rm -rf src/__tests__ && rm -rf ../__tests__"
  }
}
```

## Code Cleanliness Standards

### No Residual Test Code
- Remove test utilities from production bundles
- Remove test-only dependencies if not needed
- Remove mock files and fixtures
- Remove test configuration files (vitest.config.js can stay for future use)

### Clean Commit History
- Squash test-related commits when merging
- Use descriptive cleanup commit messages
- Keep repository history clean and meaningful
