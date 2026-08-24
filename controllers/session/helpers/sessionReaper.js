const fs = require('fs');
const path = require('path');
const { sessions } = require('../state');
const { closeSession } = require('../handlers/closeSession');

// Sessions only ever get torn down when a caller explicitly calls
// DELETE /api/session/:id. Anything that forgets to - a crashed worker, an
// aborted job, a caller that just moved on - leaks a whole Chrome process tree
// (~700MB-1GB resident each) plus its on-disk profile, forever. Observed in
// practice: 5.4GB of resident Chrome across sessions idle for 2-3.5 hours, with
// 42 abandoned profile directories going back a week. Once the host is that
// starved, page loads stop completing - heavy pages (a Google SERP) return
// headers and then stall with the renderer wedged, so every JS-evaluate call
// hangs and the caller sees "no results" with no error to explain it.
const IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_TIMEOUT_MS) || 30 * 60 * 1000;
const REAPER_INTERVAL_MS = Number(process.env.SESSION_REAPER_INTERVAL_MS) || 5 * 60 * 1000;

// Startup sweep only: a profile directory whose session died with the process
// that owned it. Deliberately much older than IDLE_TIMEOUT_MS because another
// API instance may be running against the same checkout, and its live sessions'
// directories must not be deleted out from under it - Chrome touches a profile
// continuously while it's open, so a stale mtime is the safe signal.
const STALE_PROFILE_MAX_AGE_MS = Number(process.env.STALE_PROFILE_MAX_AGE_MS) || 2 * 60 * 60 * 1000;
const SESSIONS_DIR = path.resolve(__dirname, '../../../sessions');

const lastTouched = (session) => Math.max(
    session.lastActivity || 0,
    session.lastUsed || 0,
    session.created || 0
);

/**
 * Close sessions that no caller has touched within IDLE_TIMEOUT_MS.
 * @returns {Promise<string[]>} the session ids that were reaped
 */
async function reapIdleSessions(now = Date.now()) {
    const expired = [];
    for (const [sessionId, session] of sessions.entries()) {
        const idleFor = now - lastTouched(session);
        if (idleFor > IDLE_TIMEOUT_MS) expired.push([sessionId, idleFor]);
    }

    for (const [sessionId, idleFor] of expired) {
        console.log(`Reaping idle session ${sessionId} (idle ${Math.round(idleFor / 60000)}m)`);
        try {
            // closeSession also removes the ephemeral profile directory.
            await closeSession(sessionId);
        } catch (error) {
            console.error(`Error reaping session ${sessionId}:`, error.message);
        }
    }

    return expired.map(([sessionId]) => sessionId);
}

/**
 * Remove ephemeral profile directories left behind by sessions whose process
 * died before it could clean up. Startup only - never while sessions are live.
 * @returns {number} how many directories were removed
 */
function sweepStaleProfiles(now = Date.now()) {
    let removed = 0;
    let entries;
    try {
        entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('Profile sweep failed:', error.message);
        return 0;
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('ephemeral-')) continue;
        const dir = path.join(SESSIONS_DIR, entry.name);
        try {
            if (now - fs.statSync(dir).mtimeMs < STALE_PROFILE_MAX_AGE_MS) continue;
            fs.rmSync(dir, { recursive: true, force: true });
            removed++;
        } catch (error) {
            console.error(`Could not remove stale profile ${entry.name}:`, error.message);
        }
    }

    if (removed) console.log(`Removed ${removed} stale ephemeral profile director${removed === 1 ? 'y' : 'ies'}`);
    return removed;
}

/**
 * Start the periodic idle-session reaper and run the one-off startup sweep.
 * @returns {NodeJS.Timeout} the interval handle (unref'd so it can't hold the
 *          process open on shutdown)
 */
function startSessionReaper() {
    sweepStaleProfiles();

    const timer = setInterval(() => {
        reapIdleSessions().catch((error) => console.error('Session reaper error:', error.message));
    }, REAPER_INTERVAL_MS);
    timer.unref();

    console.log(`Session reaper started (idle timeout ${Math.round(IDLE_TIMEOUT_MS / 60000)}m, every ${Math.round(REAPER_INTERVAL_MS / 60000)}m)`);
    return timer;
}

module.exports = { startSessionReaper, reapIdleSessions, sweepStaleProfiles, IDLE_TIMEOUT_MS };
