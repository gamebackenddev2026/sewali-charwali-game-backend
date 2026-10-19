const axios = require('axios');
const { mongodb } = require('../utils');
const { Tournament, TournamentUser, User, TableHistory } = require('../models');
const tableManager = require('../TableManager');
const emitter = require('../../globals/lib/emitter');

function TournamentManager() {
    // emitter.on('reqSchedule', this.scheduleTask.bind(this));
    // redis keyspace events
    emitter.on('reqNotifyUser', this.notifyUser.bind(this)); // notification sent 1 min before tournament start
    emitter.on('reqDisableRegistration', this.emitUserToRefreshTournament.bind(this)); // notification sent 1 min before tournament start
    emitter.on('reqEnableJoining', this.enableJoining.bind(this)); // this enable user to join tournament
    emitter.on('reqBeginMM', this.matchMake.bind(this));
    // user events
    emitter.on('reqLeaderBoard', this.getLeaderBoard.bind(this));
    //
    emitter.on('broadCastLeaderBoard', this.broadCastLeaderBoard.bind(this));
    emitter.on('broadCastResult', this.broadCastResult.bind(this));
    emitter.on('endRound', this.endRound.bind(this));
    emitter.on('reMatchMake', this.reMatchMake.bind(this));
    // //
    emitter.on('cancelTournament', this.cancel.bind(this));
    emitter.on('leaveTournament', this.leave.bind(this));
    // //
    emitter.on('finishTournament', this.finish.bind(this));
}

/**
 * Update daily challenge progress for tournament players
 * @param {string|ObjectId} iUserId - User ID
 * @param {string[]} challengeTypes - Array of challenge types to update
 * @param {number} nProgress - Progress amount (default: 1)
 */
TournamentManager.prototype.updateDailyChallengeProgress = async function (iUserId, challengeTypes, nProgress = 1) {
    try {
        // Get user token from database
        const user = await User.findOne({ _id: mongodb.mongify(iUserId) }).lean();
        if (!user || !user.sToken) {
            log.error(`User token not found for userId: ${iUserId}`);
            return;
        }

        // Get daily challenges list
        const baseUrl = process.env.NODE_ENV === 'dev' ? 'http://localhost:3401' : process.env.BASE_URL;
        const response = await axios.get(`${baseUrl}/api/v1/daily-challenge/list`, {
            headers: {
                Authorization: user.sToken,
            },
            timeout: 4000,
        });

        const { data } = response.data || {};
        if (!data) return;

        // Combine daily and weekly challenges
        const allChallenges = [...(data.daily || []), ...(data.weekly || [])];

        // Filter challenges by type and update progress
        const challengesToUpdate = allChallenges.filter((challenge) => challengeTypes.includes(challenge.eChallengeType) && !challenge.isCompleted);

        // Update progress for each matching challenge
        for (const challenge of challengesToUpdate) {
            try {
                await axios.post(
                    `${baseUrl}/api/v1/profile/daillyChallange/progress`,
                    {
                        eChallengeType: challenge.eChallengeType,
                        nProgress,
                    },
                    {
                        headers: {
                            Authorization: user.sToken,
                        },
                        timeout: 4000,
                    }
                );
            } catch (error) {
                log.error(`Failed to update daily challenge progress for challenge ${challenge._id}:`, error?.message || error);
            }
        }
    } catch (error) {
        log.error(`Failed to update daily challenge progress for userId ${iUserId}:`, error?.message || error);
    }
};

/** user will get notified to join tournament */
TournamentManager.prototype.notifyUser = async function (params = {}, callback = () => { }) {
    try {
        const { iTournamentId } = params;
        if (!iTournamentId) return _.abort('iTournamentId not present in param', callback);

        const tournament = await Tournament.findOne({ _id: iTournamentId });
        if (!tournament) return _.abort(`tournament not found with iTournamentId ${iTournamentId}`, callback);

        if (!tournament?.aUsers?.length) return _.abort(`no user registered in the tournament with iTournamentId ${iTournamentId}`, callback);

        const ttlInSec = (new Date(tournament.dScheduledAt).getTime() - Date.now()) / 1000;
        if (ttlInSec < 0) _.abort(`can't notify as scheduled time already passed. \ntournament.dScheduledAt[${tournament.dScheduledAt}] < new Date()[${new Date()}].`, callback);

        tournament?.aUsers.forEach((iUserId) => {
            _.privateEmit(iUserId, 'resTournamentReminder', { iTournamentId, sTitle: tournament?.sTitle ?? '', nTtl: ttlInSec });
        });
        return callback(null, {});
    } catch (error) {
        callback(error);
    }
};

TournamentManager.prototype.emitUserToRefreshTournament = async function (params = {}, callback = () => { }) {
    try {
        // const { iTournamentId } = params;
        log.green('emitUserToRefreshTournament', params);
        globalThis.io.emit('resRefreshTournament');
        return callback(null, {});
    } catch (error) {
        log.red('emitUserToRefreshTournament failed', error);
        callback(error);
    }
};

/** active user can get event to join tournament */
TournamentManager.prototype.enableJoining = async function (params = {}, callback = () => { }) {
    try {
        const { iTournamentId } = params;
        if (!iTournamentId) return _.abort('iTournamentId not present in param', callback);

        const tournament = await Tournament.findOne({ _id: iTournamentId }, { _id: 1, eStatus: 1, aUsers: 1, sTitle: 1 });
        if (!tournament) return _.abort(`tournament not found with iTournamentId ${iTournamentId}`, callback);

        tournament.eStatus = 'waiting';
        await tournament.save().catch(_.errorCallback);

        if (!tournament?.aUsers?.length) return _.abort(`no user registered in the tournament with iTournamentId ${iTournamentId}`, callback);

        tournament?.aUsers.forEach((iUserId) => {
            _.privateEmit(iUserId, 'resTournamentStart', { iTournamentId, sTitle: tournament?.sTitle ?? '' });
        });
        return callback(null, {});
    } catch (error) {
        callback(error);
    }
};

