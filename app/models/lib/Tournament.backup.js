const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema(
    {
        aRound: [
            {
                _id: false,
                nRound: { type: Number },
                aTable: [mongoose.Schema.Types.ObjectId],
            },
        ],
    },
    { _id: false }
);
const WinnerSchema = new mongoose.Schema(
    {
        nRank: Number,
        iUserId: mongoose.Schema.Types.ObjectId,
        sUserName: String,
        nScore: Number,
        nRoundWon: Number,
        nTournamentRoundPlayed: Number,
        nAmountWon: Number,
    },
    { _id: false }
);

const Tournament = new mongoose.Schema(
    {
        iPrototypeId: { type: mongoose.Schema.Types.ObjectId },
        sTitle: { type: String, default: '' },
        nTotalSeat: { type: Number, default: 6 },
        nRequiredSeat: { type: Number, default: 3 },
        nTurnTime: { type: Number, default: 30 },
        nLobbyTime: { type: Number, default: 300 },
        nTablePoint: { type: Number, default: 6 },
        nEntryFee: { type: Number, default: 100 },
        nNonEliminatorRound: { type: Number, default: 1 }, // TODO: nNonEliminatorRound -> nEliminatedPerRound

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
            enum: ['created', 'scheduled', 'waiting', 'matchMaking', 'running', 'completed', 'canceled'],
            default: 'created',
        },
        dScheduledAt: Date,
        dRegistrationStartAt: Date,
        dRegistrationEndAt: Date,
        aUsers: [
            {
                _id: false,
                iUserId: { type: mongoose.Schema.Types.ObjectId },
                sUserName: String,
                dRegisteredAt: { type: Date, default: Date.now() },
                eStatus: {
                    type: String,
                    enum: ['registered', 'waiting', 'playing', 'disconnected', 'removed', 'left'],
                    default: 'registered',
                },
                nScore: { type: Number, default: 0 },
                nRoundWon: { type: Number, default: 0 },
                nTournamentRoundPlayed: { type: Number, default: 0 },
                nAmountWon: { type: Number, default: 0 },
            },
        ],
        aPrize: {
            type: [Number],
            default: [300, 200, 100],
        },
        oLog: {
            type: LogSchema,
            default: { aRound: [{ nRound: 1, aTable: [] }] },
        },
        nCurrentRound: { type: Number, default: 0 },
        aWinner: { type: [WinnerSchema], default: [] },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);
module.exports = mongoose.model('tournament', Tournament);
