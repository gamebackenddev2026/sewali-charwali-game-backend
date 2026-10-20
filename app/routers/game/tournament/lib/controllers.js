/* eslint-disable global-require */
/* eslint-disable no-console */
const { Tournament, User, TournamentUser } = require('../../../../models');
const { redis, mongodb } = require('../../../../utils');

const controllers = {};

// ---------------------- TOURNAMENT ------------------------------

controllers.register = async (req, res) => {
    try {
        const { iTournamentId } = _.pick(req.body, ['iTournamentId']);
        if (!iTournamentId) return res.reply(message.required_field('iTournamentId', req.query?.eLocale || 'en'));
        const [tournament, user, tUser] = await Promise.all([
            Tournament.findOne({ _id: iTournamentId }, { _id: 1, nEntryFee: 1, eStatus: 1, nTotalSeat: 1, aUsers: 1, dScheduledAt: 1, dRegistrationStartAt: 1, dRegistrationEndAt: 1 }), // eStatus: { $in: ['created', 'scheduled'] }
            User.findOne({ _id: req.user._id }, { _id: 1, sUserName: 1, nTotalCoins: 1 }), //
            TournamentUser.findOne({ iTournamentId, iUserId: req.user._id }, { _id: 1 }),
        ]);

        if (!user) return res.reply(message.not_found('user'));
        if (!tournament) return res.reply(message.not_found('Tournament', req.query?.eLocale || 'en'));
        if (tUser) return res.reply(message.already_registered('user', req.query?.eLocale || 'en'));
        if (tournament.aUsers.length >= tournament.nTotalSeat) return res.reply(message.no_vacant('', req.query?.eLocale || 'en'));
        if (user.nTotalCoins < tournament.nEntryFee) return res.reply(message.insufficient('balance', req.query?.eLocale || 'en'));
        if (new Date(tournament.dRegistrationEndAt).getTime() < new Date().getTime()) return res.reply(message.registration_closed('Tournament', req.query?.eLocale || 'en'));

        const tournamentUser = new TournamentUser({
            iTournamentId: tournament._id,
            iUserId: user._id,
            sUserName: user.sUserName,
            eStatus: 'registered',
        });

        tournament.aUsers.push(user._id);
        const entryFee = tournament.nEntryFee || 0;
        user.nTotalCoins -= entryFee;

        await Promise.all([
            user.save(),
            tournament.save(),
            tournamentUser.save(), //
        ]);

        // Update spendCoins daily challenge when paying tournament entry fee
        if (entryFee > 0) {
            (async () => {
                try {
                    const axios = require('axios');
                    const baseUrl = process.env.NODE_ENV === 'dev' ? 'http://localhost:3401' : process.env.BASE_URL;
                    const updatedUser = await User.findOne({ _id: user._id }, { sToken: 1 }).lean();
                    if (updatedUser?.sToken) {
                        await axios.post(
                            `${baseUrl}/api/v1/profile/daillyChallange/progress`,
                            {
                                eChallengeType: 'spendCoins',
                                nProgress: entryFee,
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
                    log.error('Failed to update spendCoins challenge in tournament registration:', e?.message || e);
                }
            })();
        }

        return res.reply(message.success('registered', req.query?.eLocale || 'en'), { nTotalCoins: user.nTotalCoins });
    } catch (error) {
        log.red('t register error', error.message);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

controllers.view = async (req, res) => {
    try {
        const { iTournamentId } = _.pick(req.params, ['iTournamentId']);

        const [tournament] = await Tournament.aggregate([
            { $match: { _id: mongodb.mongify(iTournamentId) } },
            {
                $lookup: {
                    from: 'TournamentUser',
                    let: { iTournamentId: '$_id', aUserIds: '$aUsers' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [{ $eq: ['$iTournamentId', '$$iTournamentId'] }, { $in: ['$iUserId', '$$aUserIds'] }],
                                },
                            },
                        },
                    ],
                    as: 'aUsers',
                },
            },
            //
        ]).exec();
        // console.log('tournament', tournament);
        if (!tournament) return res.reply(message.not_found('Tournament', req.query?.eLocale || 'en'));
        tournament.nActiveUser = tournament.aUsers.filter((u) => u.eStatus === 'active').length;
        tournament.nInactiveUser = tournament.aUsers.filter((u) => u.eStatus === 'inactive').length;
        tournament.nRemovedUser = tournament.aUsers.filter((u) => u.eStatus === 'removed').length;
        tournament.nRegisteredUser = tournament.aUsers.filter((u) => u.eStatus === 'registered').length;
        tournament.bIsShowJoinButton = tournament.dScheduledAt <= new Date() && !['matchMaking', 'running', 'completed', 'canceled'].includes(tournament.eStatus);
        let nTotalCoinsCollected = tournament.nEntryFee * tournament.aUsers.length;
        if (nTotalCoinsCollected < tournament.nEntryFee * tournament.nRequiredSeat) nTotalCoinsCollected = tournament.nEntryFee * tournament.nRequiredSeat;
        tournament.aPrize = [Math.round(nTotalCoinsCollected * 0.5), Math.round(nTotalCoinsCollected * 0.3), Math.round(nTotalCoinsCollected * 0.2)];
        log.red(tournament.dScheduledAt, new Date(), tournament.bIsShowJoinButton);
        res.reply(message.success('', req.query?.eLocale || 'en'), tournament);
    } catch (error) {
        log.red('t view error', error.message);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

controllers.list = async (req, res) => {
    try {
        const body = _.pick(req.body, ['nLimit', 'search', 'sort', 'orderBy', 'nStart', 'dateFrom', 'dateTo', 'eMode', 'eGameType', 'eStatus', 'dScheduledAt', 'dRegistrationStartAt', 'dRegistrationEndAt']);
        const sort = {};
        if (!body.sort) sort.dCreatedDate = -1;
        if (body.sort) sort[body.sort] = body.orderBy === 'DESC' ? -1 : 1;
        const skip = parseInt(body.nStart || 0) * parseInt(body.nLimit || 0);
        const limit = parseInt(body.nLimit ? body.nLimit : 10);
        const search = _.searchRegex(body.search);

        const match = {};
        if (body.eMode) match.eMode = body.eMode;
        if (body.eGameType) match.eGameType = body.eGameType;
        if (body.eStatus) match.eStatus = body.eStatus;
        if (body.dScheduledAt) match.dScheduledAt = body.dScheduledAt;
        if (body.dRegistrationStartAt) match.dRegistrationStartAt = body.dRegistrationStartAt;
        if (body.dRegistrationEndAt) match.dRegistrationEndAt = body.dRegistrationEndAt;
        if (body.dateFrom && body.dateTo) {
            const dateFrom = body.dateFrom ? new Date(body.dateFrom) : undefined;
            const dateTo = body.dateTo ? new Date(body.dateTo) : undefined;
            match.dCreatedDate = { $gte: new Date(dateFrom), $lte: new Date(dateTo) };
        }

        const facetArray = [
            {
                $sort: sort,
            },
            {
                $skip: skip,
            },
            {
                $limit: limit,
            },
        ];

        const query = [
            {
                $set: {
                    dVisibleUntil: { $add: ['$dScheduledAt', { $multiply: ['$nLobbyTime', 1000] }] },
                },
            },
            {
                $match: match,
            },
            { $match: { dVisibleUntil: { $gte: new Date() }, eStatus: { $nin: ['canceled', 'completed', 'created'] } } },
            {
                $project: {
                    _id: 1,
                    iPrototypeId: 1,
                    sTitle: 1,
                    nTotalSeat: 1,
                    nRequiredSeat: 1,
                    nTurnTime: 1,
                    nLobbyTime: 1,
                    nTablePoint: 1,
                    nEntryFee: 1,
                    nNonEliminatorRound: 1,
                    eMode: 1,
                    eGameType: 1,
                    eStatus: 1,
                    aUsers: 1,
                    aPrize: 1,
                    dScheduledAt: 1,
                    dRegistrationStartAt: 1,
                    dRegistrationEndAt: 1,
                    dCreatedDate: 1,
                    dUpdatedDate: 1,
                },
            },
            {
                $lookup: {
                    from: 'TournamentUser',
                    let: { iTournamentId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [{ $eq: ['$iTournamentId', '$$iTournamentId'] }],
                                },
                            },
                        },
                        {
                            $project: {
                                _id: 0,
                                iUserId: 1,
                                sUserName: 1,
                                eStatus: 1,
                                nScore: 1,
                                nRoundWon: 1,
                                nTournamentRoundPlayed: 1,
                                nAmountWon: 1,
                                aDeclaredHand: 1,
                            },
                        },
                    ],
                    as: 'aUsers',
                },
            },
            {
                $match: {
                    $or: [
                        {
                            sTitle: { $regex: new RegExp(`^.*${search}.*`, 'i') },
                        },
                    ],
                },
            },
            {
                $facet: {
                    list: facetArray,
                    count: [
                        {
                            $count: 'total',
                        },
                    ],
                },
            },
            {
                $unwind: '$count',
            },
        ];
        let [tournament] = await Tournament.aggregate(query).exec();
        tournament?.list?.forEach((t) => {
            if (t.aUsers.some((u) => u.iUserId.toString() === req.user._id.toString())) t.bIsRegistered = true;
            else t.bIsRegistered = false;
            t.nActiveUser = t.aUsers.filter((u) => u.eStatus === 'active').length;
            t.nInactiveUser = t.aUsers.filter((u) => u.eStatus === 'inactive').length;
            t.nRemovedUser = t.aUsers.filter((u) => u.eStatus === 'removed').length;
            t.nRegisteredUser = t.aUsers.filter((u) => u.eStatus === 'registered').length;
            let nTotalCoinsCollected = t.nEntryFee * t.aUsers.length;
            if (nTotalCoinsCollected < t.nEntryFee * t.nRequiredSeat) nTotalCoinsCollected = t.nEntryFee * t.nRequiredSeat;
            t.aPrize = [Math.round(nTotalCoinsCollected * 0.5), Math.round(nTotalCoinsCollected * 0.3), Math.round(nTotalCoinsCollected * 0.2)];
            t.bIsShowJoinButton = t.bIsRegistered && new Date(t.dScheduledAt).getTime() <= new Date().getTime() + 1000 && !['running', 'completed', 'canceled'].includes(tournament.eStatus);
            // log.cyan(req.user._id.toString(), t.bIsRegistered, new Date(t.dScheduledAt).getTime(), new Date().getTime() + 1000, t.bIsShowJoinButton);
        });
        if (!tournament?.list) tournament = { list: [], count: { total: 0, registered: 0, unregistered: 0 } };
        tournament.list = tournament?.list?.filter((t) => {
            if (t.bIsRegistered) return true;
            // log.cyan('!!!!', req.user._id.toString(), new Date(t.dRegistrationEndAt), new Date());
            if (new Date(t.dRegistrationEndAt).getTime() > new Date().getTime() + 1000) return true;
            return false;
        });
        tournament.count.total = tournament?.list?.length || 0;
        tournament.count.registered = tournament?.list?.filter((t) => t.bIsRegistered).length;
        tournament.count.unregistered = tournament?.list?.filter((t) => !t.bIsRegistered).length;
        // log.cyan(req.user._id.toString(), tournament.list);
        res.reply(message.success('', req.query?.eLocale || 'en'), tournament);
    } catch (error) {
        log.red('t list error', error.message);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

/*  INTERNAL SERVER COMMUNICATION  */
controllers.initiateScheduler = async (req, res) => {
    try {
        const body = _.pick(req.body, ['iTournamentId', 'dScheduledAt']);
        const { iTournamentId, dScheduledAt } = { ...body, dScheduledAt: new Date(body.dScheduledAt) };

        console.log('initiateScheduler Tournament', body);
        const now = new Date().getTime();

        const tournament = await Tournament.findOne({ _id: iTournamentId });
        if (!tournament) return res.reply(message.not_found('Tournament'));

        const nTtlToDisableRegistration = parseInt((new Date(tournament.dRegistrationEndAt).getTime() - now) / 1000, 10);
        const nTournamentStartInSec = parseInt((dScheduledAt.getTime() - now) / 1000, 10);
        const nTtlNotifyUserInSec = nTournamentStartInSec - 60; // 1 min before tournament start
        const nTtlBeginMMInSec = nTournamentStartInSec + tournament.nLobbyTime; // after lobby time ends

        console.log('initiateScheduler Tournament', { iTournamentId, nTournamentStartInSec, nTtlNotifyUserInSec, nTtlBeginMMInSec, dScheduledAt });

        await Promise.all([
            redis.setEx(_.getTournamentKey('reqNotifyUser', iTournamentId), nTtlNotifyUserInSec, `ttl:${nTtlNotifyUserInSec}:date:${new Date(Date.now() + nTtlNotifyUserInSec * 1000).toLocaleString()}`),
            redis.setEx(_.getTournamentKey('reqDisableRegistration', iTournamentId), nTtlToDisableRegistration, `ttl:${nTtlToDisableRegistration}:date:${new Date(Date.now() + nTtlToDisableRegistration * 1000).toLocaleString()}`),
            redis.setEx(_.getTournamentKey('reqEnableJoining', iTournamentId), nTournamentStartInSec, `ttl:${nTournamentStartInSec}:date:${new Date(Date.now() + nTournamentStartInSec * 1000).toLocaleString()}`),
            redis.setEx(_.getTournamentKey('reqBeginMM', iTournamentId), nTtlBeginMMInSec, `ttl:${nTournamentStartInSec}:date:${new Date(Date.now() + nTtlBeginMMInSec * 1000).toLocaleString()}`), //
        ]);
        res.reply(message.success('', req.query?.eLocale || 'en'), { iTournamentId, nTournamentStartInSec, nTtlNotifyUserInSec, nTtlBeginMMInSec, dScheduledAt });
    } catch (error) {
        console.log('initiateScheduler error', error.message);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

module.exports = controllers;
