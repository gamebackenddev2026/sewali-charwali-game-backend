const mongoose = require('mongoose');

const Table = new mongoose.Schema(
    {
        sName: { type: String },
        nTableFee: { type: Number, default: 0 },
        nSortHandTime: { type: Number },
        nMaxPlayer: { type: Number, enum: [3, 4] },
        // Access type for the table: normal table vs VIP-only table.
        // Existing tables will behave as normal by default.
        bIsVip: {
            type: Boolean,
            default: false,
        },
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
    { timestamps: { createdAt: 'dCreatedDate', updatedAt: 'dUpdatedDate' } }
);

module.exports = mongoose.model('tables', Table);
