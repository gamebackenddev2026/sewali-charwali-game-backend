/**
 * FairPlay service: anomaly detection, device/IP tracking, risk scoring, and access control.
 * Used by auth, socket, table join, and post-match hooks.
 */
const { User, UserSession, AuditLog, BannedDevice, TableHistory, CoinTransferLog } = require('../models');
const { mongodb } = require('../utils');
const { getFairPlayConfig } = require('./config');

const fairPlay = {};

/**
 * Check if user is allowed to play (not banned, not in temp restriction window).
 * @param {Object} user - User doc or { _id, eStatus, eFlagLevel, dRestrictedUntil }
 * @returns {{ allowed: boolean, reason?: string }}
 */
fairPlay.isUserAllowedToPlay = function (user) {
    if (!user) return { allowed: false, reason: 'user_not_found' };
    if (user.eStatus === 'n') return { allowed: false, reason: 'banned' };
    if (user.eStatus === 'd') return { allowed: false, reason: 'deleted' };
    if (user.eFlagLevel === 'banned') return { allowed: false, reason: 'banned' };
    if (user.eFlagLevel === 'temp_restriction' && user.dRestrictedUntil && new Date(user.dRestrictedUntil) > new Date()) {
        return { allowed: false, reason: 'temp_restriction' };
    }
    return { allowed: true };
};

/**
 * Whole seconds until temp restriction ends; null if not in an active temp window.
 * @param {Object} user
 * @returns {number | null}
 */
fairPlay.getTempRestrictionSecondsRemaining = function (user) {
    if (!user || user.eFlagLevel !== 'temp_restriction' || !user.dRestrictedUntil) return null;
    const ms = new Date(user.dRestrictedUntil).getTime() - Date.now();
    if (ms <= 0) return null;
    return Math.max(1, Math.ceil(ms / 1000));
};

/**
 * Login / game middleware: banned or active temp restriction → message for res.reply; else null.
 * Temp restriction only while dRestrictedUntil is in the future (same as isUserAllowedToPlay).
 * @param {Object} user
 * @param {string} [locale]
 * @param {number} [httpCode] - default 401; use 403 for gameplay routes if needed
 * @returns {{ code: number, message: string } | null}
 */
fairPlay.getAuthRestrictionReply = function (user, locale = 'en', httpCode = 401) {
    if (!user) return null;
    const msg = globalThis.message;
    if (!msg) return null;
    if (user.eFlagLevel === 'banned') return msg.account_banned_fairplay('', locale);
    if (user.eFlagLevel === 'temp_restriction') {
        const sec = fairPlay.getTempRestrictionSecondsRemaining(user);
        if (sec == null) return null;
        return msg.account_temp_restriction_fairplay('', locale, sec, httpCode);
    }
    return null;
};

/**
 * Check if device is banned.
 * @param {string} deviceId
 * @returns {Promise<boolean>}
 */
fairPlay.isDeviceBanned = async function (deviceId) {
    if (!deviceId || typeof deviceId !== 'string') return false;
    const doc = await BannedDevice.findOne({ sDeviceId: deviceId.trim() }).lean();
    return !!doc;
};

/**
 * Record login session (device + IP) and run device/session checks.
 * Call from auth (login/social) and optionally from socket connect.
 * @param {string} userId - ObjectId string or ObjectId
 * @param {string} [deviceId]
 * @param {string} [ip]
 * @returns {Promise<{ multipleAccounts?: boolean, rapidSwitch?: boolean, rapidReloginSameDevice?: boolean, loginAbuseTempRestricted?: boolean }>} - flags if anomaly detected
 */
