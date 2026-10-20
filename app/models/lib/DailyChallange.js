const mongoose = require('mongoose');

const DailyChallenge = new mongoose.Schema(
    {
        sName: { type: String, required: true },
        sDescription: { type: String },
        eRewardType: {
            type: String,
            enum: ['nChips'],
            default: 'nChips',
        },
        nTarget: { type: Number, required: true },
        nRewardValue: { type: Number, required: true },
        isActive: { type: Boolean, default: true },
        // TODO update challange type from enum
        eChallengeType: {
            type: String,
            enum: ['winMatch', 'playMatch', 'completeMatch', 'reachScore', 'earnCoins', 'spendCoins', 'winBig', 'dailyLogin', 'watchAds', 'playWithFriend'],
            default: 'winMatch',
        },
        eStatus: {
            type: String,
            enum: ['y', 'n', 'd'],
            default: 'y',
        },
        eType: {
            type: String,
            enum: ['beginner', 'intermediate', 'expert'],
            default: 'beginner',
        },
        eChallengePeriod: {
            type: String,
            enum: ['daily', 'weekly'],
            default: 'daily',
            required: true,
        },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('dailyChallenge', DailyChallenge);
