/* eslint-disable no-continue */
const axios = require('axios');
const { Table, SewaliPrivateTable, User, Settings, UserAchievements } = require('../../../../models');
const tableManager = require('../../../../TableManager');
const { mongodb } = require('../../../../utils');

const controllers = {};

controllers.addTable = (req, res) => {
    const body = _.pick(req.body, ['sName', 'nTableFee', 'eGameType', 'nMaxPlayer', 'bIsVip']);

    if (!body.sName) return res.reply(message.required_field('Name', req.query?.eLocale || 'en'));
    if (!body.nTableFee) return res.reply(message.required_field('Table fee', req.query?.eLocale || 'en'));
    if (!body.eGameType) return res.reply(message.required_field('Game type', req.query?.eLocale || 'en'));
    if (!body.nMaxPlayer) return res.reply(message.required_field('Max player', req.query?.eLocale || 'en'));

    const saveTable = new Table(body);
    saveTable.save((err) => {
        if (err) return res.reply(message.server_error('', req.query?.eLocale || 'en'));
        res.reply(message.successfully('Added', req.query?.eLocale || 'en'));
    });
};

// list table protos
controllers.getTable = (req, res) => {
    const query = { eGameType: req.params.eGameType };

    // If user is not VIP, only show normal tables.
    // VIP users can see all tables (normal + VIP).
    if (!req.user || req.user.eUserType !== 'vip') {
        query.bIsVip = false;
    }
    const project = {
        sName: 1,
        nTableFee: 1,
        nMaxPlayer: 1,
        eGameType: 1,
        bIsVip: 1,
    };

    Table.find(query, project, (err, data) => {
        if (err) return res.reply(message.server_error('', req.query?.eLocale || 'en'));
        const isVipUser = !!req.user && req.user.eUserType === 'vip';
        const sorted = data.sort((d1, d2) => {
            // For VIP users: VIP tables first, then normal tables; within each group, sort by fee.
            if (isVipUser) {
                const vipOrder = (d2.bIsVip === true ? 1 : 0) - (d1.bIsVip === true ? 1 : 0);
                if (vipOrder !== 0) return vipOrder;
            }
            return (d1.nTableFee || 0) - (d2.nTableFee || 0);
        });

        return res.reply(message.successfully('', req.query?.eLocale || 'en'), sorted);
    });
};