fairPlay.recordSession = async function (userId, deviceId, ip) {
    const config = await getFairPlayConfig();
    const id = mongodb.mongify(userId);
    if (!id) return {};

    await UserSession.create({
        iUserId: id,
        sDeviceId: deviceId && typeof deviceId === 'string' ? deviceId.trim() : null,
        sIp: ip && typeof ip === 'string' ? ip.trim() : null,
        dLoginAt: new Date(),
    });

    await User.updateOne(
        { _id: id },
        {
            $set: {
                sLastDeviceId: deviceId && typeof deviceId === 'string' ? deviceId.trim() : null,
                sLastIp: ip && typeof ip === 'string' ? ip.trim() : null,
            },
        }
    ).exec();

    const result = {};
    if (deviceId) {
        const count = await UserSession.distinct('iUserId', { sDeviceId: deviceId.trim() }).then((arr) => arr.length);
        if (count > config.MAX_ACCOUNTS_PER_DEVICE) {
            result.multipleAccounts = true;
            await fairPlay.incrementRiskScore(id.toString(), 'multiple_accounts_same_device', config.RISK_MULTIPLE_ACCOUNTS_SAME_DEVICE);
        }

        const recentLogins = await UserSession.find({ iUserId: id })
            .sort({ dLoginAt: -1 })
            .limit(config.RAPID_SWITCH_MIN_LOGINS + 2)
            .lean();
        if (recentLogins.length >= config.RAPID_SWITCH_MIN_LOGINS) {
            const windowStart = Date.now() - config.RAPID_SWITCH_WINDOW_MS;
            // Collect unique deviceIds from recentLogins (ensure array, not Set)
            const devicesArr = recentLogins
                .slice(0, config.RAPID_SWITCH_MIN_LOGINS)
                .map((s) => s.sDeviceId)
                .filter(Boolean);

            // If you want distinct devices only:
            const devices = Array.from(new Set(devicesArr));

            if (devices.length > 2) {
                const inWindow = recentLogins.filter((s) => new Date(s.dLoginAt).getTime() >= windowStart).length;
                if (inWindow >= config.RAPID_SWITCH_MIN_LOGINS) {
                    result.rapidSwitch = true;
                    await fairPlay.incrementRiskScore(id.toString(), 'rapid_account_switching', config.RISK_RAPID_ACCOUNT_SWITCH);
                }
            }

            // Same account repeatedly logging in from the same device in a short window
            // is suspicious (automation/replay), so add a focused risk increment.
            const sameDeviceRecent = recentLogins.slice(0, config.RAPID_SWITCH_MIN_LOGINS).filter((s) => (s.sDeviceId || null) === deviceId.trim());
            const sameDeviceInWindow = sameDeviceRecent.filter((s) => new Date(s.dLoginAt).getTime() >= windowStart).length;
            if (sameDeviceInWindow >= config.RAPID_SWITCH_MIN_LOGINS) {
                result.rapidReloginSameDevice = true;
                await fairPlay.incrementRiskScore(id.toString(), 'rapid_relogin_same_device', config.RISK_RAPID_ACCOUNT_SWITCH);
            }

            // Hard guardrail: same account + same device repeated login abuse
            // should force a temporary restriction after 10 attempts.
            const sameDeviceLoginCount = await UserSession.countDocuments({
                iUserId: id,
                sDeviceId: deviceId.trim(),
            });
            if (sameDeviceLoginCount >= 10) {
                const user = await User.findOne({ _id: id }, { eFlagLevel: 1 }).lean();
                if (user && user.eFlagLevel !== 'banned') {
                    await fairPlay.incrementRiskScore(id.toString(), 'same_device_repeated_login_abuse', config.RISK_RAPID_ACCOUNT_SWITCH);
                    const dRestrictedUntil = new Date(Date.now() + config.TEMP_RESTRICT_DURATION_MS);
                    await User.updateOne({ _id: id }, { $set: { eFlagLevel: 'temp_restriction', dFlaggedAt: new Date(), dRestrictedUntil } }).exec();
                    await AuditLog.create({
                        actionType: 'temp_ban',
                        iUserId: id,
                        sReason: 'same_device_repeated_login_abuse',
                        oMeta: { sameDeviceLoginCount, dRestrictedUntil },
                    }).catch(() => { });
                    result.loginAbuseTempRestricted = true;
                }
            }
        }
    }

    await AuditLog.create({
        actionType: 'session_record',
        iUserId: id,
        oMeta: { deviceId: deviceId || null, ip: ip || null },
    }).catch((e) => log.error('FairPlay audit log session_record failed', e?.message));

    return result;
};

