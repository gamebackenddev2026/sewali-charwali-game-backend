/**
 * FairPlay / anti-cheat thresholds and scoring.
 * Values are loaded from DB `Settings` (singleton document).
 * No code-side defaults—fail if not present in DB!
 *
 * Cached in-memory to avoid a DB hit per event.
 */

const { Settings } = require('../models');


/**
 * Helper to extract config from the Settings doc.
 * Throws if any value is missing (strict mode).
 */
function buildConfigFromSettingsDoc(doc) {
    if (!doc) throw new Error('No Settings document found for FairPlay config');

    // The mapping from config keys to Settings doc fields
    const mapping = {
        RISK_THRESHOLD_WARNING: 'nRiskThresholdWarning',
        RISK_THRESHOLD_TEMP_RESTRICT: 'nRiskThresholdTempRestrict',
        RISK_THRESHOLD_BAN: 'nRiskThresholdBan',

        WIN_RATE_ABNORMAL_PCT: 'nWinRateAbnormalPct',
        MIN_MATCHES_FOR_WINRATE: 'nMinMatchesForWinrate',
        FAIRPLAY_WIN_RATE_MIN_SAMPLE: 'nFairplayWinRateMinSample',

        REPEATED_OPPONENT_MIN_TOTAL: 'nRepeatedOpponentMinTotal',
        REPEATED_OPPONENT_MIN_SHARED: 'nRepeatedOpponentMinShared',
        REPEATED_OPPONENT_RATIO_PCT: 'nRepeatedOpponentRatioPct',

        RISK_ABNORMAL_WIN_RATE: 'nRiskAbnormalWinRate',
        RISK_REPEATED_SAME_OPPONENTS: 'nRiskRepeatedSameOpponents',
        RISK_SUSPICIOUS_COIN_TRANSFER: 'nRiskSuspiciousCoinTransfer',
        RISK_RAPID_GAME_PATTERN: 'nRiskRapidGamePattern',
        RISK_MULTIPLE_ACCOUNTS_SAME_DEVICE: 'nRiskMultipleAccountsSameDevice',
        RISK_RAPID_ACCOUNT_SWITCH: 'nRiskRapidAccountSwitch',

        MAX_ACCOUNTS_PER_DEVICE: 'nMaxAccountsPerDevice',
        RAPID_SWITCH_WINDOW_MS: 'nRapidSwitchWindowMs',
        RAPID_SWITCH_MIN_LOGINS: 'nRapidSwitchMinLogins',

        TEMP_RESTRICT_DURATION_MS: 'nTempRestrictDurationMs',
        FAIRPLAY_ROLLING_MATCH_COUNT: 'nFairplayRollingMatchCount',
        FAIRPLAY_MIN_MATCHES_BEFORE_RISK: 'nFairplayMinMatchesBeforeRisk',
        RAPID_GAME_DURATION_THRESHOLD_MS: 'nRapidGameDurationThresholdMs',
    };

    /** @type {Record<string, number>} */
    const out = {};
    for (const [configKey, docField] of Object.entries(mapping)) {
        const v = doc[docField];
        if (!Number.isFinite(Number(v))) {
            throw new Error(`Missing or invalid FairPlay config "${configKey}" (Settings field: "${docField}"), got: ${v}`);
        }
        out[configKey] = Number(v);
    }
    return Object.freeze(out);
}

let _cache = null;
let _cacheAtMs = 0;
const CACHE_TTL_MS = 30 * 1000;

/**
 * Returns FairPlay config strictly from DB Settings.
 * Throws if any value is missing.
 */
async function getFairPlayConfig(opts = {}) {
    const refresh = !!opts.refresh;
    if (!refresh && _cache && Date.now() - _cacheAtMs < CACHE_TTL_MS) return _cache;

    const settingsDoc = await Settings.findOne({}, { __v: 0 }).lean();
    _cache = buildConfigFromSettingsDoc(settingsDoc);
    _cacheAtMs = Date.now();
    return _cache;
}

module.exports = {
    getFairPlayConfig,
};
