# Root Artifact Audit - 2026-05-02

Purpose: Classifies local root-level debug and import/export artifacts so the repo stays clean before feature expansion.
Caller: Stabilization sprint hygiene task.
Deps: Root `.gitignore`, local import/export tooling, Android package/debug export workflow.
MainFuncs: Documents artifact classes and the intended repository policy for each class.
SideEffects: None; documentation only.

## Classification

| Pattern | Classification | Repository policy |
| --- | --- | --- |
| `/tmp_*` | Local scratch/debug output | Ignore; regenerate when needed |
| `/*.dec.txt` | Decoded debug text | Ignore; may expose extracted config or package data |
| `/*.sec` | Security/export artifact | Ignore; keep local only |
| `/*.apk` | Android package artifact | Ignore; binary build/import artifact |
| `/*_import_*.json` | Import batch payload | Ignore; may contain environment-specific camera data |
| `/*_raw_*.json` | Raw export/debug payload | Ignore; may contain sensitive source data |
| `/*_catalog_*.json` | Generated catalog/debug payload | Ignore; regenerate from source |
| `/cctv_backup_*.json` | Local backup export | Ignore; backup data is environment-specific |
| `/private_exports/` | Local private export directory | Ignore; may contain sensitive operational data |

## Notes

No tracked files were removed in this task. The change only prevents future accidental staging of local artifacts.