TournamentManager.prototype.joinTournament = async function (params = {}, callback = () => { }) {
    let redLock;
    try {
        const { iTournamentId, iUserId } = params;
        if (!iTournamentId) return _.abort('iTournamentId not present in param', callback);
        if (!iUserId) return _.abort('iUserId not present in param', callback);

        // - log.cyan(`${_.now()}::TableManager.prototype.joinTournament():: redLock acquiring a lock on key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}`);
        redLock = await globalThis.Lock.acquire([_.genLockKey(params.iTournamentId, 'JOIN_TRN')], _.REDLOCK_TTL_MS * 2); // ms
        // - log.cyan(`${_.now()}::TableManager.prototype.joinTournament():: redLock acquired a lock on key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}`);

        const [tournament, user, tUser] = await Promise.all([
            Tournament.findOne({ _id: iTournamentId }, { _id: 1, nEntryFee: 1, eStatus: 1, nTotalSeat: 1, aUsers: 1, dScheduledAt: 1, dRegistrationStartAt: 1, dRegistrationEndAt: 1 }), // eStatus: { $in: ['created', 'scheduled'] }
            User.findOne({ _id: mongodb.mongify(iUserId) }, { _id: 1, sUserName: 1, nTotalCoins: 1, iLastTournamentId: 1 }), //
            TournamentUser.findOne({ iTournamentId: mongodb.mongify(iTournamentId), iUserId: mongodb.mongify(iUserId) }, { _id: 1 }),
        ]);
        if (!tournament) return _.abort(`tournament not found with iTournamentId ${iTournamentId}`, callback);
        if (!user) return _.abort(`user not found with iTournamentId ${iUserId}`, callback);
        if (!tUser) return _.abort(`not registered`, callback);

        if (!tournament?.aUsers?.length) return _.abort(`no user registered in the tournament with iTournamentId ${iTournamentId}`, callback);
        if (!['waiting', 'scheduled'].includes(tournament?.eStatus)) return _.abort(`tournament not open for joining with iTournamentId ${iTournamentId}`, callback);

        tUser.eStatus = 'waiting'; // 'registered', 'waiting', 'playing', 'disconnected', 'removed', 'left'

        user.iLastTournamentId = tournament._id;

        await Promise.all([
            user.save(),
            tUser.save(), //
        ]);
        emitter.emit('broadCastLeaderBoard', { iTournamentId });

        return callback(null, { users: tUser });
    } catch (error) {
        log.error(error);
        callback(error);
    } finally {
        if (redLock && redLock.expiration > Date.now()) {
            await redLock.release();
            // log.green(`${_.now()}::TableManager.prototype.joinTournament():: redLock released a lock on key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}`);
        } else log.red(`${_.now()}::TableManager.prototype.joinTournament():: redLock unable to release lock from key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}. auto released`);
    }
};

TournamentManager.prototype.getLeaderBoard = async function (params = {}, callback = () => { }) {
    try {
        const { iTournamentId } = params;
        if (!iTournamentId) return _.abort('iTournamentId not present in param', callback);

        const [tournament, tUsers] = await Promise.all([
            Tournament.findOne({ _id: mongodb.mongify(iTournamentId) }, { _id: 1 }).lean(),
            TournamentUser.find({ iTournamentId: mongodb.mongify(iTournamentId) }, { iUserId: 1, sUserName: 1, eStatus: 1, nScore: 1, nRoundWon: 1, nTournamentRoundWon: 1, nTournamentRoundPlayed: 1, dCreatedDate: 1 })
                .sort({ nTournamentRoundWon: -1, nRoundWon: -1, nTournamentRoundPlayed: -1, nScore: -1, dCreatedDate: 1 })
                .lean(),
        ]);
        if (!tournament) return _.abort(`tournament not found with iTournamentId ${iTournamentId}`, callback);
        if (!tUsers?.length) return _.abort(`no user registered in the tournament with iTournamentId ${iTournamentId}`, callback);

        const result = [];
        let i = 1;
        for (const player of tUsers) {
            if (player && !['registered', 'disconnected', 'removed', 'left'].includes(player.eStatus)) {
                result.push({ rank: i, player, score: parseInt(player?.nScore || 0) }); // player: {iUserId, sUserName, dRegisteredAt, eStatus}
                i += 1;
            }
        }

        callback(null, { iTournamentId, sTitle: tournament.sTitle, nCurrentRound: tournament.nCurrentRound, aLeaderBoard: result });
        return result;
    } catch (error) {
        callback(error);
        return null;
    }
};

TournamentManager.prototype.broadCastLeaderBoard = async function (params = {}, callback = () => { }) {
    try {
        log.green('broadCastLeaderBoard', params);
        const { iTournamentId, iUserId } = params;
        if (!iTournamentId) return _.abort('iTournamentId not present in param', callback);

        // const tournament = await Tournament.findOne({ _id: iTournamentId, eStatus: { $in: ['waiting', 'matchMaking', 'running'] } });
        const [tournament, tUsers] = await Promise.all([
            Tournament.findOne({ _id: mongodb.mongify(iTournamentId), eStatus: { $in: ['waiting', 'matchMaking', 'running'] } }, { _id: 1, eStatus: 1, aUsers: 1 }).lean(),
            TournamentUser.find({ iTournamentId: mongodb.mongify(iTournamentId) }, { iUserId: 1, sUserName: 1, eStatus: 1, nScore: 1, nRoundWon: 1, nTournamentRoundWon: 1, nTournamentRoundPlayed: 1, dCreatedDate: 1 })
                .sort({ nTournamentRoundWon: -1, nRoundWon: -1, nTournamentRoundPlayed: -1, nScore: -1, dCreatedDate: 1 })
                .lean(),
        ]);
        if (!tournament) return _.abort(`tournament either not found with iTournamentId ${iTournamentId} or is not active`, callback);
        if (!tUsers?.length) return _.abort(`no user registered in the tournament with iTournamentId ${iTournamentId}`, callback);

        const result = [];
        let i = 1;
        for (const player of tUsers) {
            if (player && !['registered', 'disconnected', 'removed', 'left'].includes(player.eStatus)) {
                result.push({
                    rank: i,
                    player,
                    score: parseInt(player?.nTournamentRoundWon * 1000 || 0) + parseInt(player?.nRoundWon * 100 || 0) + parseInt(player?.nScore || 0),
                }); // player: {iUserId, sUserName, dRegisteredAt, eStatus}
                i += 1;
            }
        }
        if (iUserId) {
            _.privateEmit(iUserId?.toString(), 'resLeaderBoard', { iTournamentId, sTitle: tournament.sTitle, nCurrentRound: tournament.nCurrentRound, aLeaderBoard: result });
            log.green('resLeaderBoard emitted privately to user', iUserId, JSON.stringify({ iTournamentId, sTitle: tournament.sTitle, nCurrentRound: tournament.nCurrentRound, aLeaderBoard: result }));
            callback(null, { result, nCurrentRound: tournament.nCurrentRound });
            return result;
        }
        tUsers.forEach((user) => {
            if (['registered', 'playing', 'disconnected', 'removed', 'left'].includes(user.eStatus)) return; // only show to waiting player
            log.blue('resLeaderBoard emitted to user', user.iUserId, user.eStatus);
            const response = { iTournamentId, sTitle: tournament.sTitle, nCurrentRound: tournament.nCurrentRound, aLeaderBoard: result };
            // log.blue('resLeaderBoard', response);
            _.privateEmit(user.iUserId, 'resLeaderBoard', response); // resTournamentLeaderBoard -> resLeaderBoard
        });
        callback(null, { result, nCurrentRound: tournament.nCurrentRound });
        return result;
    } catch (error) {
        callback(error);
        return null;
    }
};