/**
 * Increment user risk score and optionally elevate flag level / set restriction.
 * @param {string} userId
 * @param {string} reason
 * @param {number} points
 * @param {string} [adminId]
 */
fairPlay.incrementRiskScore = async function (userId, reason, points, adminId = null) {
    const config = await getFairPlayConfig();
    const id = mongodb.mongify(userId);
    if (!id) return;

    const user = await User.findOneAndUpdate({ _id: id }, { $inc: { nRiskScore: points } }, { new: true }).lean();

    if (!user) return;

    const newScore = user.nRiskScore || 0;

    await AuditLog.create({
        actionType: 'risk_increment',
        iUserId: id,
        iAdminId: adminId ? mongodb.mongify(adminId) : null,
        sReason: reason,
        oMeta: { points, newScore },
    }).catch((e) => log.error('FairPlay audit log risk_increment failed', e?.message));

    let flagLevel = user.eFlagLevel || 'none';
    let { dRestrictedUntil } = user;

    // To emit changes
    let emitPayload = null;
    let statusCode = 200; // Default OK

    if (newScore >= config.RISK_THRESHOLD_BAN) {
        flagLevel = 'banned';
        await User.updateOne({ _id: id }, { $set: { eFlagLevel: 'banned', eStatus: 'n', dFlaggedAt: new Date() } }).exec();
        await AuditLog.create({
            actionType: 'permanent_ban',
            iUserId: id,
            iAdminId: adminId ? mongodb.mongify(adminId) : null,
            sReason: `${reason}`,
        }).catch(() => { });
        emitPayload = {
            status: 'banned',
            message: 'Your account has been permanently banned due to abnormal risk score/activity. Please contact support.',
            reason,
            riskScore: newScore,
            code: 401, // Unauthorized – should logout user
        };
        statusCode = 401;
    } else if (newScore >= config.RISK_THRESHOLD_TEMP_RESTRICT && flagLevel !== 'banned') {
        flagLevel = 'temp_restriction';
        dRestrictedUntil = new Date(Date.now() + config.TEMP_RESTRICT_DURATION_MS);
        await User.updateOne({ _id: id }, { $set: { eFlagLevel: 'temp_restriction', dFlaggedAt: new Date(), dRestrictedUntil } }).exec();
        await AuditLog.create({
            actionType: 'temp_ban',
            iUserId: id,
            iAdminId: adminId ? mongodb.mongify(adminId) : null,
            sReason: `${reason}`,
            oMeta: { dRestrictedUntil },
        }).catch(() => { });
        emitPayload = {
            status: 'temp_restriction',
            message: 'Temporary restriction imposed due to risk score. Please try again after some time.',
            reason,
            restrictedUntil: dRestrictedUntil,
            riskScore: newScore,
            code: 403, // Forbidden – restrict usage
        };
        statusCode = 403;
    } else if (newScore >= config.RISK_THRESHOLD_WARNING && flagLevel === 'none') {
        await User.updateOne({ _id: id }, { $set: { eFlagLevel: 'warning', dFlaggedAt: new Date() } }).exec();
        await AuditLog.create({
            actionType: 'warning',
            iUserId: id,
            iAdminId: adminId ? mongodb.mongify(adminId) : null,
            sReason: `${reason}`,
        }).catch(() => { });
        emitPayload = {
            status: 'warning',
            message: 'Warning: Your activity is under review due to a raised risk score.',
            reason,
            riskScore: newScore,
            code: 200, // OK, but risky
        };
        statusCode = 200;
    }

    // Emit to user if flag/status changed with HTTP-style code for client logic (logout/restrict)
    if (emitPayload && globalThis._ && typeof _.privateEmit === 'function') {
        _.privateEmit(userId.toString?.() || userId, 'riskFlagChanged', emitPayload);

        // Optionally also send a separate logout/game-manage event in severe cases
        if (statusCode === 401 && typeof _.privateEmit === 'function') {
            // Tell the user to force logout
            _.privateEmit(userId.toString?.() || userId, 'forceLogout', {
                message: 'You have been logged out due to violation of FairPlay policy.',
                reason: emitPayload.message,
                code: 401,
            });
            // Emit a game management event if needed
            if (typeof _.emitToUserGameSession === 'function') {
                _.emitToUserGameSession(userId.toString?.() || userId, 'fairPlayKick', {
                    reason: 'banned',
                    message: emitPayload.message,
                });
            }
        } else if (statusCode === 403 && typeof _.privateEmit === 'function') {
            // Temporary restriction – suggest disable gameplay UI but not force logout
            _.privateEmit(userId.toString?.() || userId, 'fairPlayRestricted', {
                message: emitPayload.message,
                restrictedUntil: dRestrictedUntil,
                code: 403,
            });
            if (typeof _.emitToUserGameSession === 'function') {
                _.emitToUserGameSession(userId.toString?.() || userId, 'fairPlayRestrict', {
                    reason: 'temp_restriction',
                    message: emitPayload.message,
                    restrictedUntil: dRestrictedUntil,
                });
            }
        }
    }
};

