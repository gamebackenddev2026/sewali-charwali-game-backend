const mongoose = require('mongoose');

/**
 * @typedef {Object} SettingsObject
 */

const Settings = new mongoose.Schema({
    iAchieverId: { type: mongoose.Schema.Types.ObjectId, default: mongoose.Types.ObjectId('6458a1986a47b87ce8f49217') },

    nDefaultCoin: { type: Number },
    nReferralBonus: { type: Number, default: 0 },
    nWelcomeBonus: { type: Number, default: 0 },

    nSpinWheelDelay: { type: Number, default: 0 }, // minutes
    nTimelyBonusCoins: { type: Number, default: 0 },
    nTimelyBonusDelay: { type: Number, default: 0 }, // minutes

    aDailyGifts: [
        {
            nDays: Number,
            nDailyBonus: Number,
        },
    ],

    aLoginStreakRewards: [
        {
            nDay: Number,
            nReward: Number,
        },
    ],

    aSpinAmount: [Number],

    aBackground: [
        {
            _id: false,
            nBackgroundId: Number,
            sUrl: String,
            nCost: Number,
        },
    ],

    aEmojiCost: [
        {
            _id: false,
            nEmojiId: Number,
            sUrl: String,
            nCost: Number,
        },
    ],

    aGiftCost: [
        {
            _id: false,
            nGiftId: Number,
            nCost: Number,
        },
    ],

    nDailyChallengeCount: { type: Number, default: 1 },
    nWeeklyChallengeCount: { type: Number, default: 1 },

    // Global club creation fee (admin-managed; same for every club)
    nClubCreationFee: { type: Number, default: 0, min: 0 },

    // VIP configuration
    nVipWinPercent: { type: Number, default: 0 },
    nVipBonusPercent: { type: Number, default: 0 },

    /**
     * -----------------------------
     * FAIRPLAY / ANTI-CHEAT CONFIG
     * -----------------------------
     */

    // Risk thresholds
    nRiskThresholdWarning: { type: Number },
    nRiskThresholdTempRestrict: { type: Number },
    nRiskThresholdBan: { type: Number },

    // Win rate detection
    nWinRateAbnormalPct: { type: Number },
    nMinMatchesForWinrate: { type: Number },
    /** Minimum TableHistory games before abnormal win-rate risk; effective sample = max(nMinMatchesForWinrate, this). */
    nFairplayWinRateMinSample: { type: Number },

    // Repeated-opponent collusion (same table roster): minimums before ratio check; ratio threshold as percent (e.g. 70 = 70%)
    nRepeatedOpponentMinTotal: { type: Number },
    nRepeatedOpponentMinShared: { type: Number },
    nRepeatedOpponentRatioPct: { type: Number },

    // Risk score per detection
    nRiskAbnormalWinRate: { type: Number },
    nRiskRepeatedSameOpponents: { type: Number },
    nRiskSuspiciousCoinTransfer: { type: Number },
    nRiskRapidGamePattern: { type: Number },
    nRiskMultipleAccountsSameDevice: { type: Number },
    nRiskRapidAccountSwitch: { type: Number },

    // Device restrictions
    nMaxAccountsPerDevice: { type: Number },

    // Rapid switching detection
    nRapidSwitchWindowMs: { type: Number }, // 10 minutes
    nRapidSwitchMinLogins: { type: Number },

    // Temporary restriction duration
    nTempRestrictDurationMs: { type: Number }, // 1 hour

    /** Match-end FairPlay: last N games per user (public / VIP table / private all count together). */
    nFairplayRollingMatchCount: { type: Number, default: 50 },
    /** No automated match-end risk until this many games exist in the rolling window. */
    nFairplayMinMatchesBeforeRisk: { type: Number, default: 50 },
    nRapidGameDurationThresholdMs: { type: Number, default: 60000 },
});

module.exports = mongoose.model('settings', Settings);
