const mongoose = require('mongoose');

/**
 * Tracks user login sessions for device/IP anomaly detection.
 * Used for: multiple accounts from same device, rapid account switching.
 */
const UserSessionSchema = new mongoose.Schema(
    {
        iUserId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        sDeviceId: { type: String, default: null, index: true },
        sIp: { type: String, default: null, index: true },
        dLoginAt: { type: Date, default: Date.now },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

UserSessionSchema.index({ sDeviceId: 1, dLoginAt: -1 });
UserSessionSchema.index({ iUserId: 1, dLoginAt: -1 });

module.exports = mongoose.model('userSessions', UserSessionSchema);
