# Database API Rules

## CRITICAL: Database Helper Functions

File `backend/database/database.js` menyediakan helper functions berikut:

### Available Exports
```javascript
// ✅ CORRECT - Available exports
import { query, queryOne, execute, transaction, db } from '../database/database.js';

// ❌ WRONG - These do NOT exist
import { run } from '../database/database.js';  // NO! Use 'execute'
import { get } from '../database/database.js';  // NO! Use 'queryOne'
import { all } from '../database/database.js';  // NO! Use 'query'
```

### Function Usage

#### query() - SELECT multiple rows
```javascript
import { query } from '../database/database.js';

// Returns array of objects
const cameras = query('SELECT * FROM cameras WHERE enabled = ?', [1]);
```

#### queryOne() - SELECT single row
```javascript
import { queryOne } from '../database/database.js';

// Returns single object or undefined
const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [1]);
```

#### execute() - INSERT/UPDATE/DELETE
```javascript
import { execute } from '../database/database.js';

// Returns { changes, lastInsertRowid }
const result = execute('INSERT INTO cameras (name) VALUES (?)', ['Camera 1']);
const result = execute('UPDATE cameras SET name = ? WHERE id = ?', ['New Name', 1]);
const result = execute('DELETE FROM cameras WHERE id = ?', [1]);
```

#### transaction() - Multiple operations
```javascript
import { transaction } from '../database/database.js';

const insertMany = transaction((items) => {
    const stmt = db.prepare('INSERT INTO cameras (name) VALUES (?)');
    for (const item of items) {
        stmt.run(item.name);
    }
});

insertMany([{ name: 'Cam1' }, { name: 'Cam2' }]);
```

## Common Mistakes

### ❌ WRONG: Using 'run'
```javascript
import { run } from '../database/database.js';  // ERROR: run is not exported
const result = run('INSERT INTO cameras (name) VALUES (?)', ['Camera']);
```

### ✅ CORRECT: Using 'execute'
```javascript
import { execute } from '../database/database.js';
const result = execute('INSERT INTO cameras (name) VALUES (?)', ['Camera']);
```

### ❌ WRONG: Using 'get'
```javascript
import { get } from '../database/database.js';  // ERROR: get is not exported
const camera = get('SELECT * FROM cameras WHERE id = ?', [1]);
```

### ✅ CORRECT: Using 'queryOne'
```javascript
import { queryOne } from '../database/database.js';
const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [1]);
```

## Verification Checklist

Before creating new service files:
- [ ] Import only available exports: `query`, `queryOne`, `execute`, `transaction`, `db`
- [ ] Use `execute()` for INSERT/UPDATE/DELETE (not `run()`)
- [ ] Use `queryOne()` for single row SELECT (not `get()`)
- [ ] Use `query()` for multiple rows SELECT (not `all()`)
- [ ] Always use parameterized queries (second argument array)

## Quick Reference

| Operation | Function | Returns |
|-----------|----------|---------|
| SELECT multiple | `query(sql, params)` | Array of objects |
| SELECT single | `queryOne(sql, params)` | Object or undefined |
| INSERT | `execute(sql, params)` | `{ changes, lastInsertRowid }` |
| UPDATE | `execute(sql, params)` | `{ changes, lastInsertRowid }` |
| DELETE | `execute(sql, params)` | `{ changes, lastInsertRowid }` |
| Transaction | `transaction(callback)` | Transaction function |
