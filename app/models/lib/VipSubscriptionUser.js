const mongoose = require('mongoose');

const VipSubscriptionUser = new mongoose.Schema(
    {
        iUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        iVipSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'VipSubscription', required: false },
        sProductId: { type: String }, // SKU/product id
        sPurchaseToken: { type: String },
        sOrderId: { type: String },
        nExpiryTimeMillis: { type: Number, default: 0 },
        isAutoRenewing: { type: Boolean, default: false },
        eStatus: { type: String, default: 'EXPIRED' }, // 'ACTIVE' | 'EXPIRED' | raw google state

        sLastWebhookNotificationType: { type: String, default: null },
        sLastWebhookSubtype: { type: String, default: null },
        sAppleTransactionType: { type: String, default: null },
        sAppleTransactionReason: { type: String, default: null },
        sAppleInAppOwnershipType: { type: String, default: null },
        nAppleRevocationReason: { type: Number, default: null },
        dAppleRevocationAt: { type: Date, default: null },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('vipsubscriptionusers', VipSubscriptionUser);
