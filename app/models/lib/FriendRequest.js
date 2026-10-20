const mongoose = require('mongoose');

const FriendRequest = new mongoose.Schema(
    {
        iSenderId: mongoose.Schema.Types.ObjectId,
        iReceiverId: mongoose.Schema.Types.ObjectId,
        eStatus: { type: String, enum: ['P', 'A', 'R'], default: 'P' }, // P = Pending, A = Accepted, R = Rejected
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

FriendRequest.index({ iSenderId: 1, iReceiverId: 1 });

module.exports = mongoose.model('FriendRequest', FriendRequest);
