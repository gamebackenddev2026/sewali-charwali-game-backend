const mongoose = require('mongoose');

const Bonus = new mongoose.Schema(
    {
        iUserId: mongoose.Schema.Types.ObjectId,
        iReferredBy: mongoose.Schema.Types.ObjectId,
        nBonus: Number,
        nLockedBonus: Number,
        nReferralTransaction: Number,
        nUsed: { type: Number, default: 0 },
        dUsedAt: Date,
        dExpiredAt: Date,
        eCategory: {
            type: String,
            enum: ['referral'],
        },
        eBonusType: {
            type: String,
            enum: ['instant', 'locked'],
            default: 'instant',
        },
        eStatus: {
            type: String,
            enum: ['y', 'n'],
            default: 'y',
        },
        oPromoCode: {},
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);
module.exports = mongoose.model('bonus', Bonus);

// this is for referral bonus, user need to enter referal code while registeration
