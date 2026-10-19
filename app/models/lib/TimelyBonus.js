const mongoose = require('mongoose');

const TimelyBonus = new mongoose.Schema(
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

TimelyBonus.index({ dCreatedDate: 1 });
TimelyBonus.index({ dUpdatedDate: 1 });
module.exports = mongoose.model('TimelyBonus', TimelyBonus);