TournamentManager.prototype.broadCastResult = async function (params = {}, callback = () => { }) {
    try {
        log.green('broadCastResult', params);
        const { iTournamentId, iUserId } = params;
        if (!iTournamentId) return _.abort('iTournamentId not present in param', callback);
        if (!iUserId) return _.abort('iUserId not present in param', callback);

        const tournament = await Tournament.findOne({ _id: mongodb.mongify(iTournamentId) }, { _id: 1, eStatus: 1, aUsers: 1, aWinner: 1, nEntryFee: 1, eGameType: 1 }).lean();
        if (!tournament?.eGameType) return _.abort(`tournament either not found with iTournamentId ${iTournamentId} or is not active`, callback);

        const nTotalCoinsCollected = tournament.nEntryFee * tournament.aUsers.length;
        const prizes = [Number((nTotalCoinsCollected * 0.5).toFixed(2)), Number((nTotalCoinsCollected * 0.3).toFixed(2)), Number((nTotalCoinsCollected * 0.2).toFixed(2))];

        const { aWinner } = tournament;

        const promises = aWinner?.filter((x) => x)?.map((winner) => User.findOne({ _id: mongodb.mongify(winner?.iUserId) }, { _id: 1, sUserName: 1, nTotalCoins: 1 }));
        const ranks = await Promise.all(promises);

        const response = ranks.map((rank, idx) => {
            const winner = {};
            winner.nRank = aWinner[idx].nRank;
            winner.nRoundWon = aWinner[idx].nTournamentRoundWon;
            winner.nRoundPlayed = aWinner[idx].nTournamentRoundPlayed;
            winner.nScore = parseInt(aWinner[idx]?.nTournamentRoundWon * 1000 || 0) + parseInt(aWinner[idx]?.nRoundWon * 100 || 0) + parseInt(aWinner[idx]?.nScore || 0);
            winner.nAmountWon = aWinner[idx].nAmountWon;
            winner.iUserId = rank._id;
            winner.sUserName = rank.sUserName;
            winner.nTotalCoins = Math.round(rank.nTotalCoins);
            return winner;
        });

        _.privateEmit(iUserId?.toString(), 'resTournamentResult', response);
        log.green('resTournamentResult emitted privately to user', iUserId, JSON.stringify(response));
        callback(null, response);
        await User.updateOne({ _id: mongodb.mongify(iUserId.toString()) }, { $set: { iLastTournamentId: null } });
        return response;
    } catch (error) {
        callback(error);
        return null;
    }
};

TournamentManager.prototype.matchMake = async function (params = {}, callback = () => { }) {
    let redLock;
    try {
        const { iTournamentId } = params;
        // - log.cyan(`${_.now()}::TableManager.prototype.matchMake():: redLock acquiring a lock on key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}`);
        redLock = await globalThis.Lock.acquire([_.genLockKey(params.iTournamentId, 'JOIN_TRN')], _.REDLOCK_TTL_MS * 2); // ms
        // - log.cyan(`${_.now()}::TableManager.prototype.matchMake():: redLock acquired a lock on key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}`);

        log.blue('matchMake called', params);
        if (!iTournamentId) return _.abort('iTournamentId not present in param', callback);

        const [tournament, tUsers] = await Promise.all([
            Tournament.findOne({ _id: mongodb.mongify(iTournamentId), eStatus: { $in: ['waiting', 'matchMaking', 'running'] } }, { _id: 1, sTitle: 1, eStatus: 1, aUsers: 1, eGameType: 1, nRequiredSeat: 1, nEntryFee: 1, oLog: 1, nCurrentRound: 1, nTurnTime: 1 }),
            TournamentUser.find({ iTournamentId: mongodb.mongify(iTournamentId) }, { iUserId: 1, sUserName: 1, eStatus: 1, nScore: 1, nRoundWon: 1, nTournamentRoundWon: 1, nTournamentRoundPlayed: 1, dCreatedDate: 1 }).sort({ nTournamentRoundWon: -1, nRoundWon: -1, nScore: -1, dCreatedDate: 1 }),
        ]);
        if (!tournament) return _.abort(`tournament not found with iTournamentId ${iTournamentId}`, callback);

        // update state to stop other player from joining once MM start
        // tournament.eStatus = 'matchMaking';
        tournament.eStatus = 'running';
        await tournament.save();

        if (!tUsers?.length) {
            return emitter.emit('cancelTournament', { iTournamentId, sReason: `no enough user registered [${0}/${tournament?.nRequiredSeat}]` }, callback);
        }

        const connectedUser = tUsers.filter((user) => user.eStatus === 'waiting');
        if (connectedUser.length < tournament.nRequiredSeat) {
            tournament.eStatus = 'canceled';
            return emitter.emit('cancelTournament', { iTournamentId, sReason: `no enough user connected [${connectedUser.length}/${tournament?.nRequiredSeat}]` }, callback);
        }

        // remove excess player
        const playerPerTable = tournament.eGameType === 'sewali' ? 3 : 4;
        const requiredTable = parseInt(connectedUser.length / playerPerTable);

        log.green('playerPerTable', playerPerTable);
        log.green('requiredTable', requiredTable);

        for (let i = playerPerTable * requiredTable; i < connectedUser.length; i += 1) {
            const player = connectedUser[i];
            player.eStatus = 'removed';
            _.privateEmit(player.iUserId?.toString(), 'resTournamentKickout', { sReason: 'There are not enough player available! we have refunded your "Money" in your wallet' });
            User.findByIdAndUpdate({ _id: mongodb.mongify(player.iUserId) }, { $inc: { nTotalCoins: tournament.nEntryFee } }, { new: true, projection: { nTotalCoins: 1 } })
                .then((usr) => {
                    _.privateEmit(player.iUserId, 'resUpdateCoins', { nTotalCoins: parseInt(usr.nTotalCoins, 10) });
                })
                .catch(_.errorCallback);
            // const usr = await User.findByIdAndUpdate({ _id: mongodb.mongify(player.iUserId) }, { $inc: { nTotalCoins: tournament.nEntryFee } }, { new: true, projection: { nTotalCoins: 1 } });
            // _.privateEmit(player.iUserId, 'resUpdateCoins', { nTotalCoins: parseInt(usr.nTotalCoins, 10) });
        }

        const _qualifiedUser = connectedUser.filter((user) => user.eStatus === 'waiting');
        const qualifiedUserIds = _qualifiedUser.map((user) => mongodb.mongify(user.iUserId));

        log.green('qualifiedUserIds', qualifiedUserIds);

        tournament.nCurrentRound = 1;
        const tournamentRound = tournament.oLog.aRound.find((round) => round.nRound === 1);
        if (!tournamentRound) log.red('tournamentRound not found', tournament.oLog.aRound);

        const qualifiedUser = await User.find({ _id: { $in: qualifiedUserIds } }).lean();
        await tournament.save(); //

        log.green('qualifiedUser length[db]', qualifiedUser.length);

        const prototype = {
            _id: null, // 'tournament',
            sName: 'Custom Tournament Table',
            nTableFee: 0,
            nTotalCoins: 0,
            eGameType: tournament.eGameType,
            nMaxPlayer: tournament.eGameType === 'sewali' ? 3 : 4,
            eStatus: 'y',
            dCreatedDate: new Date(),
            dUpdatedDate: new Date(),
        }; // protoData

        for (let i = 0; i < requiredTable; i += 1) {
            const table = await tableManager.createTable(prototype, true, tournament._id);
            table.oSetting.nTurnTime = tournament.nTurnTime * 1000; // s-> ms
            await table.save();
            for (let j = 0; j < playerPerTable; j += 1) {
                const user = qualifiedUser.shift();
                const oPrevGameData = { nMatchWon: user.nWon || 0, nMatchLost: user.nLost || 0, nTotalMatch: (user.nWon || 0) + (user.nLost || 0) };
                await tableManager.addPlayer({ iTableId: table._id?.toString(), protoData: prototype, userData: { ...user, ...oPrevGameData } }, () => {
                    // log.info('emitting to user', user._id?.toString(), 'resTournamentMatchMake', { iTableId: table._id?.toString() });
                    _.privateEmit(user._id?.toString(), 'resTournamentMatchMake', { iTableId: table._id?.toString(), iTournamentId });
                });
                const tUser = tUsers.find((u) => u.iUserId.toString() === user._id?.toString());
                if (tUser) {
                    tUser.eStatus = 'playing'; // 'registered', 'waiting', 'playing', 'disconnected', 'removed', 'left'
                    tUser.nTournamentRoundPlayed += 1;
                } else log.red('matchMake() tUser not found with iUserId', user._id?.toString());
            }
            log.magenta('table created', table._id?.toString());
            log.magenta('aTable[before-push]', tournamentRound?.aTable);
            tournamentRound?.aTable?.push(table._id);
            log.magenta('aTable[after-push]', tournamentRound?.aTable);
        }
        tournament.eStatus = 'running';
        await Promise.all([
            tournament.save(),
            tUsers.map((tUser) => tUser.save()), //
        ]);
        log.magenta('tournament[after-mm]', JSON.stringify(tournament, null, 2));
        this.emitUserToRefreshTournament();

        return callback(null);
    } catch (error) {
        console.log('[matchMake]', error?.message, error);
        callback(error);
        return null;
    } finally {
        if (redLock && redLock.expiration > Date.now()) {
            await redLock.release();
            // log.green(`${_.now()}::TableManager.prototype.matchMake():: redLock released a lock on key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}`);
        } else log.red(`${_.now()}::TableManager.prototype.matchMake():: redLock unable to release lock from key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}. auto released`);
    }
};

