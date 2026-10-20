const mongoose = require('mongoose');

const { Schema } = mongoose;

const CardSchema = new Schema({
    nLabel: Number,
    nValue: Number,
    eSuit: String,
    isJoker: Boolean,
    _id: String,
    nGroupId: Number,
});

const oStatisticsSchema = new Schema(
    {
        nScore: Number,
        nRank: Number,
        nPriority: Number,
    },
    { _id: false }
);

const DeclaredHandSchema = new Schema(
    {
        nTableRound: Number,
        iUserId: mongoose.Schema.Types.ObjectId,
        aCards: [CardSchema],
        oStatistics: oStatisticsSchema,
        nScore: Number,
        nBalance: Number,
        // VIP win bonus breakdown (for admin display)
        nWinAmountBase: { type: Number, default: 0 },
        nVipWinPercent: { type: Number, default: 0 },
        nVipExtraAmount: { type: Number, default: 0 },
        nWinAmountTotal: { type: Number, default: 0 },
        bVipBonusApplied: { type: Boolean, default: false },
        bIsRoundWinner: Boolean,
    },
    { _id: false }
);

const RoundInfoSchema = new Schema(
    {
        nTableRound: Number,
        aDeclaredHand: [DeclaredHandSchema],
    },
    { _id: false }
);

const SettingSchema = new Schema({
    nBeginCountdown: Number,
    nGrabTimer: Number,
    nInitialTimer: Number,
    nMaxWaitingTime: Number,
    nTurnTime: Number,
    nRoundStartIn: Number,
    nPopUpTimer: Number,
    nSplitAmountTimer: Number,
    nLeaveTimer: Number,
});

const PlayerSchema = new Schema(
    {
        iUserId: { type: mongoose.Schema.Types.ObjectId, index: true },
        sUserName: { type: String, index: true },
        sEmail: { type: String, index: true },
        eUserType: { type: String, default: '' },
        bIsVipUser: { type: Boolean, default: false },
        nTotalCoins: Number,
        eBadges: String,
        nTurnCount: Number,
        nBalance: Number,
        nPotValue: Number,
        nSeat: Number,
        nRoundWon: Number,
        nTotalScore: Number,
    },
    { _id: false }
);

const TableSchema = new Schema({
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
});

const TableHistory = new Schema(
    {
        // _id: actual table id
        iTableId: mongoose.Schema.Types.ObjectId, // this is table prototype id
        iDealerId: mongoose.Schema.Types.ObjectId,
        iWinnerId: mongoose.Schema.Types.ObjectId,
        nTablePot: Number,
        nTotalRound: Number,
        nTableRound: Number,
        nMaxPlayer: Number,
        nTableFee: Number,
        eState: String,
        eGameType: String,
        oSetting: SettingSchema,
        oTable: TableSchema,
        aPlayer: [PlayerSchema],
        aRoundInfo: [RoundInfoSchema],
        bIsTournament: { type: Boolean, default: false, index: true },
        iTournamentId: { type: mongoose.Schema.Types.ObjectId, index: true },
    },
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('tableHistory', TableHistory, 'tableHistory');
