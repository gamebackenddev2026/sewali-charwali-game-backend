const { User, Table, SewaliPrivateTable, Friends } = require('../../../../models');
const tableManager = require('../../../../TableManager');
const { mongodb } = require('../../../../utils');
const fairPlay = require('../../../../FairPlay');

const middleware = {};

// 1
/** authenticate user and set req.user */
middleware.isAuthenticated = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.reply(message.unauthorized());

    const decodedToken = _.decodeToken(token);
    if (!decodedToken) return res.reply(message.unauthorized());

    req.query.eLocale = req.query.eLocale || decodedToken?.eLocale;

    const query = { _id: decodedToken._id };
    User.findOne(query, async (err, data) => {
        console.log('isAuthenticated error:', err);
        console.log('', data._id);
        if (err) return res.reply(message.server_error());
        if (!data) return res.reply(message.not_found('User'));
        if (data.sToken !== token) return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
        req.query.eLocale = data?.eLocale || decodedToken?.eLocale || 'en';
        // ensure vip expiry is respected and downgrade if expired
        try {
            // may update DB and reflect change in data.eUserType
            // eslint-disable-next-line no-param-reassign
            data = await _.checkAndDowngradeVip(data);
        } catch (err) {
            // continue with original data on helper error
        }

        const restrictionReply = fairPlay.getAuthRestrictionReply(data, req.query?.eLocale || 'en');
        if (restrictionReply) return res.reply(restrictionReply);
        if (data.eStatus === 'n') return res.reply(message.user_blocked('', req.query?.eLocale || 'en'));
        if (data.eStatus === 'd') return res.reply(message.user_deleted('', req.query?.eLocale || 'en'));
        // const iUserId = data._id;
        // let [oPrevGameData] = await TableHistory.aggregate([
        //     { $match: { bIsTournament: false, 'aPlayer.iUserId': iUserId } },
        //     { $project: { iWinnerId: 1, 'aPlayer.iUserId': 1 } },
        //     {
        //         $group: {
        //             _id: null,
        //             won: {
        //                 $sum: {
        //                     $cond: [{ $eq: ['$iWinnerId', iUserId] }, 1, 0],
        //                 },
        //             },
        //             total: { $sum: 1 },
        //         },
        //     },
        //     {
        //         $project: {
        //             _id: 0,
        //             nMatchWon: '$won',
        //             nMatchLost: { $subtract: ['$total', '$won'] },
        //             nTotalMatch: '$total',
        //         }, // 'nMatchWon', 'nMatchLost', 'nTotalMatch'
        //     },
        // ]);
        // if (!oPrevGameData) oPrevGameData = { nMatchWon: 0, nMatchLost: 0, nTotalMatch: 0 };
        const oPrevGameData = { nMatchWon: data.nWon || 0, nMatchLost: data.nLost || 0, nTotalMatch: (data.nWon || 0) + (data.nLost || 0) };
        req.user = { ...data?.toObject(), ...oPrevGameData };
        next();
    });
};

// 2
/** get desired table prototype and store at req.tableData */
middleware.getTable = (req, res, next) => {
    const body = _.pick(req.body, ['sName', 'nTableFee', 'eGameType', 'nMaxPlayer', 'iTableId', 'iFriendUserId', 'bIsVip']);
    // If iTableId and iFriendUserId are provided, skip table prototype lookup (friend join scenario)
    if (body.iTableId && body.iFriendUserId) {
        return next();
    }
    if (!body.sName) return res.reply(message.required_field('Table name'));
    if (!body.nTableFee) return res.reply(message.required_field('Table fee', req.query?.eLocale || 'en'));
    if (!body.eGameType) return res.reply(message.required_field('Game type', req.query?.eLocale || 'en'));
    if (!body.nMaxPlayer) return res.reply(message.required_field('Max player', req.query?.eLocale || 'en'));

    const query = {
        sName: body.sName,
        nTableFee: body.nTableFee,
        eGameType: body.eGameType,
        nMaxPlayer: body.nMaxPlayer,
    };

    // If client explicitly passes bIsVip, respect it while fetching table prototype.
    // This helps disambiguate between normal and VIP tables with same config.
    if (typeof body.bIsVip === 'boolean') {
        query.bIsVip = body.bIsVip;
    } else if (typeof body.bIsVip === 'string') {
        if (body.bIsVip.toLowerCase() === 'true') {
            query.bIsVip = true;
        } else if (body.bIsVip.toLowerCase() === 'false') {
            query.bIsVip = false;
        }
    }

    Table.findOne(query, (err, data) => {
        if (err) return res.reply(message.server_error());
        if (!data) return res.reply(message.not_found('Table', req.query?.eLocale || 'en'));
        req.tableData = data;
        next();
    });
};

// fetch private by sCode from SewaliPrivateTable collection in mongoDB
middleware.fetchPrivateTable = (req, res, next) => {
    const body = _.pick(req.body, ['sCode']);
    if (!body.sCode) return res.reply(message.required_field('sCode', req.query?.eLocale || 'en'));

    const query = {
        sCode: body.sCode,
    };

    SewaliPrivateTable.findOne(query, (err, data) => {
        console.log('fetchPrivateTable error:', err);
        if (err) return res.reply(message.server_error('', req.query?.eLocale || 'en'));
        if (!data) return res.reply(message.not_found('Table', req.query?.eLocale || 'en'));
        req.privateTable = data;
        req.tableData = data.__proto;
        next();
    });
};

