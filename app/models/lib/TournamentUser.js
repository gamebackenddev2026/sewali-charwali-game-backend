const mongoose = require('mongoose');

const CardSchema = new mongoose.Schema(
    {
        nLabel: Number,
        eSuit: String,
    },
    { _id: false }
);

const oStatisticsSchema = new mongoose.Schema(
    {
        nScore: Number,
        nRank: Number,
        nPriority: Number,
    },
    { _id: false }
);

const DeclaredHandSchema = new mongoose.Schema(
    {
        nTournamentRound: Number,
        nTableRound: Number,
        iUserId: mongoose.Schema.Types.ObjectId,
        aCards: [CardSchema],
        oStatistics: oStatisticsSchema,
        nBalance: Number,
        bIsRoundWinner: Boolean,
    },
    { _id: false }
);

const TournamentUser = new mongoose.Schema(
    {
        // _id: iTournamentUserId,
        iTournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'tournaments' },
        iUserId: { type: mongoose.Schema.Types.ObjectId, index: true, ref: 'User' },
        sUserName: { type: String, index: true },
        eStatus: {
            type: String,
            enum: ['registered', 'waiting', 'playing', 'disconnected', 'removed', 'left'],
            default: 'registered',
        },
        nScore: { type: Number, default: 0 },
        nRoundWon: { type: Number, default: 0 },
        nTournamentRoundWon: { type: Number, default: 0 },
        nTournamentRoundPlayed: { type: Number, default: 0 },
        nAmountWon: { type: Number, default: 0 },
        aDeclaredHand: { type: [DeclaredHandSchema], default: [] },
    },
    {
        timestamps: {
            createdAt: 'dCreatedDate', // dCreatedDate -> dRegisteredAt
            updatedAt: 'dUpdatedDate',
        },
    }
);
TournamentUser.index({ iTournamentId: 1, iUserId: 1 }, { unique: true });
TournamentUser.index({ nTournamentRoundWon: -1, nRoundWon: -1, nTournamentRoundPlayed: -1, nScore: -1, dCreatedDate: 1 }, { unique: false });
module.exports = mongoose.model('TournamentUser', TournamentUser, 'TournamentUser');
