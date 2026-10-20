const mongoose = require('mongoose');

const Support = new mongoose.Schema(
    {
        iUserId: mongoose.Schema.Types.ObjectId,
        iTableId: mongoose.Schema.Types.ObjectId,
        iTournamentId: mongoose.Schema.Types.ObjectId,
        sTitle: String,
        sDescription: String,
        aMedia: [{ sUrl: String, eType: { type: String, enum: ['image', 'video'] } }],
        aDiscussion: [
            {
                iAdminId: mongoose.Schema.Types.ObjectId,
                sMessage: String,
                dCreatedDate: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],
        eState: {
            type: String,
            enum: ['reviewing', 'acknowledged', 'processed', 'resolved', 'spam'],
            default: 'reviewing',
        },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('support', Support);
