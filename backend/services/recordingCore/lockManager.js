export class LockManager {
    constructor() {
        this.locks = new Set();
    }

    acquire(filePath) {
        this.locks.add(filePath);
    }

    release(filePath) {
        this.locks.delete(filePath);
    }

    isLocked(filePath) {
        return this.locks.has(filePath);
    }
}

export const lockManager = new LockManager();
