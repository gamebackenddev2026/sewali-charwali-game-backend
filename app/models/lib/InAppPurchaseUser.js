const mongoose = require('mongoose');

const InAppPurchaseUser = new mongoose.Schema(
    {
        iUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },

        sProductId: {
            type: String, // e.g. coins_100, coins_500
            required: true
        },

        sPurchaseToken: {
            type: String,
            required: true
        },

        sOrderId: {
            type: String,
            default: null
        },

        nAmount: {
            type: Number,
            default: 0
        },

        sPlatform: {
            type: String,
            enum: ['android', 'ios'],
            required: true
        },

        ePurchaseType: {
            type: String,
            enum: ['COIN', 'REMOVE_ADS'],
            default: 'COIN',
            index: true,
        },

        nCoins: {
            type: Number,
            default: 0
        },

        eStatus: {
            type: String,
            enum: ['PENDING', 'SUCCESS', 'FAILED'],
            default: 'PENDING'
        },

        isVerified: {
            type: Boolean,
            default: false
        },

        dPurchaseTime: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' }
    }
);

module.exports = mongoose.model('inapppurchaseusers', InAppPurchaseUser);