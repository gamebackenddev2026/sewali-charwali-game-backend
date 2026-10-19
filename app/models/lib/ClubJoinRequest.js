const mongoose = require('mongoose');

const ClubJoinRequest = new mongoose.Schema(
    {
        iClubId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'clubs' },
        iUserId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        sMessage: { type: String, default: '' },
        eStatus: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
        },
        iHandledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        dHandledAt: { type: Date },
        isRead: { type: Boolean, default: false },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('clubJoinRequests', ClubJoinRequest);
