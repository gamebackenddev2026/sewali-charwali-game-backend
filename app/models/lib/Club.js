const mongoose = require('mongoose');

const Club = new mongoose.Schema(
    {
        sClubName: { type: String, required: true, trim: true },
        nClubProfile: { type: Number, default: 0 }, // default icon index (0-based); -1 when custom sProfileImage is used
        sProfileImage: { type: String, default: '' }, // AWS image URL; empty when using a default nClubProfile icon
        sDescription: { type: String, default: '' },
        iOwnerId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        nMaxMembers: { type: Number, default: 100, min: 1 },
        nTotalPoints: { type: Number, default: 0 },
        bIsPublic: { type: Boolean, default: true },
        sCountry: { type: String, default: '' },
        eMinimumPlayerLevel: { type: String, enum: ['beginner', 'intermediate', 'expert'], default: 'beginner' },
        //  bJoinApprovalRequired: { type: Boolean, default: false },
        eStatus: {
            type: String,
            enum: ['y', 'n', 'd'], // y= active, n= blocked, d= deleted
            default: 'y',
        },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('clubs', Club);