TournamentManager.prototype.endRound = async function (params = {}, callback = () => { }) {
    let redLock;
    try {
        log.green('endRound functions called', params);
        // - log.cyan(`${_.now()}::TableManager.prototype.endRound():: redLock acquiring a lock on key ${_.genLockKey(params.iTableId, 'END_RND')}`);
        redLock = await globalThis.Lock.acquire([_.genLockKey(params.iTableId, 'END_RND')], _.REDLOCK_TTL_MS); // ms
        // - log.cyan(`${_.now()}::TableManager.prototype.endRound():: redLock acquired a lock on key ${_.genLockKey(params.iTableId, 'END_RND')}`);
        const { iTournamentId, iTableId } = params; // objIds
        const tournament = await Tournament.findOne({ _id: iTournamentId });
        if (!tournament) return _.abort(`[endRound] tournament not found with iTournamentId ${iTournamentId}, iTableId: ${iTableId}`, callback);
        const tRound = tournament.oLog.aRound.find((round) => round.nRound === tournament.nCurrentRound);
        if (!tRound) {
            log.red('tRound not found with nCurrentRound as ', tournament.nCurrentRound, 'in ', tournament.oLog.aRound);
            return;
        }
        const isFinalRound = tRound.aTable.length === 1;

        log.blue('[endRound] isFinalRound', isFinalRound);
        const aTableIdsInCurrentTRound = tRound.aTable.map((t) => t.toString());

        log.blue('[endRound] aTableIdsInCurrentTRound', aTableIdsInCurrentTRound);

        if (!aTableIdsInCurrentTRound.includes(iTableId.toString())) {
            log.red(`endRound failed for iTournamentId ${iTournamentId} iTableId ${iTableId} not found in tRound.aTable ${aTableIdsInCurrentTRound}`);
            return;
        }
        const [aTableHistory, tableHistory] = await Promise.all([
            TableHistory.find({ _id: { $in: aTableIdsInCurrentTRound } }, { _id: 1, nTableRound: 1, nTotalRound: 1, eState: 1, eGameType: 1 }).lean(),
            TableHistory.findOne({ _id: iTableId }, { _id: 1, nTableRound: 1, nTotalRound: 1, eState: 1, eGameType: 1, aPlayer: 1, 'oSetting.nTurnTime': 1 }).lean(), //
        ]);
        if (!aTableHistory) return log.red('aTableHistory not found with iTableIds in', aTableIdsInCurrentTRound);
        if (!tableHistory) return log.red('tableHistory not found with iTableId', iTableId);

        // increasing order // i.e player in last index is winner
        const aUserScore = tableHistory.aPlayer
            ?.map((p) => ({ iUserId: p?.iUserId, nRoundWon: p?.nRoundWon, nTotalScore: p?.nTotalScore }))
            ?.sort((a, b) => {
                if (a.nRoundWon === b.nRoundWon) {
                    return a.nTotalScore - b.nTotalScore;
                }
                return a.nRoundWon - b.nRoundWon;
            });

        if (!aUserScore?.length) return log.red('[endRound] aUserScore not found with iTableId', iTableId, 'iTournamentId', iTournamentId);
        const qualifiedUserWithScore = aUserScore?.filter((w, idx) => idx >= tournament.nNonEliminatorRound); // TODO: nNonEliminatorRound -> nEliminatedPerRound
        const eliminatedUserWithScore = aUserScore?.filter((w, idx) => idx < tournament.nNonEliminatorRound); // TODO: nNonEliminatorRound -> nEliminatedPerRound

        log.blue('[endRound] qualifiedUserWithScore', qualifiedUserWithScore); // [{iUserId, nRoundWon, nTotalScore}, {}]
        log.blue('[endRound] eliminatedUserWithScore', eliminatedUserWithScore); // [{iUserId, nRoundWon, nTotalScore}]

        const users = await TournamentUser.find({ iTournamentId: mongodb.mongify(iTournamentId) }).sort({ nTournamentRoundWon: -1, nRoundWon: -1, nScore: -1, dCreatedDate: 1 });
        if (!users?.length) return log.red('[endRound] [TournamentUser] users not found with iTournamentId', iTournamentId);

        const promises = [];

        qualifiedUserWithScore.forEach((user) => {
            const tUser = users.find((u) => u.iUserId.toString() === user.iUserId.toString());
            if (!tUser) return log.red('[endRound] [qualifiedUserWithScore] tUser not found with iUserId', user.iUserId);
            tUser.nScore += user.nTotalScore;
            tUser.nRoundWon += user.nRoundWon;
            tUser.eStatus = ['waiting', 'playing'].includes(tUser.eStatus) ? 'waiting' : tUser.eStatus;
            if (user.iUserId.toString() === aUserScore[aUserScore.length - 1]?.iUserId?.toString()) tUser.nTournamentRoundWon += 1;
            promises.push(tUser.save());
        });
        eliminatedUserWithScore.forEach((user) => {
            const tUser = users.find((u) => u.iUserId.toString() === user.iUserId.toString());
            if (!tUser) return log.red('[endRound] [eliminatedUserWithScore] tUser not found with iUserId', user.iUserId);
            tUser.nScore += user.nTotalScore;
            tUser.nRoundWon += user.nRoundWon;
            if (!isFinalRound && !['disconnected', 'removed', 'left'].includes(tUser.eStatus)) _.privateEmit(user.iUserId?.toString(), 'resTournamentKickout', { sReason: 'kicked from tournament due to loosing game' });
            if (!isFinalRound) tUser.eStatus = 'removed';
            promises.push(tUser.save());
        });

        await Promise.all(promises);

        // Update playMatch and completeMatch daily challenges for all players who participated in this tournament match
        const allPlayersInMatch = [...qualifiedUserWithScore, ...eliminatedUserWithScore];
        for (const player of allPlayersInMatch) {
            if (player.iUserId) {
                this.updateDailyChallengeProgress(player.iUserId, ['playMatch', 'completeMatch'], 1).catch((e) => {
                    log.error(`Failed to update playMatch/completeMatch challenge for player ${player.iUserId} in tournament round:`, e?.message);
                });
            }
        }

        // Update winMatch, reachScore, earnCoins, and winBig daily challenges for the round winner (last player in aUserScore is the winner)
        const roundWinner = aUserScore[aUserScore.length - 1];
        if (roundWinner && roundWinner.iUserId) {
            // Find the round winner's balance from tableHistory
            const roundWinnerPlayer = tableHistory.aPlayer?.find((p) => p.iUserId?.toString() === roundWinner.iUserId?.toString());
            const roundWinnerBalance = roundWinnerPlayer?.nBalance || 0;

            // Update winMatch challenge
            this.updateDailyChallengeProgress(roundWinner.iUserId, ['winMatch'], 1).catch((e) => {
                log.error(`Failed to update winMatch challenge for round winner ${roundWinner.iUserId} in tournament:`, e?.message);
            });

            // Update reachScore challenge with the round winner's total score
            if (roundWinner.nTotalScore > 0) {
                this.updateDailyChallengeProgress(roundWinner.iUserId, ['reachScore'], roundWinner.nTotalScore).catch((e) => {
                    log.error(`Failed to update reachScore challenge for round winner ${roundWinner.iUserId} in tournament:`, e?.message);
                });
            }

            // Update earnCoins and winBig challenges with the round winner's balance (coins earned from winning the match)
            if (roundWinnerBalance > 0) {
                this.updateDailyChallengeProgress(roundWinner.iUserId, ['earnCoins', 'winBig'], roundWinnerBalance).catch((e) => {
                    log.error(`Failed to update earnCoins and winBig challenge for round winner ${roundWinner.iUserId} in tournament:`, e?.message);
                });
            }
        }

        let isAllCurrentRoundTableFinished = true;
        // Wait for all table to finish before rematching
        if (aTableHistory?.length < aTableIdsInCurrentTRound.length || aTableHistory?.some((t) => t._id?.toString() !== tableHistory?._id?.toString() && t.eState !== 'finished')) {
            isAllCurrentRoundTableFinished = false;
            log.cyan('[endRound] tRound currently in progress', aTableHistory?.length, '/', aTableIdsInCurrentTRound.length);
        }

        const eligibleUser = users.filter((u) => ['waiting'].includes(u.eStatus));

        //
        const playerPerTable = tournament.eGameType === 'sewali' ? 3 : 4;
        const requiredTable = parseInt(eligibleUser.length / playerPerTable);
        //
        log.blue('[endRound] eligibleUser', eligibleUser);
        log.blue('[endRound] playerPerTable', playerPerTable);
        log.blue('[endRound] requiredTable', requiredTable);
        //

        if ((isAllCurrentRoundTableFinished && requiredTable === 0) || isFinalRound) {
            log.blue('[endRound] tournament is about to finish', 'emitting finishTournament...');
            emitter.emit('finishTournament', { iTournamentId });
            if (redLock && redLock.expiration > Date.now()) {
                await redLock.release();
                // - log.green(`${_.now()}::TableManager.prototype.endRound():: redLock released a lock on key ${_.genLockKey(params.iTableId, 'END_RND')}`);
            } else log.red(`${_.now()}::TableManager.prototype.endRound():: redLock unable to release lock from key ${_.genLockKey(params.iTableId, 'END_RND')}. auto released`);
            return;
        }

        if (redLock && redLock.expiration > Date.now()) {
            await redLock.release();
            log.green(`${_.now()}::TableManager.prototype.endRound():: redLock released a lock on key ${_.genLockKey(params.iTableId, 'END_RND')}`);
        } else log.red(`${_.now()}::TableManager.prototype.endRound():: redLock unable to release lock from key ${_.genLockKey(params.iTableId, 'END_RND')}. auto released`);

        await _.delay(tableHistory?.oSetting?.nPopUpTimer || 15000); // wait for game result screen to hide before sending leaderboard
        emitter.emit('broadCastLeaderBoard', { iTournamentId });
        await _.delay(6000); // wait for leaderboard to show before re-match-make
        if (isAllCurrentRoundTableFinished) {
            emitter.emit('reMatchMake', { iTournamentId: iTournamentId?.toString() });
        }
    } catch (error) {
        console.log('[endRound]', error);
        callback(error);
        return null;
    }
};

