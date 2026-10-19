const mongoose = require('mongoose');

const SewaliTable = new mongoose.Schema(
    {
        iTableId: mongoose.Schema.Types.ObjectId,
        sName: { type: String },
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
        bIsTournament: { type: Boolean, default: false },
        iTournamentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('sewaliTable', SewaliTable);