controllers.tipAmount = async (req, res) => {
    const redLock = await globalThis.Lock.acquire([_.genLockKey(req.user._id, 'USR:UPD')], _.REDLOCK_TTL_MS);
    try {
        const body = _.pick(req.body, ['nAmount']);
        body.nAmount = Number(body.nAmount);

        if (!body.nAmount) return res.reply(message.required_field('Winning Amount', req.query?.eLocale || 'en'));
        if (!body.nAmount < 0) body.nAmount = 0;

        const [user, setting] = await Promise.all([
            User.findOne({ _id: req.user._id }, { nTotalCoins: 1 }).lean(),
            Settings.findOne({}, { iTipGiverId: 1 }).lean(), //
        ]);
        if (!user) return res.reply(message.not_found('User', req.query?.eLocale || 'en'));
        if (!setting.iTipGiverId) return res.reply(message.not_found('Settings', req.query?.eLocale || 'en'));
        if (user.nTotalCoins < body.nAmount) return res.reply(message.insufficient_balance('', req.query?.eLocale || 'en'));

        // update achievement
        const parentAchievement = await UserAchievements.findOne({ iUserId: req.user._id, iAchievementId: setting.iTipGiverId }).lean();
        if (!parentAchievement) return res.reply(message.not_found('Achievement', req.query?.eLocale || 'en'));

        let currentChild = parentAchievement.aAchievements[0];
        let currentChildIndex = 0;
        for (let i = 0; i < parentAchievement.aAchievements.length; i += 1) {
            const child = parentAchievement.aAchievements[i];
            currentChild = child;
            currentChildIndex = i;
            if (child.nProgress < child.nTarget) break;
        }

        if (currentChild) {
            if (!['claimed', 'unclaimed'].includes(currentChild.eState)) {
                currentChild.eState = 'current';
                let diff = currentChild.nTarget - currentChild.nProgress;
                currentChild.nProgress = Math.min(currentChild.nProgress + body.nAmount, currentChild.nTarget);
                if (currentChild.nProgress === currentChild.nTarget) currentChild.eState = 'unclaimed';
                await UserAchievements.updateOne({ _id: parentAchievement._id, 'aAchievements._id': currentChild._id }, { $set: { 'aAchievements.$.nProgress': currentChild.nProgress, 'aAchievements.$.eState': currentChild.eState } });
                if (currentChild.eState === 'unclaimed') {
                    if (body.nAmount > diff) {
                        // eslint-disable-next-line prefer-const
                        let remainingAmount = body.nAmount - diff;
                        while (remainingAmount > 0) {
                            const nextChild = parentAchievement.aAchievements[currentChildIndex + 1];
                            if (!nextChild) break;
                            if (nextChild.nProgress < nextChild.nTarget) {
                                nextChild.eState = 'current';
                                diff = nextChild.nTarget - nextChild.nProgress;
                                nextChild.nProgress = Math.min(nextChild.nProgress + remainingAmount, nextChild.nTarget);
                                if (nextChild.nProgress === nextChild.nTarget) nextChild.eState = 'unclaimed';
                                await UserAchievements.updateOne({ _id: parentAchievement._id, 'aAchievements._id': nextChild._id }, { $set: { 'aAchievements.$.nProgress': nextChild.nProgress, 'aAchievements.$.eState': nextChild.eState } });
                                remainingAmount -= diff;
                            }
                            currentChildIndex += 1;
                        }
                    }
                }
            }
        }
        //
        await User.updateOne({ _id: req.user._id }, { $inc: { nTotalCoins: -body.nAmount } });

        // Update spendCoins daily challenge when giving tip
        (async () => {
            try {
                const baseUrl = process.env.NODE_ENV === 'dev' ? 'http://localhost:3401' : process.env.BASE_URL;
                const updatedUser = await User.findOne({ _id: req.user._id }, { sToken: 1 }).lean();
                if (updatedUser?.sToken) {
                    await axios.post(
                        `${baseUrl}/api/v1/profile/daillyChallange/progress`,
                        {
                            eChallengeType: 'spendCoins',
                            nProgress: body.nAmount,
                        },
                        {
                            headers: {
                                Authorization: updatedUser.sToken,
                                authorization: updatedUser.sToken,
                            },
                            timeout: 4000,
                        }
                    );
                }
            } catch (e) {
                log.error('Failed to update spendCoins challenge in tipAmount:', e?.message || e);
            }
        })();

        res.reply(message.successfully('Tip amount cut', req.query?.eLocale || 'en'), { nTotalCoins: user.nTotalCoins - body.nAmount });
        _.privateEmit(req.user._id, 'resUpdateCoins', { nTotalCoins: parseInt(user.nTotalCoins - body.nAmount, 10) });
    } catch (err) {
        log.error(`tipAmount(${req.body.nAmount}) failed for user ${req.user._id}`, err);
        res.reply(message.server_error('', req.query?.eLocale || 'en'));
    } finally {
        if (redLock && redLock.expiration > Date.now()) {
            await redLock.release();
        } else log.red(`${_.now()}::tipAmount(${req.user._id}):: redLock unable to release lock from key ${_.genLockKey(req.user._id, 'USR:UPD')}. auto released`);
    }
};

const fairPlay = require('../../../../FairPlay');

/** add player to table */
controllers.joinTable = async (req, res) => {
    if (!req.table) return res.reply(message.invalid_req('', req.query?.eLocale || 'en'));

    const playAllowed = fairPlay.isUserAllowedToPlay(req.user);
    if (!playAllowed.allowed) {
        if (playAllowed.reason === 'temp_restriction') {
            const r = fairPlay.getAuthRestrictionReply(req.user, req.query?.eLocale || 'en', 403);
            if (r) return res.reply(r);
            return res.reply(message.account_temp_restriction_fairplay('', req.query?.eLocale || 'en', undefined, 403));
        }
        const msg = playAllowed.reason === 'banned' ? message.user_blocked('', req.query?.eLocale || 'en') : message.noLocale('You are not allowed to play at this time.', 403);
        return res.reply(msg);
    }

    // not needed as it is already handled in MM middleware middleware.joinState
    const tableRound = req.tableData.nMaxPlayer === 3 ? 5 : 4;
    if (req.user.nTotalCoins < req.tableData.nTableFee * tableRound) return res.reply(message.insufficient_balance('', req.query?.eLocale || 'en'));
    //

    const params = {
        iTableId: req.table._id,
        protoData: req.table, // table proto data
        userData: req.user, // _id, nTotalCoins, eBadges, + // 'nMatchWon', 'nMatchLost', 'nTotalMatch'
    };

    tableManager.addPlayer(params, (error, response) => {
        console.log('joinTable error:', error);
        if (error) return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        if (!response) return res.reply(message.not_found('Table|Player', req.query?.eLocale || 'en'));
        res.reply(message.success('', req.query?.eLocale || 'en'), response); // {  "iTableId": "616489c6ea8a6460df0cbafd" }
    });
};

