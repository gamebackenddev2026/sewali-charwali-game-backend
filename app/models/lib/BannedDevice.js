const mongoose = require('mongoose');

/**
 * Devices banned from the platform (e.g. after multi-account abuse).
 */
const BannedDeviceSchema = new mongoose.Schema(
    {
        sDeviceId: { type: String, required: true, unique: true, index: true },
        sReason: { type: String, default: '' },
        dBannedAt: { type: Date, default: Date.now },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('bannedDevices', BannedDeviceSchema);
