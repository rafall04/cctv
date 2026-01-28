---
inclusion: always
---

# No Unnecessary Files Rule

## CRITICAL: Only Create Essential Code Files

### ❌ NEVER Create These Files

1. **Bash Scripts** (`.sh`)
   - Deployment scripts
   - Fix scripts
   - Utility scripts
   - Exception: Only if explicitly requested by user

2. **Markdown Documentation** (`.md`)
   - Usage guides
   - Technical documentation
   - Troubleshooting guides
   - Fix summaries
   - Exception: Only if explicitly requested by user

3. **Summary Files**
   - Status reports
   - Progress tracking
   - Changelog files

### ✅ ONLY Create These Files

1. **Source Code**
   - `.js`, `.jsx`, `.ts`, `.tsx`
   - `.css`, `.scss`
   - `.html`

2. **Configuration**
   - `.json`, `.yml`, `.yaml`
   - `.env.example`
   - Config files that are actually used by the application

3. **Database**
   - Migration files
   - Schema files
   - Seed files

### Workflow Rules

#### When User Reports a Bug
```
❌ WRONG:
1. Create TROUBLESHOOTING.md
2. Create fix-bug.sh
3. Create BUG_ANALYSIS.md
4. Fix the code
5. Create DEPLOYMENT.md

✅ CORRECT:
1. Fix the code
2. git add, commit, push
3. Done
```

#### When Adding a Feature
```
❌ WRONG:
1. Create FEATURE_SPEC.md
2. Write code
3. Create USAGE_GUIDE.md
4. Create deploy-feature.sh
5. git push

✅ CORRECT:
1. Write code
2. git add, commit, push
3. Done
```

#### When Deploying
```
❌ WRONG:
Create deployment/deploy-xyz.sh with commands

✅ CORRECT:
Tell user the commands directly:
"Run these commands on server:
cd /var/www/project
git pull
npm run build
pm2 restart app"
```

### Exception Cases

User explicitly asks:
- "Create a deployment script"
- "Write documentation for this feature"
- "Make a usage guide"

Only then create the requested file.

### Cleanup Rule

If you accidentally created unnecessary files:
1. Delete them immediately
2. Commit the deletion
3. Push to GitHub

### Summary

**Default mode: CODE ONLY**
- Fix bugs → edit code → push
- Add features → write code → push
- Deploy → tell user commands

**No intermediate files unless explicitly requested.**