controllers.joinPrivateTable = async (req, res) => {
    let redLock;
    let sewaliPrivateTable;
    try {
        const playAllowed = fairPlay.isUserAllowedToPlay(req.user);
        if (!playAllowed.allowed) {
            if (playAllowed.reason === 'temp_restriction') {
                const r = fairPlay.getAuthRestrictionReply(req.user, req.query?.eLocale || 'en', 403);
                if (r) return res.reply(r);
                return res.reply(message.account_temp_restriction_fairplay('', req.query?.eLocale || 'en', undefined, 403));
            }
            const msg = playAllowed.reason === 'banned' ? message.user_blocked('', req.query?.eLocale || 'en') : message.noLocale('You are not allowed to play at this time.', 403);
            return res.reply(msg);
        }

        if (!req.privateTable?._id) return res.reply(message.invalid_req('', req.query?.eLocale || 'en'));

        const body = _.pick(req.body, ['iReceiverId', 'sMessage']);
        const iReceiverId = body.iReceiverId ? mongodb.mongify(body.iReceiverId) : undefined;

        // If receiverId is provided (challenge flow), ensure receiver exists and is active
        let receiver;
        if (iReceiverId) {
            receiver = await User.findOne({ _id: iReceiverId, eStatus: 'y' }).lean();
            if (!receiver) return res.reply(message.not_found('Receiver', req.query?.eLocale || 'en'));
        }

        console.log('req.privateTable', req.privateTable._id);
        [redLock, sewaliPrivateTable] = await Promise.all([
            globalThis.Lock.acquire([_.genLockKey(req.privateTable._id, `TBL:PVT`)], _.REDLOCK_TTL_MS),
            SewaliPrivateTable.findOne({ _id: req.privateTable._id }).lean(), //
        ]);
        console.log('sewaliPrivateTable', req.params, req.body, sewaliPrivateTable);
        if (!sewaliPrivateTable) return res.reply(message.not_found('PrivateTable', req.query?.eLocale || 'en'));
        const playersCount = Array.isArray(sewaliPrivateTable.aPlayers) ? sewaliPrivateTable.aPlayers.length : 0;
        if (sewaliPrivateTable.eGameType === 'sewali' && playersCount > 2) return res.reply(message.no_vacant('', req.query?.eLocale || 'en'));
        if (sewaliPrivateTable.eGameType === 'charwali' && playersCount > 3) return res.reply(message.no_vacant('', req.query?.eLocale || 'en'));

        // Prevent non‑VIP users from joining VIP‑only private tables
        if (req.tableData?.bIsVip && req.user.eUserType !== 'vip') {
            return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
        }
        const tableRound = req.tableData.nMaxPlayer === 3 ? 5 : 4;
        if (req.user.nTotalCoins < req.tableData.nTableFee * tableRound) return res.reply(message.insufficient_balance('', req.query?.eLocale || 'en'));

        const params = {
            iTableId: req.privateTable._id,
            protoData: req.privateTable,
            userData: req.user,
        };

        tableManager.addPrivatePlayer(params, async (error, response) => {
            console.log('joinPrivateTable addPrivatePlayer error:', error);
            if (error) return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
            if (!response) return res.reply(message.not_found('Table|Player', req.query?.eLocale || 'en'));

            // If this request was triggered as a challenge (has iReceiverId),
            // emit a socket event to the receiver with private table info.
            if (iReceiverId) {
                await _.privateEmit(iReceiverId.toString(), 'resPrivateTableChallenge', {
                    iSenderId: req.user._id.toString(),
                    sSenderUserName: req.user.sUserName,
                    sSenderAvatar: req.user.sAvatar || '',
                    sMessage: body.sMessage || '',
                    iTableId: response.iTableId?.toString() || req.privateTable._id.toString(),
                    sCode: response.sCode || req.privateTable.sCode,
                    sType: 'private', // Added type field ('public'/'private') as requested
                    oTableInfo: {
                        sName: req.tableData.sName,
                        nTableFee: req.tableData.nTableFee,
                        eGameType: req.tableData.eGameType,
                        nMaxPlayer: req.tableData.nMaxPlayer,
                    },
                    dCreatedDate: new Date(),
                });
            }

            res.reply(message.success('', req.query?.eLocale || 'en'), response); // { sCode: this.sCode, iTableId: this._id }
        });
    } catch (err) {
        console.log('joinPrivateTable catch error:', err);
        log.error(`joinPrivateTable(${req.privateTable?._id}) failed for user ${req.user?._id}`, err);
        res.reply(message.server_error('', req.query?.eLocale || 'en'));
    } finally {
        try {
            if (redLock && redLock.expiration > Date.now()) await redLock.release();
        } catch (e) {
            console.log('joinPrivateTable redLock release error:', e);
        }
    }
};

module.exports = controllers;
