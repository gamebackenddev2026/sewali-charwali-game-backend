const mongoose = require('mongoose');

const SpinBonus = new mongoose.Schema(
    {
        iUserId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        nCoins: { type: Number, required: true },
        eStatus: {
            type: String,
            enum: ['claimed', 'unclaimed', 'locked'],
            default: 'locked',
        },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

SpinBonus.index({ dCreatedDate: 1 });
SpinBonus.index({ dUpdatedDate: 1 });
module.exports = mongoose.model('SpinBonus', SpinBonus);
