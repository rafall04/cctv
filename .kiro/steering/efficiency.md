---
inclusion: always
---

# Efficiency Rules - CRITICAL

## Core Principle: MINIMAL ACTION, MAXIMUM IMPACT

### ❌ NEVER DO (Waste of Time)

1. **Jangan buat file dokumentasi yang tidak diminta:**
   - ❌ `*_TROUBLESHOOTING.md`
   - ❌ `*_FIX_SUMMARY.md`
   - ❌ `*_GUIDE.md`
   - ❌ `CHANGELOG.md`
   - ❌ Status/progress markdown files

2. **Jangan buat deployment scripts untuk hal sederhana:**
   - ❌ Script bash untuk 1-2 command
   - ❌ Script untuk restart service
   - ❌ Script untuk backup file
   - ✅ Cukup kasih command langsung ke user

3. **Jangan buat multiple files untuk satu fix:**
   - ❌ Fix script + troubleshooting doc + summary doc
   - ✅ Cukup fix masalahnya, push, done

4. **Jangan verbose explanation:**
   - ❌ Panjang lebar explain root cause
   - ❌ Multiple sections dengan formatting berlebihan
   - ✅ Langsung ke solusi

### ✅ ALWAYS DO (Efficient)

1. **Langsung fix masalah:**
   - Identifikasi masalah
   - Edit file yang perlu diubah
   - Push ke GitHub
   - Kasih command deployment (1-3 baris)

2. **Minimal response:**
   - 1-2 kalimat explain masalah
   - Show file changes
   - Command untuk deploy
   - Done

3. **Only create files when:**
   - User explicitly asks
   - File is part of actual codebase (not documentation)
   - File is configuration/code that will be used

### Workflow Template

```
User: "Fix X tidak jalan"

Response:
"Masalah: [1 kalimat]
Fix: [edit file]
Deploy: [1-3 command]"

DONE. No extra files, no long explanation.
```

### Example - WRONG (What I Did)

```
1. Analyze masalah (verbose)
2. Create TROUBLESHOOTING.md
3. Create FIX_SUMMARY.md
4. Create fix-script-1.sh
5. Create fix-script-2.sh
6. Long explanation
7. Push

Result: 5 files, 10 minutes wasted
```

### Example - CORRECT (What I Should Do)

```
1. Edit deployment/nginx.conf (add location block)
2. Push
3. Tell user: "Run: nginx -t && systemctl reload nginx"

Result: 1 file, 1 minute
```

## Specific Rules

### For Bug Fixes
- Edit code
- Push
- Give 1-line deploy command
- DONE

### For Configuration Changes
- Edit config file
- Push
- Give reload command
- DONE

### For New Features
- Write minimal code
- Push
- Give test command
- DONE

### For Deployment Issues
- Fix the actual issue
- Push
- Give deploy command (max 3 lines)
- DONE

## Red Flags (Stop Immediately)

If you're about to:
- Create a markdown file with "TROUBLESHOOTING" in name → STOP
- Create a markdown file with "SUMMARY" in name → STOP
- Create a bash script for <5 commands → STOP
- Write >10 lines of explanation → STOP
- Create multiple files for one fix → STOP

## Exceptions (When Verbose is OK)

- User explicitly asks for documentation
- Creating actual project documentation (README.md for new project)
- Complex architectural changes that need explanation
- User asks "explain why"

## Summary

**Default Mode: MINIMAL**
- Fix code
- Push
- Deploy command
- DONE

**Only be verbose when user asks.**
