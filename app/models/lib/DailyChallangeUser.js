const mongoose = require('mongoose');

const DailyChallengeUser = new mongoose.Schema(
    {
        iUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
        iDailyChallengeId: { type: mongoose.Schema.Types.ObjectId, ref: 'dailyChallenge', required: true },
        eChallengeType: { type: String },
        nTarget: { type: Number },
        nProgress: { type: Number, default: 0 },
        isCompleted: { type: Boolean, default: false },
        isClaimed: { type: Boolean, default: false },
        dDate: { type: Date, required: true },
        // nLevel: { type: Number, required: true },
        dResetDate: { type: Date, required: true },
        eStatus: {
            type: String,
            enum: ['y', 'n', 'd'],
            default: 'y',
        },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('dailyChallengeUser', DailyChallengeUser);
