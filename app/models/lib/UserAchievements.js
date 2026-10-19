const mongoose = require('mongoose');

const SubAchievementSchema = new mongoose.Schema(
    {
        sSubTitle: String,
        nCoins: Number,
        nProgress: Number,
        nTarget: Number,
        eState: {
            type: String,
            enum: ['current', 'claimed', 'unclaimed', 'none'],
            default: 'none',
        },
    },
    { _id: true, __v: false }
);

const UserAchievementSchema = new mongoose.Schema(
    {
        sTitle: String,
        eType: {
            type: String,
            enum: ['beginner', 'intermediate', 'expert'],
            default: 'beginner',
        },
        bIsCompleted: { type: Boolean, default: false },
        aAchievements: { type: [SubAchievementSchema], default: [] },
        //
        iAchievementId: { type: mongoose.Schema.Types.ObjectId, required: true }, // Achievement._id
        iUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('userachievements', UserAchievementSchema);