TournamentManager.prototype.reMatchMake = async function (params = {}, callback = () => { }) {
    let redLock;
    try {
        log.green('reMatchMake functions called', params);
        const { iTournamentId } = params;

        // - log.cyan(`${_.now()}::TableManager.prototype.reMatchMake():: redLock acquiring a lock on key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}`);
        redLock = await globalThis.Lock.acquire([_.genLockKey(params.iTournamentId, 'JOIN_TRN')], _.REDLOCK_TTL_MS * 2); // ms
        // - log.cyan(`${_.now()}::TableManager.prototype.reMatchMake():: redLock acquired a lock on key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}`);

        const [tournament, tUsers] = await Promise.all([
            Tournament.findOne({ _id: mongodb.mongify(iTournamentId), eStatus: { $in: ['waiting', 'matchMaking', 'running'] } }, { _id: 1, sTitle: 1, eStatus: 1, aUsers: 1, eGameType: 1, nRequiredSeat: 1, nEntryFee: 1, oLog: 1, nCurrentRound: 1, nTurnTime: 1 }),
            TournamentUser.find({ iTournamentId: mongodb.mongify(iTournamentId) }).sort({ nTournamentRoundWon: -1, nRoundWon: -1, nTournamentRoundPlayed: -1, nScore: -1, dCreatedDate: 1 }), //
        ]);
        if (!tournament) return _.abort(`tournament not found with iTournamentId ${iTournamentId}`, callback);

        // tournament.eStatus = 'matchMaking';
        tournament.eStatus = 'running';
        await tournament.save();

        const eligibleUser = tUsers?.filter((u) => ['waiting'].includes(u.eStatus)); // decreasing order of score

        // remove excess player
        const playerPerTable = tournament.eGameType === 'sewali' ? 3 : 4;
        const requiredTable = parseInt(eligibleUser.length / playerPerTable);

        log.blue('[reMatchMake] eligibleUser', eligibleUser);
        log.blue('[reMatchMake] playerPerTable', playerPerTable);
        log.blue('[reMatchMake] requiredTable', requiredTable);

        const promises = [];

        // * declare winner
        if (requiredTable < 1) {
            log.red('reMatchMake failed requiredTable < 1', iTournamentId);
            log.blue('[reMatchMake] tournament is about to finish', 'emitting finishTournament...');
            emitter.emit('finishTournament', { iTournamentId });
            return;
        }
        for (let i = playerPerTable * requiredTable; i < eligibleUser.length; i += 1) {
            const player = eligibleUser[i];
            player.eStatus = 'removed';
            promises.push(player.save());
            _.privateEmit(player.iUserId?.toString(), 'resTournamentKickout', { sReason: 'less points scored' });
        }

        const qualifiedUserIds = eligibleUser?.filter((u) => ['waiting'].includes(u.eStatus))?.map((user) => user?.iUserId);
        log.blue('[reMatchMake] qualifiedUserWithScore', qualifiedUserIds);

        tournament.nCurrentRound += 1;
        tournament.oLog.aRound.push({ nRound: tournament.nCurrentRound, aTable: [] });
        const tournamentRound = tournament.oLog.aRound.find((round) => round.nRound === tournament.nCurrentRound);
        if (!tournamentRound) log.red('tournamentRound not found', tournament.oLog.aRound);

        const qualifiedUser = await User.find({ _id: { $in: qualifiedUserIds } }).lean();
        promises.push(tournament.save());

        await Promise.all(promises);
        promises.length = 0;

        const prototype = {
            _id: null, // 'tournament',
            sName: 'Custom Tournament Table',
            nTableFee: 0,
            nTotalCoins: 0,
            eGameType: tournament.eGameType,
            nMaxPlayer: tournament.eGameType === 'sewali' ? 3 : 4,
            eStatus: 'y',
            dCreatedDate: new Date(),
            dUpdatedDate: new Date(),
        }; // protoData

        for (let i = 0; i < requiredTable; i += 1) {
            const table = await tableManager.createTable(prototype, true, tournament._id);
            table.oSetting.nTurnTime = tournament.nTurnTime * 1000; // s-> ms
            await table.save();
            for (let j = 0; j < playerPerTable; j += 1) {
                const user = qualifiedUser.shift();
                await tableManager.addPlayer({ iTableId: table._id?.toString(), protoData: prototype, userData: user }, () => {
                    log.info('[reMatchMake] emitting to user', user._id?.toString(), 'resTournamentMatchMake', { iTableId: table._id?.toString() });
                    _.privateEmit(user._id?.toString(), 'resTournamentMatchMake', { iTableId: table._id?.toString() });
                });
                const tUser = tUsers.find((u) => u.iUserId.toString() === user._id?.toString());
                if (tUser) {
                    tUser.eStatus = 'playing'; // 'registered', 'waiting', 'playing', 'disconnected', 'removed', 'left'
                    tUser.nTournamentRoundPlayed += 1;
                }
                promises.push(tUser.save());
            }
            tournamentRound?.aTable?.push(table._id);
        }
        tournament.eStatus = 'running';
        promises.push(tournament.save());
        await Promise.all(promises);
        log.blue('[reMatchMake] finished');
    } catch (error) {
        console.log('error on [reMatchMake]', error?.message, error);
        callback(error);
        return null;
    } finally {
        if (redLock && redLock.expiration > Date.now()) {
            await redLock.release();
            // log.green(`${_.now()}::TableManager.prototype.reMatchMake():: redLock released a lock on key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}`);
        } else log.red(`${_.now()}::TableManager.prototype.reMatchMake():: redLock unable to release lock from key ${_.genLockKey(params.iTournamentId, 'JOIN_TRN')}. auto released`);
    }
};