/**
 * Match-end automated risk (afterMatchEnd): only for the **same user**, and only after enough **recent**
 * games in a rolling window — not lifetime stats. Public, VIP-only, and private tables all write to
 * TableHistory, so they share one rolling list per user (no separate mode counters).
 */
fairPlay.afterMatchEnd = async function (winnerId, playerIds, tableId, gameDurationMs) {
    const config = await getFairPlayConfig();
    if (!winnerId || !Array.isArray(playerIds) || playerIds.length === 0) return;

    const winnerObjId = mongodb.mongify(winnerId);
    const ids = playerIds.map((id) => mongodb.mongify(id)).filter(Boolean);
    if (!winnerObjId) return;

    try {
        const user = await User.findOne({ _id: winnerObjId }, { eFlagLevel: 1 }).lean();
        if (!user || user.eFlagLevel === 'banned') return;

        const rollingLimit = Math.max(1, Math.floor(config.FAIRPLAY_ROLLING_MATCH_COUNT));
        const minBeforeRisk = Math.max(1, Math.floor(config.FAIRPLAY_MIN_MATCHES_BEFORE_RISK));

        const rollingDocs = await TableHistory.find({ 'aPlayer.iUserId': winnerObjId }).sort({ dCreatedDate: -1 }).limit(rollingLimit).lean();

        const rollingPlayed = rollingDocs.length;
        if (rollingPlayed < minBeforeRisk) {
            return;
        }

        let nWonRolling = 0;
        for (const doc of rollingDocs) {
            if (doc.iWinnerId && doc.iWinnerId.toString() === winnerObjId.toString()) nWonRolling += 1;
        }
        const winStats = { nWon: nWonRolling, nPlayed: rollingPlayed };

        let repeatedOpponentRisk = 0;
        const opponentIds = ids.filter((id) => id && id.toString() !== winnerObjId.toString());
        if (opponentIds.length > 0) {
            const rosterIds = [winnerObjId, ...opponentIds];
            let sharedRosterMatches = 0;
            for (const doc of rollingDocs) {
                const inDoc = (doc.aPlayer || []).map((p) => p.iUserId && p.iUserId.toString()).filter(Boolean);
                const set = new Set(inDoc);
                if (rosterIds.every((rid) => set.has(rid.toString()))) sharedRosterMatches += 1;
            }
            const recentMatches = rollingPlayed;
            const minTotalNeeded = Math.min(config.REPEATED_OPPONENT_MIN_TOTAL, rollingLimit);
            const minSharedNeeded = Math.min(config.REPEATED_OPPONENT_MIN_SHARED, rollingLimit);
            if (recentMatches >= minTotalNeeded && sharedRosterMatches >= minSharedNeeded) {
                const sameOpponentRatio = sharedRosterMatches / recentMatches;
                const ratioThreshold = config.REPEATED_OPPONENT_RATIO_PCT / 100;
                if (sameOpponentRatio > ratioThreshold) {
                    repeatedOpponentRisk = config.RISK_REPEATED_SAME_OPPONENTS;
                }
            }
        }

        let riskToAdd = 0;
        const reasons = [];
        const minMatchesForWinRate = Math.max(config.MIN_MATCHES_FOR_WINRATE, config.FAIRPLAY_WIN_RATE_MIN_SAMPLE);
        if (winStats.nPlayed >= minMatchesForWinRate && winStats.nPlayed > 0) {
            const winRate = (winStats.nWon / winStats.nPlayed) * 100;
            if (winRate >= config.WIN_RATE_ABNORMAL_PCT) {
                riskToAdd += config.RISK_ABNORMAL_WIN_RATE;
                reasons.push('abnormal_win_rate');
            }
        }

        if (repeatedOpponentRisk > 0) {
            riskToAdd += repeatedOpponentRisk;
            reasons.push('repeated_same_opponents');
        }

        const rapidThreshold = config.RAPID_GAME_DURATION_THRESHOLD_MS;
        if (gameDurationMs != null && Number.isFinite(gameDurationMs) && gameDurationMs < rapidThreshold && rollingPlayed >= minBeforeRisk) {
            riskToAdd += config.RISK_RAPID_GAME_PATTERN;
            reasons.push('rapid_game_completion');
        }

        if (riskToAdd > 0) {
            await fairPlay.incrementRiskScore(winnerId, reasons.join(','), riskToAdd);
        }
    } catch (err) {
        log.error('FairPlay afterMatchEnd failed', err?.message || err);
    }
};

