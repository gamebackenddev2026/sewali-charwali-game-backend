const mongoose = require('mongoose');

const DailyGifts = new mongoose.Schema(
    {
        iUserId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        iGiftId: { type: mongoose.Schema.Types.ObjectId, required: true },
        nDays: { type: Number, required: true },
        nDailyBonus: { type: Number, required: true },
        eStatus: {
            type: String,
            enum: ['claimed', 'unclaimed'],
            default: 'unclaimed',
        },
        timestamp: { type: Number, default: Date.now(), index: true },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('dailyGifts', DailyGifts);

// [
//     {
//         _id: ObjectId('64479e1f4bd8522a657be06f'),
//         nDays: 1,
//         nDailyBonus: 10,
//     },
//     {
//         _id: ObjectId('64479e1f4bd8522a657be070'),
//         nDays: 2,
//         nDailyBonus: 200,
//     },
//     {
//         _id: ObjectId('64479e1f4bd8522a657be071'),
//         nDays: 3,
//         nDailyBonus: 300,
//     },
//     {
//         _id: ObjectId('64479e1f4bd8522a657be072'),
//         nDays: 4,
//         nDailyBonus: 400,
//     },
//     {
//         _id: ObjectId('64479e1f4bd8522a657be073'),
//         nDays: 5,
//         nDailyBonus: 500,
//     },
//     {
//         _id: ObjectId('64479e1f4bd8522a657be074'),
//         nDays: 6,
//         nDailyBonus: 600,
//     },
//     {
//         _id: ObjectId('64479e1f4bd8522a657be075'),
//         nDays: 7,
//         nDailyBonus: 700,
//     },
// ];
