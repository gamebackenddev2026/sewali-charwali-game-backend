const mongoose = require('mongoose');

const ClubChat = new mongoose.Schema(
    {
        iClubId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Club' },
        iSenderId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        sMessage: { type: String, required: true, trim: true },
        bIsDeleted: { type: Boolean, default: false },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('clubChats', ClubChat);