TournamentManager.prototype.cancel = async function (params = {}, callback = () => { }) {
    try {
        log.green('cancel', params);
        let { iTournamentId, sReason } = params;
        if (!iTournamentId) return _.abort('iTournamentId not present in param', callback);

        const [tournament, tUsers] = await Promise.all([
            Tournament.findOne({ _id: mongodb.mongify(iTournamentId) }, { _id: 1, eStatus: 1, aUsers: 1, eGameType: 1, sTitle: 1, nRequiredSeat: 1, nEntryFee: 1 }),
            TournamentUser.find({ iTournamentId: mongodb.mongify(iTournamentId) }, { iUserId: 1, sUserName: 1, eStatus: 1, nScore: 1, nRoundWon: 1, nTournamentRoundWon: 1, nTournamentRoundPlayed: 1, dCreatedDate: 1 })
                .sort({ nTournamentRoundWon: -1, nRoundWon: -1, nTournamentRoundPlayed: -1, nScore: -1, dCreatedDate: 1 })
                .lean(),
        ]);
        if (!tournament) return _.abort(`tournament not found with iTournamentId ${iTournamentId}`, callback);

        const connectedUser = tUsers.filter((user) => user.eStatus === 'waiting');
        const connectedUserIds = connectedUser.map((user) => mongodb.mongify(user.iUserId));

        tournament.eStatus = 'canceled';

        sReason = sReason || 'tournament cancelled';

        log.cyan('connectedUserIds', connectedUserIds);
        log.cyan({ _id: { $in: connectedUserIds } }, { $inc: { nTotalCoins: tournament.nEntryFee } });

        if (!connectedUser || connectedUser.length < tournament.nRequiredSeat) {
            if (connectedUser?.length) {
                const users = await User.find({ _id: { $in: connectedUserIds } }, { nTotalCoins: 1 }); // { $inc: { nTotalCoins: tournament.nEntryFee } }
                if (users?.length) {
                    for (let i = 0; i < users.length; i += 1) {
                        const user = users[i];
                        user.nTotalCoins += tournament.nEntryFee;
                        await user.save();
                        _.privateEmit(user._id?.toString(), 'resUpdateCoins', { nTotalCoins: parseInt(user.nTotalCoins, 10) });
                    }
                }
            }
            sReason = `not enough player joined. RequiredSeat: ${tournament.nRequiredSeat} , connectedUser: ${connectedUser.length}, registeredUser: ${tournament?.aUsers?.length}`;
        }

        tournament.sRemark = sReason;

        await Promise.all([
            // redis.deleteAsync(_.getTournamentLeaderBoardKey(tournament._id.toString())), // not needed
            tournament.save(), //
        ]);

        tournament?.aUsers?.forEach((iUserId) => {
            _.privateEmit(iUserId, 'resTournamentCancelled', { iTournamentId, sTitle: tournament?.sTitle ?? '', sReason });
        });

        return callback(null);
    } catch (error) {
        log.red('error on [cancel]', error?.message, error);
        callback(error);
        return null;
    }
};

