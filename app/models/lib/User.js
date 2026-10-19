const mongoose = require('mongoose');

const User = mongoose.Schema(
    {
        sUserName: { type: String },
        sEmail: { type: String },
        sPassword: { type: String },
        nMobile: { type: Number },
        bIsEmailVerified: { type: Boolean, default: false },
        sAvatar: { type: String },
        sToken: { type: String },
        sVerificationToken: { type: String },
        sPushToken: String,
        sFacebookId: { type: String },
        sAppleId: { type: String },
        nOTP: { type: Number },
        sRootSocket: { type: String },
        nWon: { type: Number, default: 0 },
        nLost: { type: Number, default: 0 },
        nTotalCoins: { type: Number, default: 0 },
        bSoundEnabled: { type: Boolean, default: true },
        bMusicEnabled: { type: Boolean, default: true },
        bVibrationEnabled: { type: Boolean, default: true },
        bPushEnabled: { type: Boolean, default: true },
        sReferralCode: String,
        sReferralLink: String,
        eBadges: {
            type: String,
            enum: ['beginner', 'intermediate', 'expert'],
            default: 'beginner',
        },
        // aSewaliTable: [mongoose.Schema.Types.ObjectId],
        iLastTournamentId: mongoose.Schema.Types.ObjectId,
        eUserType: {
            type: String,
            enum: ['user', 'admin', 'vip'],
            default: 'user',
        },
        eStatus: {
            type: String,
            enum: ['y', 'n', 'd'], // y= active, n= blocked, d= deleted
            default: 'y',
        },
        eGender: {
            type: String,
            enum: ['male', 'female', 'unspecified'],
            default: 'unspecified',
        },
        eLoginType: {
            type: String,
            enum: ['default', 'social'],
            default: 'default',
        },
        eLocale: {
            type: String,
            enum: ['en', 'hi'],
            default: 'en',
        },
        nBackgroundId: {
            type: Number,
            default: 1,
        },
        aUnlockedBackgroundIds: {
            type: [Number],
            default: [1],
        },
        dLastLoginAt: { type: Date, default: null },
        nLoginStreak: { type: Number, default: 0 },
        dLAstStreakLoginAt: { type: Date, default: null },
        dVipExpiresAt: { type: Date, default: null },
        // Fairplay / anti-cheat
        nRiskScore: { type: Number, default: 0 },
        eFlagLevel: {
            type: String,
            enum: ['none', 'warning', 'temp_restriction', 'banned'],
            default: 'none',
        },
        dFlaggedAt: { type: Date, default: null },
        dRestrictedUntil: { type: Date, default: null },
        sLastDeviceId: { type: String, default: null },
        sLastIp: { type: String, default: null },
        nTheamIndex: { type: Number, default: 1 },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('User', User, 'User');
