# Execution Rules & Clean Code Standards

## Phased Execution Policy

### When to Use Phases
- Large deployments or installations
- Multiple file modifications (>10 files)
- Heavy compilation tasks (npm install with native modules)
- Database migrations
- Any task that may cause device hang on limited hardware

### Phase Documentation Requirements
Before starting phased work:
1. Create brief status note in conversation
2. List completed phases
3. List remaining phases
4. Note current state (what's working, what's pending)

### Phase Structure
```
Phase 1: [Name] - [Brief description]
Phase 2: [Name] - [Brief description]
...
```

### Between Phases
- Commit and push changes
- Verify previous phase completed successfully
- Wait for user confirmation before continuing

### Phase Naming Convention
- `Phase X: [Action] - [Target]`
- Example: `Phase 2: Install - Backend Dependencies`

## Clean Code Standards

### No Unnecessary Files
- DO NOT create summary .md files unless explicitly requested
- DO NOT create documentation files for completed work
- DO NOT create changelog or status files automatically

### Code Comments
- Remove TODO comments after completing the task
- Remove debug comments before committing
- Keep only essential documentation comments
- No commented-out code blocks

### File Cleanup
- Remove unused imports
- Remove empty files
- Remove duplicate configurations
- Remove test/debug files after use

### What to Avoid
```javascript
// ❌ BAD - Unnecessary comments
// This function gets all cameras
// It returns an array of camera objects
// Created on 2024-01-01
export function getAllCameras() {
    // Get cameras from database
    // Return the result
    return db.query('SELECT * FROM cameras');
}

// ✅ GOOD - Clean, self-documenting code
export function getAllCameras() {
    return db.query('SELECT * FROM cameras');
}
```

### Acceptable Comments
- Complex algorithm explanations
- Security-related warnings
- API documentation (JSDoc for public functions)
- Configuration explanations in .env files

### File Organization
- One purpose per file
- No mixed concerns
- Clear, descriptive file names
- Remove temporary/fix scripts after deployment

## Response Style

### Keep Responses Minimal
- No lengthy summaries
- No bullet point recaps
- State what was done in 1-2 sentences
- Move to next task immediately

### Progress Updates
- Brief status only
- No repetition of previous messages
- Focus on actionable next steps
