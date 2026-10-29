const mongoose = require('mongoose');

const ClubBlockedUser = new mongoose.Schema(
    {
        iClubId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'clubs' },
        iUserId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        iBlockedBy: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        sReason: { type: String, default: '' },
        eStatus: {
            type: String,
            enum: ['blocked', 'unblocked'],
            default: 'blocked',
        },
        dBlockedAt: { type: Date, default: Date.now },
        dUnblockedAt: { type: Date },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

ClubBlockedUser.index({ iClubId: 1, iUserId: 1 }, { unique: true });
ClubBlockedUser.index({ iClubId: 1, eStatus: 1 });

module.exports = mongoose.model('clubBlockedUsers', ClubBlockedUser);