TournamentManager.prototype.leave = async function (params = {}, callback = () => { }) {
    let redLock;
    try {
        log.green('leave started', params);
        const { iTournamentId, iUserId } = params;
        if (!iTournamentId) return _.abort('iTournamentId not present in param', callback);
        if (!iUserId) return _.abort('iUserId not present in param', callback);

        // log.green(`${_.now()}::TournamentManager.prototype.leave():: redLock acquiring a lock on key ${_.genLockKey(params.iUserId, 'LV_TRN')}`);
        redLock = await globalThis.Lock.acquire([_.genLockKey(params.iUserId, 'LV_TRN')], _.REDLOCK_TTL_MS); // ms
        // log.green(`${_.now()}::TournamentManager.prototype.leave():: redLock acquired a lock on key ${_.genLockKey(params.iUserId, 'LV_TRN')}`);

        const [tournament, tUsers] = await Promise.all([
            Tournament.findOne({ _id: mongodb.mongify(iTournamentId) }, { _id: 1, eStatus: 1, aUsers: 1, eGameType: 1, sTitle: 1, nRequiredSeat: 1, nEntryFee: 1 }),
            TournamentUser.find({ iTournamentId: mongodb.mongify(iTournamentId) }, { iUserId: 1, sUserName: 1, eStatus: 1, nScore: 1, nRoundWon: 1, nTournamentRoundWon: 1, nTournamentRoundPlayed: 1, dCreatedDate: 1 }).sort({ nTournamentRoundWon: -1, nRoundWon: -1, nTournamentRoundPlayed: -1, nScore: -1, dCreatedDate: 1 }),
        ]);
        if (!tournament) return _.abort(`tournament not found with iTournamentId ${iTournamentId}`, callback);
        const tUser = tUsers.find((u) => u.iUserId.toString() === iUserId.toString());
        if (tUser) tUser.eStatus = 'removed';
        if (!tUser) {
            log.red('tUser not found with iUserId', iUserId);
            return callback(null);
        }

        if (tUsers?.every((u) => ['disconnected', 'removed'].includes(u?.eStatus))) {
            //  TODO if all user left the tournament declare winner and distribute reward
            log.requiredTable('[leave] all user left the tournament');
        }

        await Promise.all([
            tournament.save(),
            tUser.save(), //
            User.updateOne({ _id: mongodb.mongify(iUserId.toString()) }, { $set: { iLastTournamentId: null } }),
        ]);

        emitter.emit('broadCastLeaderBoard', { iTournamentId });
        log.green('leave finished', params);
        return callback(null);
    } catch (error) {
        log.red('error on [leave]', error?.message, error);
        callback(error);
        return null;
    } finally {
        if (redLock && redLock.expiration > Date.now()) {
            await redLock.release();
            // log.green(`${_.now()}::TournamentManager.prototype.leave():: redLock released a lock on key ${_.genLockKey(params.iUserId, 'LV_TRN')}`);
        } else log.red(`${_.now()}::TournamentManager.prototype.leave():: redLock unable to release lock from key ${_.genLockKey(params.iUserId, 'LV_TRN')}. auto released`);
    }
};

TournamentManager.prototype.resultScreenClosed = async function (params = {}, callback = () => { }) {
    try {
        log.green('resultScreenClosed', params);
        const { iTournamentId, iUserId } = params;
        if (!iTournamentId) return _.abort('iTournamentId not present in param', callback);
        if (!iUserId) return _.abort('iUserId not present in param', callback);

        const [tournament, tUser] = await Promise.all([
            Tournament.findOne({ _id: mongodb.mongify(iTournamentId) }, { _id: 1, eStatus: 1 }).lean(),
            TournamentUser.findOne({ iTournamentId: mongodb.mongify(iTournamentId), iUserId: mongodb.mongify(iUserId) }, { eStatus: 1, iUserId: 1 }).lean(), //
        ]);
        if (!tournament) return _.abort(`tournament not found with iTournamentId ${iTournamentId}`, callback);
        if (!tUser) return _.abort(`tUser not found with iTournamentId ${iTournamentId} iUserId ${iUserId}`, callback);

        log.blue('[resultScreenClosed] tUser', _.stringify(tUser), 'tournament', _.stringify(tournament));

        if (['disconnected', 'removed', 'left'].includes(tUser.eStatus)) {
            log.red(`[resultScreenClosed] user ${iUserId} already left the tournament`);
            return callback(null); // user already left the tournament "eStatus": "removed"
        }

        if (['waiting', 'matchMaking', 'running'].includes(tournament.eStatus)) emitter.emit('broadCastLeaderBoard', { iTournamentId, iUserId }, callback);
        else if (['completed'].includes(tournament.eStatus)) emitter.emit('broadCastResult', { iTournamentId, iUserId }, callback);
    } catch (error) {
        log.red('error on [resultScreenClosed]', error?.message, error);
        callback(error);
        return null;
    }
};

/**
 * @typedef {Object} tWinner
 * @property {number} nRank
 * @property {mongoose.Schema.Types.ObjectId} iUserId
 * @property {string} sUserName
 * @property {number} nScore
 * @property {number} nRoundWon
 * @property {number} nTournamentRoundWon
 * @property {number} nTournamentRoundPlayed
 * @property {number} nAmountWon
 */
