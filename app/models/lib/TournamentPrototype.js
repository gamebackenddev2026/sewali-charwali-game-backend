const mongoose = require('mongoose');

const TournamentPrototype = new mongoose.Schema(
    {
        sTitle: { type: String, default: '' },
        nTotalSeat: { type: Number, default: 6 },
        nRequiredSeat: { type: Number, default: 3 },
        nTurnTime: { type: Number, default: 30 },
        nLobbyTime: { type: Number, default: 300 },
        nTablePoint: { type: Number, default: 6 },
        nEntryFee: { type: Number, default: 0 },
        nNonEliminatorRound: { type: Number, default: 1 },

        eMode: {
            type: String,
            enum: ['cash', 'free'],
            default: 'free',
        },
        eGameType: {
            type: String,
            enum: ['sewali', 'charwali'],
            default: 'sewali',
        },
        eStatus: {
            type: String,
            enum: ['y', 'n'],
            default: 'y',
        },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);
module.exports = mongoose.model('TournamentPrototype', TournamentPrototype, 'TournamentPrototype');
