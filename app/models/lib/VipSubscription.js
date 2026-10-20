const mongoose = require('mongoose');

const VipSubscription = new mongoose.Schema(
    {
        sPackageName: { type: String },
        sku: {
            type: String,
            required: false,
            minlength: 1,
        },
        sTitle: { type: String },
        sPrice: { type: String, default: '$0.00' },
        sDescription: { type: String },
        sCurrency: { type: String, default: 'USD' },
        nDuration: { type: Number, default: 0 }, // duration in days (optional)
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('vipsubscriptions', VipSubscription);