TournamentManager.prototype.finish = async function (params = {}, callback = () => { }) {
    try {
        log.green('finish called', params);
        const { iTournamentId } = params;
        if (!iTournamentId) return _.abort('iTournamentId not present in param', callback);
        const [tournament, tUsers] = await Promise.all([
            Tournament.findOne({ _id: mongodb.mongify(iTournamentId) }),
            TournamentUser.find({ iTournamentId: mongodb.mongify(iTournamentId) }).sort({ nTournamentRoundWon: -1, nRoundWon: -1, nTournamentRoundPlayed: -1, nScore: -1, dCreatedDate: 1 }), // decreasing order
        ]);
        if (!tournament?.eGameType) return _.abort(`tournament not found with iTournamentId ${iTournamentId}`, callback);
        if (!tUsers?.length) return _.abort(`tUsers not found with iTournamentId ${iTournamentId}`, callback);

        const connectedUser = tUsers.filter((user) => ['waiting', 'playing'].includes(user.eStatus));
        const leftUsers = tUsers.filter((user) => ['disconnected', 'removed', 'left'].includes(user.eStatus));
        const connectedAndLeftUser = [...connectedUser, ...leftUsers];

        /** @type {tWinner[]} aWinner */
        const aWinner = [];
        const nTotalCoinsCollected = tournament.nEntryFee * tournament.aUsers.length;
        const prizes = [Number((nTotalCoinsCollected * 0.5).toFixed(2)), Number((nTotalCoinsCollected * 0.3).toFixed(2)), Number((nTotalCoinsCollected * 0.2).toFixed(2))];

        let remainingPrize = prizes.reduce((a, b) => a + b, 0);
        for (let idx = 0, prizeIdx = 0; idx < connectedAndLeftUser.length; idx += 1) {
            const user = connectedAndLeftUser[idx];
            if (aWinner.length < 3 && user.eStatus !== 'removed') {
                const obj = {
                    nRank: prizeIdx + 1,
                    iUserId: user.iUserId,
                    sUserName: user.sUserName,
                    nScore: user.nScore,
                    nRoundWon: user.nRoundWon,
                    nTournamentRoundWon: user.nTournamentRoundWon,
                    nTournamentRoundPlayed: user.nTournamentRoundPlayed,
                    nAmountWon: Math.round(prizes[prizeIdx]),
                };
                aWinner.push(obj);
                remainingPrize -= Math.round(prizes[prizeIdx]);
                prizeIdx += 1;
            }
        }
        log.blue(
            'BEFORE Prize',
            prizes,
            'aWonAMount',
            aWinner.map((p) => p.nAmountWon),
            'remainingPrize',
            remainingPrize
        );
        if (aWinner.length === 1) aWinner[0].nAmountWon = Math.round(nTotalCoinsCollected);
        else if (aWinner.length === 2) {
            aWinner[0].nAmountWon += Math.round(remainingPrize * 0.6);
            aWinner[1].nAmountWon += Math.round(remainingPrize * 0.4);
        }
        log.blue(
            'AFTER COMPENSATION',
            'aWonAMount',
            aWinner.map((p) => p.nAmountWon),
            'remainingPrize',
            remainingPrize
        );

        tournament.aWinner = aWinner;
        tournament.eStatus = 'completed';
        log.blue('tournament.aWinner', JSON.stringify(aWinner));
        await tournament.save();
        if (!aWinner.length) return log.error('aWinner.length is 0', _.stringify(aWinner));
        await this.distributeReward({ tournament, aWinner });

        // Update completeMatch daily challenge for all players who completed the tournament
        // This includes both winners and players who participated but didn't win
        const allTournamentPlayers = connectedAndLeftUser.filter((u) => !['disconnected', 'removed', 'left'].includes(u.eStatus) || u.nTournamentRoundPlayed > 0);
        for (const tUser of allTournamentPlayers) {
            if (tUser.iUserId) {
                // Only update completeMatch here since playMatch was already updated in endRound
                this.updateDailyChallengeProgress(tUser.iUserId, ['completeMatch'], 1).catch((e) => {
                    log.error(`Failed to update completeMatch challenge for player ${tUser.iUserId} in tournament finish:`, e?.message);
                });
            }
        }

        // Update winMatch daily challenge for tournament winners (top 3 winners)
        for (const winner of aWinner) {
            if (winner.iUserId) {
                this.updateDailyChallengeProgress(winner.iUserId, ['winMatch'], 1).catch((e) => {
                    log.error(`Failed to update winMatch challenge for tournament winner ${winner.iUserId}:`, e?.message);
                });
            }
        }

        // const aUserIds = tUsers?.map((u) => u.iUserId);
        // this is creating issue when user called reqResultScreenClosed
        // if (aUserIds?.length) await User.updateMany({ _id: { $in: aUserIds } }, { $set: { iLastTournamentId: null } }); // reset last tournament id
        callback(null);
        return;
    } catch (error) {
        log.red('error on [finish]', error?.message, error);
        callback(error);
        return null;
    }
};

/**
 * @param {{tournament: any, aWinner: tWinner[]}} params
 * @param {function} callback
 */
TournamentManager.prototype.distributeReward = async function (params = {}, callback = () => { }) {
    try {
        log.green('distributeReward called');
        const { tournament, aWinner } = params;
        if (!tournament) return _.abort('tournament not present in param', callback);
        if (!aWinner) return _.abort('aWinner not present in param', callback);

        if (!['completed'].includes(tournament.eStatus)) return _.abort(`tournament not finished with iTournamentId ${tournament?._id}`, callback);
        const promises = aWinner?.filter((x) => x)?.map((winner) => User.findByIdAndUpdate({ _id: mongodb.mongify(winner?.iUserId) }, { $inc: { nTotalCoins: winner.nAmountWon } }, { new: true, projection: { _id: 1, sUserName: 1, nTotalCoins: 1 } }));
        const ranks = await Promise.all(promises);

        // Update earnCoins, reachScore, and winBig daily challenges for tournament winners
        for (let idx = 0; idx < aWinner.length; idx += 1) {
            const winner = aWinner[idx];
            if (winner && winner.iUserId && winner.nAmountWon > 0) {
                // Update earnCoins challenge with prize amount
                this.updateDailyChallengeProgress(winner.iUserId, ['earnCoins'], winner.nAmountWon).catch((e) => {
                    log.error(`Failed to update earnCoins challenge for tournament winner ${winner.iUserId}:`, e?.message);
                });

                // Update reachScore challenge with tournament score (calculated score)
                const calculatedScore = parseInt(aWinner[idx]?.nTournamentRoundWon * 1000 || 0) + parseInt(aWinner[idx]?.nRoundWon * 100 || 0) + parseInt(aWinner[idx]?.nScore || 0);
                if (calculatedScore > 0) {
                    this.updateDailyChallengeProgress(winner.iUserId, ['reachScore'], calculatedScore).catch((e) => {
                        log.error(`Failed to update reachScore challenge for tournament winner ${winner.iUserId}:`, e?.message);
                    });
                }

                // Update winBig challenge with prize amount (win a match with reward >= target coins)
                this.updateDailyChallengeProgress(winner.iUserId, ['winBig'], winner.nAmountWon).catch((e) => {
                    log.error(`Failed to update winBig challenge for tournament winner ${winner.iUserId}:`, e?.message);
                });
            }
        }
        const response = ranks.map((rank, idx) => {
            const winner = {};
            winner.nRank = aWinner[idx].nRank;
            winner.nRoundWon = aWinner[idx].nTournamentRoundWon;
            winner.nRoundPlayed = aWinner[idx].nTournamentRoundPlayed;
            winner.nScore = parseInt(aWinner[idx]?.nTournamentRoundWon * 1000 || 0) + parseInt(aWinner[idx]?.nRoundWon * 100 || 0) + parseInt(aWinner[idx]?.nScore || 0);
            winner.nAmountWon = aWinner[idx].nAmountWon;
            winner.iUserId = rank._id;
            winner.sUserName = rank.sUserName;
            winner.nTotalCoins = Math.round(rank.nTotalCoins);
            // emitter.emit('broadCastResult', { iTournamentId: tournament._id, iUserId: rank._id }); // TODO verify if this is needed
            return winner;
        });
        //
        log.green('!!!!!!!!!!!!!!!!!!!!!!!!!resTournamentResult!!!!!!!!!!!!!!!!!!!!!!!!!\n');
        log.green('response', JSON.stringify(response, null, 2));
    } catch (error) {
        log.red('error on [distributeReward]', error?.message, error?.stack, error);
        callback(error, null);
        return null;
    }
};

module.exports = new TournamentManager();
