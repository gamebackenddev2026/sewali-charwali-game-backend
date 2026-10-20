const mongoose = require('mongoose');

const Friends = new mongoose.Schema(
    {
        iUserId: mongoose.Schema.Types.ObjectId,
        iFriendId: mongoose.Schema.Types.ObjectId,
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

Friends.index({ iUserId: 1, iFriendId: 1 });

module.exports = mongoose.model('friends', Friends);
