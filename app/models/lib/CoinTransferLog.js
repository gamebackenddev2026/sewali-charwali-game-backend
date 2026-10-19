const mongoose = require('mongoose');

/**
 * Logs in-game coin transfers (sendCoin) for suspicious pattern detection.
 */
const CoinTransferLogSchema = new mongoose.Schema(
    {
        iSenderId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        iReceiverId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        nAmount: { type: Number, required: true },
        iTableId: { type: mongoose.Schema.Types.ObjectId, default: null },
        dCreatedDate: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

CoinTransferLogSchema.index({ iSenderId: 1, iReceiverId: 1, dCreatedDate: -1 });

module.exports = mongoose.model('coinTransferLogs', CoinTransferLogSchema);
