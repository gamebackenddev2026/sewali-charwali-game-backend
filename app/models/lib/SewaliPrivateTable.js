const mongoose = require('mongoose');

const SewaliPrivateTable = new mongoose.Schema(
    {
        iTableId: mongoose.Schema.Types.ObjectId,
        sName: { type: String },
        sCode: { type: String },
        nTableFee: { type: Number, default: 0 },
        aPlayers: [mongoose.Schema.Types.ObjectId],
        nMaxPlayer: { type: Number, enum: [3, 4] },
        eGameType: {
            type: String,
            enum: ['sewali', 'charwali'],
        },
        eState: {
            type: String,
            enum: ['waiting', 'playing', 'finished'],
            default: 'waiting',
        },
        nCoinsIn: { type: Number, default: 0 },
        eStatus: {
            type: String,
            enum: ['y', 'n', 'd'], // y= active, n= blocked, d= deleted
            default: 'y',
        },
        __proto: {
            _id: mongoose.Schema.Types.ObjectId,
            sName: { type: String },
            nTableFee: { type: Number, default: 0 },
            nSortHandTime: { type: Number },
            nMaxPlayer: { type: Number, enum: [3, 4] },
            eGameType: {
                type: String,
                enum: ['sewali', 'charwali'],
            },
            eStatus: {
                type: String,
                enum: ['y', 'n', 'd'], // y= active, n= blocked, d= deleted
                default: 'y',
            },
        },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('sewaliPrivateTable', SewaliPrivateTable);