/**
 * Record in-game coin transfer for pattern analysis (optional).
 * @param {string} senderId
 * @param {string} receiverId
 * @param {number} amount
 * @param {string} [tableId]
 */
fairPlay.recordCoinTransfer = async function (senderId, receiverId, amount, tableId) {
    const config = await getFairPlayConfig();
    try {
        await CoinTransferLog.create({
            iSenderId: mongodb.mongify(senderId),
            iReceiverId: mongodb.mongify(receiverId),
            nAmount: amount,
            iTableId: tableId ? mongodb.mongify(tableId) : null,
        });
    } catch (e) {
        log.error('FairPlay recordCoinTransfer failed', e?.message);
    }

    try {
        const window = 24 * 60 * 60 * 1000;
        const since = new Date(Date.now() - window);
        const samePairCount = await CoinTransferLog.countDocuments({
            iSenderId: mongodb.mongify(senderId),
            iReceiverId: mongodb.mongify(receiverId),
            dCreatedDate: { $gte: since },
        });
        if (samePairCount > 10) {
            await fairPlay.incrementRiskScore(senderId, 'suspicious_coin_transfer_pattern', config.RISK_SUSPICIOUS_COIN_TRANSFER);
        }
    } catch (e) {
        log.error('FairPlay coin transfer pattern check failed', e?.message);
    }
};

/**
 * Write audit log entry (for admin actions when admin panel is added later).
 * @param {string} actionType
 * @param {string} userId
 * @param {string} [adminId]
 * @param {string} [reason]
 * @param {Object} [meta]
 */
fairPlay.auditLog = async function (actionType, userId, adminId, reason, meta) {
    try {
        await AuditLog.create({
            actionType,
            iUserId: mongodb.mongify(userId),
            iAdminId: adminId ? mongodb.mongify(adminId) : null,
            sReason: reason || '',
            oMeta: meta || null,
        });
    } catch (e) {
        log.error('FairPlay auditLog failed', e?.message);
    }
};

module.exports = fairPlay;
