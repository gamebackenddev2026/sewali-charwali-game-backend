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

const Achievements = new mongoose.Schema(
    {
        iUserId: mongoose.Schema.Types.ObjectId, // admin who added the achievement
        sTitle: String,
        eType: {
            type: String,
            enum: ['beginner', 'intermediate', 'expert'],
            default: 'beginner',
        },
        bIsCompleted: { type: Boolean, default: false },
        aAchievements: { type: [SubAchievementSchema], default: [] },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('achievements', Achievements);
