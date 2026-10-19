const mongoose = require('mongoose');

const Message = new mongoose.Schema(
    {
        iSenderId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        iReceiverId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        sMessage: { type: String, required: true },
        eStatus: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
        bIsDeleted: { type: Boolean, default: false },
        // challenge related fields
        eMessageType: { type: String, enum: ['message', 'challenge'], default: 'message' },
        // Challenge specific fields
        iTableId: { type: mongoose.Schema.Types.ObjectId, ref: 'sewaliPrivateTable' },
        sTableCode: { type: String },
        eChallengeStatus: { type: String, enum: ['pending', 'accepted', 'rejected', 'expired'], default: 'pending' },
        oTableInfo: {
            sName: { type: String },
            nTableFee: { type: Number },
            eGameType: { type: String, enum: ['sewali', 'charwali'] },
            nMaxPlayer: { type: Number, enum: [3, 4] },
        },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

// Indexes for efficient querying
Message.index({ iSenderId: 1, iReceiverId: 1, dCreatedDate: -1 });
Message.index({ iReceiverId: 1, iSenderId: 1, dCreatedDate: -1 });
Message.index({ dCreatedDate: 1 }); // For cleanup job

module.exports = mongoose.model('Message', Message);
