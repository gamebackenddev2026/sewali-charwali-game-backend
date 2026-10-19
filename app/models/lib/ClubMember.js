const mongoose = require('mongoose');

const ClubMember = new mongoose.Schema(
    {
        iClubId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'clubs' },
        iUserId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        eRole: {
            type: String,
            enum: ['owner', 'admin', 'member'],
            default: 'member',
        },
        nWeeklyContributionPoints: { type: Number, default: 0 },
        eStatus: {
            type: String,
            enum: ['active', 'left', 'removed'],
            default: 'active',
        },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('clubMembers', ClubMember);
