const fs = require('fs');
const path = require('path');

const PROFILE_LOCK_FILES = [
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'DevToolsActivePort'
];

const resolveProfileDir = (userDataDir) => {
    if (!userDataDir) {
        return null;
    }

    return path.resolve(process.cwd(), userDataDir);
};

const getLockPid = (profileDir) => {
    const lockPath = path.join(profileDir, 'SingletonLock');

    try {
        const lockTarget = fs.readlinkSync(lockPath);
        const match = lockTarget.match(/-(\d+)$/);
        return match ? Number(match[1]) : null;
    } catch (error) {
        return null;
    }
};

const isProcessRunning = (pid) => {
    if (!pid) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
};

const cleanupStaleProfileLocks = (userDataDir, logger = console) => {
    const profileDir = resolveProfileDir(userDataDir);

    if (!profileDir || !fs.existsSync(profileDir)) {
        return false;
    }

    const lockPid = getLockPid(profileDir);

    if (isProcessRunning(lockPid)) {
        logger.warn(`Browser profile is already in use by process ${lockPid}: ${profileDir}`);
        return false;
    }

    let removed = false;

    for (const fileName of PROFILE_LOCK_FILES) {
        const filePath = path.join(profileDir, fileName);

        try {
            if (fs.existsSync(filePath)) {
                fs.rmSync(filePath, { force: true });
                removed = true;
            }
        } catch (error) {
            logger.warn(`Failed to remove stale browser profile file ${filePath}: ${error.message}`);
        }
    }

    if (removed) {
        logger.log(`Removed stale browser profile locks from ${profileDir}`);
    }

    return removed;
};

module.exports = {
    cleanupStaleProfileLocks,
    resolveProfileDir
};
