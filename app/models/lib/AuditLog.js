const mongoose = require('mongoose');

/**
 * Immutable audit log for fairplay/admin actions.
 * actionType: 'flag' | 'warning' | 'temp_ban' | 'permanent_ban' | 'unban' | 'risk_increment' | 'session_record'
 * adminId only set when action is performed by admin.
 */
const AuditLogSchema = new mongoose.Schema(
    {
        actionType: { type: String, required: true, index: true },
        iUserId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        iAdminId: { type: mongoose.Schema.Types.ObjectId, default: null },
        sReason: { type: String, default: '' },
        oMeta: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' }, strict: true }
);

// Prevent updates and deletes - audit log is append-only
AuditLogSchema.pre('updateOne', function () {
    throw new Error('AuditLog is immutable');
});
AuditLogSchema.pre('updateMany', function () {
    throw new Error('AuditLog is immutable');
});
AuditLogSchema.pre('findOneAndUpdate', function () {
    throw new Error('AuditLog is immutable');
});
AuditLogSchema.pre('deleteOne', function () {
    throw new Error('AuditLog is immutable');
});
AuditLogSchema.pre('deleteMany', function () {
    throw new Error('AuditLog is immutable');
});

module.exports = mongoose.model('auditLogs', AuditLogSchema);