// 3
/** matchmaking + create new table if no table found */
middleware.joinState = async (req, res, next) => {
    const body = _.pick(req.body, ['iTableId', 'iFriendUserId']);
    // If iTableId and iFriendUserId are provided, join specific table (friend join scenario)
    if (body.iTableId && body.iFriendUserId) {
        try {
            // Validate friendship - convert all IDs to ObjectId for consistent comparison
            const iUserIdObj = mongodb.mongify(req.user._id);
            const iFriendUserIdObj = mongodb.mongify(body.iFriendUserId);

            const friendship = await Friends.findOne({
                $or: [
                    { iUserId: iUserIdObj, iFriendId: iFriendUserIdObj },
                    { iUserId: iFriendUserIdObj, iFriendId: iUserIdObj },
                ],
            }).lean();
            if (!friendship) {
                return res.reply(message.not_found('Friendship', req.query?.eLocale || 'en'));
            }

            // Get the specific table
            const table = await tableManager.getTable(body.iTableId);
            if (!table) {
                return res.reply(message.not_found('Table', req.query?.eLocale || 'en'));
            }

            // Check if table is full
            if (table.aPlayers.length >= table.nMaxPlayer) {
                return res.reply(message.no_vacant('Table is full', req.query?.eLocale || 'en'));
            }

            // Check if user is already in the table
            const existingPlayer = table.getPlayer(req.user._id);
            if (existingPlayer && !existingPlayer.bIsDroppedPlayer) {
                return res.reply(message.already_exists('You are already in this table', req.query?.eLocale || 'en'));
            }

            // Check if friend is in the table
            const friendPlayer = table.getPlayer(mongodb.mongify(body.iFriendUserId));
            if (!friendPlayer || friendPlayer.bIsDroppedPlayer) {
                return res.reply(message.not_found('Your friend is not in this table', req.query?.eLocale || 'en'));
            }

            // Check if table state allows joining
            if (table.eState === 'finished') {
                const ttl = await table.getSchedulerTTL('resetGameTimer');
                if (ttl <= 0) {
                    return res.reply(message.not_found('Table', req.query?.eLocale || 'en'));
                }
            }

            // Get table prototype for coin validation
            const tableProto = await Table.findOne({ _id: table.iTableId }).lean();
            if (!tableProto) {
                return res.reply(message.not_found('Table prototype', req.query?.eLocale || 'en'));
            }

            // Prevent non‑VIP users from joining VIP‑only tables
            if (tableProto.bIsVip && req.user.eUserType !== 'vip') {
                return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
            }

            // Check if user has enough coins
            const friendTableRound = tableProto.nMaxPlayer === 3 ? 5 : 4;
            if (req.user.nTotalCoins < tableProto.nTableFee * friendTableRound) {
                return res.reply(message.insufficient_balance('', req.query?.eLocale || 'en'));
            }

            // Set table and tableData for controller
            req.table = table;
            req.tableData = tableProto;
            return next();
        } catch (error) {
            console.log('joinState friend join error:', error);
            log.error('joinState friend join error:', error);
            return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        }
    }

    // Normal matchmaking flow
    if (!req.tableData) return res.reply(message.invalid_req('', req.query?.eLocale || 'en'));

    // Prevent non‑VIP users from matchmaking into VIP‑only tables
    if (req.tableData.bIsVip && req.user.eUserType !== 'vip') {
        return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
    }

    const userData = {
        _id: req.user._id,
        sEmail: req.user.sEmail,
        sUserName: req.user.sUserName,
        sAvatar: req.user.sAvatar,
        nTotalCoins: req.user.nTotalCoins,
    };

    const tableRound = req.tableData.nMaxPlayer === 3 ? 5 : 4;
    if (userData.nTotalCoins < req.tableData.nTableFee * tableRound) return res.reply(message.insufficient_balance('', req.query?.eLocale || 'en'));
    tableManager.searchEmptyTable(req.tableData, req.user._id, async (error, table) => {
        if (error) return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        if (!table) {
            req.table = await tableManager.createTable(req.tableData);
        } else req.table = table;
        // console.log(req.tableData.nTableFee);
        // console.log(tableRound);
        // console.log('before', req.user?.toJSON());
        // req.user = await User.findOneAndUpdate({ _id: req.user._id }, { $inc: { nTotalCoins: -req.tableData.nTableFee * tableRound } }, { new: true });
        // console.log('after', req.user?.toJSON());
        next();
    });
};

// create new sewaliPrivateTable based on the table prototype
middleware.createPrivateTable = async (req, res, next) => {
    try {
        req.privateTable = await tableManager.createPrivateTable(req.tableData); // req.tableData : table protoType data; // req.privateTable : actual table
    } catch (err) {
        log.debug('private table creation failed');
        log.error('createPrivateTable error:', err);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'));
    }
    return next();
};
module.exports = middleware;
