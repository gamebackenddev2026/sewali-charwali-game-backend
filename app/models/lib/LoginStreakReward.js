const mongoose = require('mongoose');

const LoginStreakReward = new mongoose.Schema(
    {
        iUserId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        iRewardId: { type: mongoose.Schema.Types.ObjectId, required: true },
        nDay: { type: Number, required: true },
        nReward: { type: Number, required: true },
        eStatus: {
            type: String,
            enum: ['claimed', 'unclaimed'],
            default: 'unclaimed',
        },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('loginStreakReward', LoginStreakReward);
