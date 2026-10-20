/* eslint-disable class-methods-use-this */
/* eslint-disable no-loop-func */
const axios = require('axios');
const { redis } = require('../../utils');
const Players = require('../Players');
const { SewaliTable, SewaliPrivateTable, User, Friends, Settings } = require('../../models');
const { mongodb } = require('../../utils');

class Service {
    constructor(oTableData) {
        /** @type {string} */
        this._id = oTableData._id;
        /** @type {string} */
        this.iTableId = oTableData.iTableId;
        /** @type {number} */
        this.nTableFee = oTableData.nTableFee;
        /** @type {'initializing'|'initialized'|'quadwinner'|'waiting'|'declaring'|'declared'|'finished'} */
        this.eState = oTableData.eState;
        /** @type {'sewali' | 'charwali'} */
        this.eGameType = oTableData.eGameType;
        /** @type {3|4} sewali-3 charwali 4 */
        this.nMaxPlayer = oTableData.nMaxPlayer;
        /** @type {import('../../utils/lib/deck').Card[]} */
        this.aDeck = oTableData.aDeck;
        /** @type {string} */
        this.iUserTurn = oTableData.iUserTurn;
        /** @type {string} */
        this.iDealerId = oTableData.iDealerId;
        /** @type {string} */
        this.iWinnerId = oTableData.iWinnerId;
        /** @type {number} */
        this.nSortHandTime = oTableData.nSortHandTime;
        /** @type {boolean} */
        this.bIsRoundWinner = oTableData.bIsRoundWinner;
        /** @type {number} */
        this.nTotalRound = oTableData.nTotalRound; // sewali: 5[0-4], charwali: 4[0-3]
        /** @type {number} */
        this.nTablePot = oTableData.nTablePot;
        /** @type {number} */
        this.nTableRound = oTableData.nTableRound || 0;
        /** @type {Players[]} */
        this.aPlayers = oTableData.aPlayers ? oTableData.aPlayers.map((p) => new Players(this, p)) : [];
        /** @type {import('../../models/lib/Settings').SettingsObject} */
        this.oSetting = oTableData.oSetting || {};
        /** @type {boolean} */
        this.bIsReshuffled = oTableData.bIsReshuffled || false;
        /** @type {boolean} */
        this.bIsCardGrabbed = oTableData.bIsCardGrabbed || false;
        /** @type {Record<string, *>} */
        this.oFinalWinner = oTableData.oFinalWinner || [];
        /** @type {*[]} */
        this.aRoundWinner = oTableData.aRoundWinner || [];
        /** @type {boolean} */
        this.bIsTournament = oTableData.bIsTournament || false;
        /** @type {string} */
        this.iTournamentId = oTableData.iTournamentId;

        /** @type {string | undefined} */
        this.sCode = oTableData.sCode || undefined;

        /** @type {boolean | null} cached vip table flag */
        this._bIsVipTable = typeof oTableData?.bIsVip === 'boolean' ? oTableData.bIsVip : null;
    }

    async isVipTable() {
        if (typeof this._bIsVipTable === 'boolean') return this._bIsVipTable;
        try {
            const { Table } = require('../../models');
            const tableProto = await Table.findOne({ _id: this.iTableId }, { bIsVip: 1 }).lean();
            this._bIsVipTable = !!tableProto?.bIsVip;
        } catch (e) {
            this._bIsVipTable = false;
        }
        return this._bIsVipTable;
    }

    update(oTableData) {
        this._id = oTableData._id;
        this.iTableId = oTableData.iTableId;
        this.nTableFee = oTableData.nTableFee;
        this.eState = oTableData.eState;
        this.eGameType = oTableData.eGameType;
        this.nMaxPlayer = oTableData.nMaxPlayer;

        this.aDeck = oTableData.aDeck;
        this.iUserTurn = oTableData.iUserTurn;
        this.iDealerId = oTableData.iDealerId;
        this.nSortHandTime = oTableData.nSortHandTime;
        this.bIsRoundWinner = oTableData.bIsRoundWinner;
        this.nTotalRound = oTableData.nTotalRound;
        this.nTableRound = oTableData.nTableRound || 0;
        this.aPlayers = oTableData.aPlayers ? oTableData.aPlayers.map((p) => new Players(this, p)) : [];
        this.oSetting = oTableData.oSetting || {};
        this.oFinalWinner = oTableData.oFinalWinner;
        this.aRoundWinner = oTableData.aRoundWinner || [];
        if (typeof oTableData?.bIsVip === 'boolean') this._bIsVipTable = oTableData.bIsVip;
        return this;
    }

    getPlayer(iUserId) {
        return this.aPlayers.find((p) => _.isEqual(p.iUserId, iUserId));
    }

    /**
     * Enrich player data with friend information
     * @param {Array} aPlayers - Array of player objects
     * @param {string} iCurrentUserId - Current user's ID
     * @returns {Promise<Array>} Array of players with friend information
     */
    async enrichPlayersWithFriendInfo(aPlayers, iCurrentUserId) {
        if (!aPlayers || aPlayers.length === 0) return aPlayers;
        if (!iCurrentUserId) return aPlayers;

        try {
            // Get all player IDs
            const playerIds = aPlayers.map((p) => mongodb.mongify(p.iUserId || p._id)).filter(Boolean);
            if (playerIds.length === 0) return aPlayers;

            // Get all friendships for current user
            const friendships = await Friends.find({
                $or: [
                    { iUserId: mongodb.mongify(iCurrentUserId), iFriendId: { $in: playerIds } },
                    { iFriendId: mongodb.mongify(iCurrentUserId), iUserId: { $in: playerIds } },
                ],
            }).lean();

            // Create a Set of friend IDs for quick lookup
            const friendIds = new Set();
            friendships.forEach((friendship) => {
                const friendId = friendship.iUserId.toString() === iCurrentUserId.toString() ? friendship.iFriendId.toString() : friendship.iUserId.toString();
                friendIds.add(friendId);
            });

            // Enrich each player with friend information
            return aPlayers.map((player) => {
                const playerId = (player.iUserId || player._id || '').toString();
                const bIsFriend = friendIds.has(playerId);

                return {
                    ...player,
                    bIsFriend,
                };
            });
        } catch (error) {
            log.error('Error enriching players with friend info:', error);
            // Return original players if enrichment fails
            return aPlayers.map((player) => ({
                ...player,
                bIsFriend: false,
            }));
        }
    }

    emit(sEventName, oData) {
        this.aPlayers.map((p) => p.emit(sEventName, oData));
    }

    async save(val = this.toJSON()) {
        const tableObj = {};
        const stringKey = ['_id', 'iTableId', 'nTableFee', 'eGameType', 'eState', 'iUserTurn', 'iCardId', 'nScore', 'iWinnerId', 'iDealerId', 'bIsRoundWinner', 'bIsReqNextGame', 'bIsDroppedPlayer', 'sCode', 'bIsAudio', 'bIsTournament', 'iTournamentId', 'sAgoraId'];
        const jsonKey = ['aDeck', 'oSetting', 'aWinnerData', 'aRoundWinner', 'oFinalWinner'];
        // const floatKey = ['nTotalCoins', 'nTableRound', 'nTotalRound', 'nBalance', 'nTablePot'];
        const floatKey = [
            'nTableFee',
            'nTotalCoins',
            'nTurnTime',
            'nSeat',
            'nTurnTime',
            'nTableRound',
            'nMaxPlayer',
            'nTotalRound',
            'nBalance',
            'nTablePot',
            'nMatchWon',
            'nMatchLost',
            'nTotalMatch',
            // FairPlay / analytics: track match duration in ms (stored in redis table hash)
            'nGameStartedAt',
        ];

        for (const [key, value] of Object.entries(val)) {
            // if (stringKey.includes(key) && value) tableObj[key] = value.toString();
            // else if (floatKey.includes(key) && value) tableObj[key] = parseFloat(value);
            // else if (jsonKey.includes(key) && value) tableObj[key] = JSON.stringify(value);
            if (stringKey.includes(key) && !_.isNullOrUndefined(value)) tableObj[key] = value.toString();
            else if (floatKey.includes(key) && !_.isNullOrUndefined(value)) tableObj[key] = parseFloat(value);
            else if (jsonKey.includes(key) && !_.isNullOrUndefined(value)) tableObj[key] = JSON.stringify(value);
            else if (key === 'aPlayers' && !_.isNullOrUndefined(value)) value.map((p) => (tableObj[`aPlayers:${p.iUserId}`] = JSON.stringify(p)));
            else if (!_.isNullOrUndefined(value)) tableObj[key] = value;
        }
        // log.green('tableObj', tableObj);
        // if (['dev', 'stag'].includes(process.env.NODE_ENV)) log.blue('table.save called', tableObj);
        try {
            const OK = await redis.hmsetAsync(_.getTableKey(this._id), tableObj);
            return OK;
        } catch (error) {
            return log.error('table.save failed', '\n', _.getTableKey(this._id), '\ntableObj\n', tableObj, '\nval\n', val, '\nError\n', error, '\n');
        }
    }

    getEmptySeat() {
        const aBookedSeat = this.aPlayers.map((p) => p.nSeat);
        const aEmptySeat = [];
        for (let i = 0; i < this.nMaxPlayer; i += 1) if (!aBookedSeat.includes(i)) aEmptySeat.push(i);

        if (process.env.forceQuaq) return aEmptySeat[0]; // TODO: can be removed. for quad testing only
        /** @type {number} */
        const randomSeatIndex = _.randomBetween(0, aEmptySeat.length - 1);
        return aEmptySeat[randomSeatIndex];
    }

    async setStatistics(iUserId) {
        const updateWonQuery = { $inc: { nWon: 1 } };
        const updateLossQuery = { $inc: { nLost: 1 } };
        this.aPlayers.map((p) => {
            const query = { _id: p.iUserId };
            if (p.iUserId === iUserId) User.findOneAndUpdate(query, updateWonQuery, _.errorCallback);
            else User.findOneAndUpdate(query, updateLossQuery, _.errorCallback);
            return null;
        });
    }

    async lossSetStatistics(iUserId) {
        const updateLossQuery = { $inc: { nLost: 1 } };
        const player = this.aPlayers.find((p) => p.iUserId === iUserId);
        if (player) {
            const query = { _id: player.iUserId };
            User.findOneAndUpdate(query, updateLossQuery, _.errorCallback);
        }
    }

    async wonSetStatistics(iUserId) {
        const updateWonQuery = { $inc: { nWon: 1 } };
        const player = this.aPlayers.find((p) => p.iUserId === iUserId);
        if (player) {
            const query = { _id: player.iUserId };
            User.findOneAndUpdate(query, updateWonQuery, _.errorCallback);
        }
    }

    async setSchedular(sTask, iUserId = '', ttl = 0, oData = '') {
        const key = _.getSchedulerKey(sTask, this._id, iUserId);
        await redis.setAsync(key, _.stringify(oData));
        return redis.pexpireAsync(key, parseInt(ttl));
    }

    async deleteScheduler(sTask, iUserId = '*') {
        const aSchedularKey = await redis.keysAsync(_.getSchedulerKey(sTask, this._id, iUserId, '*'));
        if (!aSchedularKey.length) return false;
        return redis.deleteAsync(aSchedularKey);
    }

    skipTurn(nSeat) {
        const activePlayer = this.aPlayers.filter((p) => !p.bIsDroppedPlayer).length;
        if (activePlayer === 1) return;
        const nextPlayer = this.getNextPlayer(nSeat);
        log.red('nSeat', nextPlayer.nSeat, ':', nextPlayer.nTurnCount);
        if (nextPlayer.nTurnCount === 1) this.declareResult();
        else nextPlayer.takeTurn();
    }

    async deleteGame(iUserId, noEmit = false) {
        if (iUserId) await redis.hdelAsync(_.getTableKey(this._id), _.getUserKey(iUserId)); // - verify this.table.iTableId -> this.table._id
        if (!noEmit) this.emit('resKickout', { userId: iUserId });
        if (this.aPlayers.every((p) => p.bIsDroppedPlayer)) {
            if (this.sCode) {
                SewaliPrivateTable.findOneAndDelete({ _id: this._id }, (err) => {
                    if (err) log.console(err);
                    else log.green('Private Table removed successfully');
                });
            } else {
                SewaliTable.findOneAndDelete({ _id: this._id }, (err) => {
                    if (err) log.console(err);
                    else log.green('Table removed successfully');
                });
            }
            await redis.deleteAsync(_.getTableKey(this._id));
            await redis.deleteAsync(_.getTablePlayerCountKey(this._id));
        }
    }

    getNextPlayer(nPreviousSeat) {
        const nNextPlayer = nPreviousSeat ? this.aPlayers.find((p) => p.nSeat === nPreviousSeat - 1) : this.aPlayers.find((p) => p.nSeat === this.aPlayers.length - 1);
        return nNextPlayer;
    }

    async setHandTimer() {
        log.green('setHandTimer called! ', 'Table.eState: ', this.eState);
        if (this.eState !== 'initializing') return false;

        const { nInitialTimer } = this.oSetting;
        this.eState = 'initialized';
        this.setSchedular('turnTimer-assignSetHandTime', null, nInitialTimer, { nInitialTimer, expiredAt: Date.now() + nInitialTimer });
        this.emit('resSetHandTimer', { ttl: nInitialTimer, initialValue: 0, nTotalTurnTime: nInitialTimer });
        this.save({ eState: this.eState, aPlayers: this.aPlayers.map((p) => p.toJSON()) });
    }

    async quadChecking(iUserId) {
        log.green(`quadChecking(${iUserId})called! `, 'Table.eState: ', this.eState);
        // if (!iUserId || this.eState !== 'initializing') return false;
        if (!iUserId) return false;

        let flag = false;
        const player = this.aPlayers.find((p) => _.isEqual(p.iUserId, iUserId));
        if (player) {
            const response = player.checkQuads();
            if (response.isValid) {
                flag = true;
                this.eState = 'quadwinner';
                this.iWinnerId = player.iUserId;
                this.oFinalWinner = player;
                this.setStatistics(this.iWinnerId);
                // apply VIP percent for quad win payout
                const settingsForQuad = await Settings.findOne({}).lean();
                const vipWinPercentForQuad = settingsForQuad?.nVipWinPercent || 0;
                const baseQuadAmount = this.nTableFee * this.nMaxPlayer * this.nTotalRound;
                let incAmount = baseQuadAmount;
                const isVipTable = await this.isVipTable();
                if (isVipTable && player.eUserType === 'vip' && vipWinPercentForQuad > 0) {
                    const extra = Math.round((baseQuadAmount * vipWinPercentForQuad) / 100);
                    incAmount += extra;
                    log.info('VIP quad win bonus applied', {
                        tableId: this.iTableId,
                        iUserId: player.iUserId?.toString?.() || player.iUserId,
                        nVipWinPercent: vipWinPercentForQuad,
                        baseWinAmount: baseQuadAmount,
                        vipExtraAmount: extra,
                        finalWinAmount: incAmount,
                    });
                }
                const _player = await User.findOneAndUpdate({ _id: player.iUserId }, { $inc: { nTotalCoins: incAmount } }, { new: true });
                player.nTotalCoins = Math.round(_player.nTotalCoins);
                await this.save({ eState: this.eState, iWinnerId: this.iWinnerId, oFinalWinner: this.oFinalWinner, aPlayers: this.aPlayers.map((p) => p.toJSON()) });
                _.privateEmit(player.iUserId, 'resUpdateCoins', { nTotalCoins: player.nTotalCoins });
            }
            if (flag) {
                const { nPopUpTimer } = this.oSetting;
                await player.table.generateTableHistory();
                return this.emit('resWinnerWithQuads', { iWinnerId: this.iWinnerId, aHand: this.oFinalWinner.aHand, nBalance: this.nTableFee * this.nMaxPlayer * this.nTotalRound, eState: this.eState, ttl: nPopUpTimer, nPopUpTimer: 0, nTotalTurnTime: nPopUpTimer });
            }
        } else log.red(`quadChecking(${iUserId}) failed! player not found`);
    }

    async startTurn() {
        log.green('startTurn called! ', 'Table.eState: ', this.eState);
        this.getGroupOfCards(); // Best Group Logic
        const dealer = this.aPlayers.find((p) => _.isEqual(p.iUserId, this.iDealerId));
        if (!dealer) {
            console.error(
                'Dealer not found',
                this.aPlayers.map((p) => p.iUserId),
                this.iDealerId
            );
            return;
        }
        const turnPlayer = this.getNextPlayer(dealer.nSeat);
        if (!turnPlayer) {
            console.error('Turn Player not found', dealer.nSeat);
            return;
        }
        return turnPlayer.takeTurn();
    }

    async getGroupOfCards() {
        _.delay(1000);
        switch (this.eGameType) {
            case 'sewali':
                this.aPlayers.map((p) => {
                    // p.setGroupHandV1(5, 15);
                    p.setGroupHand(5);
                    return null;
                });
                break;
            case 'charwali':
                this.aPlayers.map((p) => {
                    // p.setGroupHandV1(4, 12);
                    p.setGroupHand(4);
                    return null;
                });
                break;
            default:
                return null;
        }
    }

    /**
     * @typedef {Object} UserData
     * @property {string} _id
     * @property {string} sUserName
     * @property {string} sEmail
     * @property {string} sAvatar
     * @property {'user|'admin} eUserType
     * @property {number} nTotalCoins
     * @property {number} nMatchWon
     * @property {number} nMatchLost
     * @property {number} nTotalMatch
     * @property {string} eBadges
     */
    /**
     * Table.addPlayer()
     * - increment player counter in redis
     * - instantiate new player using UserData
     * - push player to aPlayers array
     * - deduct table fee from user's nTotalCoins and update in DB
     * - save table in redis
     * - push iUserId in SewaliPrivateTable.aPlayers in mongoDB
     * - if player count is 1, initializeGame()
     * @param {UserData} userData
     * @param {Function} callback
     */
    async addPlayer(userData, callback) {
        const playerCountKey = _.getTablePlayerCountKey(this._id);
        const nTotalPlayer = await redis.incrAsync(playerCountKey);
        this.eState = 'waiting';
        const sewaliPlayer = {
            iTableId: this._id,
            iUserId: userData._id,
            eState: 'waiting',
            nTotalCoins: parseInt(userData.nTotalCoins, 10),
            eBadges: userData.eBadges,
        };

        const player = new Players(this, {
            ..._.pick(userData, ['sUserName', 'sEmail', 'sAvatar', 'eUserType', 'nTotalCoins', 'eBadges', 'nMatchWon', 'nMatchLost', 'nTotalMatch']),
            ...sewaliPlayer,
            nSeat: this.getEmptySeat(),
        });
        this.aPlayers.push(player);
        const tableFee = this.nTableFee * this.nTotalRound;
        const _player = await User.findOneAndUpdate({ _id: userData._id }, { nTotalCoins: userData.nTotalCoins - tableFee }, { new: true });
        player.nTotalCoins = parseInt(_player.nTotalCoins, 10);
        _.privateEmit(userData._id, 'resUpdateCoins', { nTotalCoins: player.nTotalCoins });

        // Update spendCoins daily challenge when table fee is deducted
        this.updateDailyChallengeProgress(userData._id, ['spendCoins'], tableFee).catch((e) => {
            log.error(`Failed to update spendCoins challenge for player ${userData._id} on table join:`, e?.message);
        });

        await this.save({ aPlayers: [player.toJSON()], eState: this.eState });
        // DB store
        await this.updateTable({
            $inc: { nCoinsIn: parseInt(this.nTableFee * this.nTotalRound, 10) },
            $push: {
                aPlayers: player.iUserId,
            },
        });
        if (nTotalPlayer === 1) this.initializeGame();

        // Notify friends that they can join this table
        this.notifyFriendsToJoin(player.iUserId).catch((err) => {
            log.error(`Failed to notify friends for user ${player.iUserId} on table ${this._id}:`, err?.message || err);
        });

        callback(null, { iTableId: this._id });
    }

    /**
     * Table.addPlayer()
     * - increment player counter in redis
     * - instantiate new player using UserData
     * - push player to aPlayers array
     * - deduct table fee from user's nTotalCoins and update in DB
     * - save table in redis
     * - push iUserId in SewaliPrivateTable.aPlayers in mongoDB
     * - if player count is 1, initializeGame()
     * @param {UserData} userData
     * @param {Function} callback
     */
    async addPrivatePlayer(userData, callback) {
        const playerCountKey = _.getTablePlayerCountKey(this._id);
        const nTotalPlayer = await redis.incrAsync(playerCountKey);
        this.eState = 'waiting';
        const sewaliPlayer = {
            iTableId: this._id,
            iUserId: userData._id,
            eState: 'waiting',
            nTotalCoins: userData.nTotalCoins,
            eBadges: userData.eBadges,
        };

        const player = new Players(this, {
            ..._.pick(userData, ['sUserName', 'sEmail', 'sAvatar', 'eUserType', 'nTotalCoins', 'eBadges', 'nMatchWon', 'nMatchLost', 'nTotalMatch']),
            ...sewaliPlayer,
            nSeat: this.getEmptySeat(),
        });
        this.aPlayers.push(player);
        const tableFee = this.nTableFee * this.nTotalRound;
        const _player = await User.findOneAndUpdate({ _id: userData._id }, { nTotalCoins: userData.nTotalCoins - tableFee }, { new: true });
        player.nTotalCoins = _player.nTotalCoins;
        _.privateEmit(userData._id, 'resUpdateCoins', { nTotalCoins: parseInt(_player.nTotalCoins, 10) });

        // Update spendCoins daily challenge when private table fee is deducted
        this.updateDailyChallengeProgress(userData._id, ['spendCoins'], tableFee).catch((e) => {
            log.error(`Failed to update spendCoins challenge for player ${userData._id} on private table join:`, e?.message);
        });

        await this.save({ aPlayers: [player.toJSON()], eState: this.eState });
        // DB store
        // await player.setUser({ $push: { aSewaliTable: this._id } });
        await this.updatePrivateTable({
            $inc: { nCoinsIn: this.nTableFee * this.nTotalRound },
            $push: {
                aPlayers: player.iUserId,
            },
        });
        player.emit({ sEventName: 'resUniqueCode', oData: { sCode: player.table.sCode } }); // TODO verify through socket connection
        this.initializeGame(true); // bIsPrivate = true
        callback(null, { sCode: this.sCode, iTableId: this._id });
    }

    async updateTable(updateQuery, isPrivateTable) {
        if (!updateQuery) return false;
        const query = { _id: this._id };
        if (isPrivateTable) return SewaliPrivateTable.updateOne(query, updateQuery, _.errorCallback);
        SewaliTable.updateOne(query, updateQuery, _.errorCallback);
    }

    async updatePrivateTable(updateQuery) {
        if (!updateQuery) return false;
        const query = { _id: this._id };
        SewaliPrivateTable.updateOne(query, updateQuery, _.errorCallback);
    }

    async getSchedulerTTL(sTask, iUserId = '*') {
        let schedularKey = '';

        const aSchedular = await redis.keysAsync(_.getSchedulerKey(sTask, this._id, iUserId, '*'));
        if (aSchedular.length > 1) redis.deleteAsync(aSchedular.slice(1));
        schedularKey = aSchedular[0];

        if (!schedularKey) return -2;
        return redis.pttlAsync(schedularKey);
    }

    async forceGrabCard() {
        log.green('forceGrabCard called! ', 'aDeck.length: ', this.aDeck.length);
        // NOT needed
        /*
        if (this.aDeck.length === 0) return log.red('forceGrabCard failed! ', 'aDeck.length: ', this.aDeck.length);
        const currPlayer = this.getPlayer(this.iUserTurn);
        const idxTwoD = currPlayer.aHand.findIndex((c) => c.nLabel === 2 && c.eSuit === 'd');
        const idxTenD = currPlayer.aHand.findIndex((c) => c.nLabel === 10 && c.eSuit === 'd');
        if (idxTwoD > -1) {
            // if user has 2D card then replace it with deck card[0]
            const twoD = currPlayer.aHand[idxTwoD];
            currPlayer.aHand[idxTwoD] = this.aDeck[0];
            this.aDeck[0] = twoD;
        } else if (idxTenD > -1) {
            // if user has 10D card then replace it with deck card[0]
            const tenD = currPlayer.aHand[idxTenD];
            currPlayer.aHand[idxTenD] = this.aDeck[0];
            this.aDeck[0] = tenD;
        } else log.red('forceGrabCard failed! current player does not have 2D or 10D card');
        this.save({ aPlayers: [currPlayer], aDeck: this.aDeck });
        */
        this.setHandTimer();
    }

    async splitWinningAmount(userId) {
        const activePlayers = this.aPlayers.filter((p) => p.bIsDroppedPlayer === false).length;
        const remainingPot = this.nTablePot / (activePlayers + 1);
        this.nTablePot -= remainingPot;
        /* credit winning amount to dropped player uncomment to not credit */
        const droppedPlayer = this.getPlayer(userId);
        const _player = await User.findOneAndUpdate({ _id: droppedPlayer.iUserId }, { $set: { nTotalCoins: droppedPlayer.nTotalCoins } }, { new: true });
        _.privateEmit(droppedPlayer.iUserId, 'resUpdateCoins', { nTotalCoins: parseInt(_player.nTotalCoins, 10) });
        /* -------------------------------------------------------------------- */
        for (const p of this.aPlayers) {
            let addedCoins = 0;
            if (p.iUserId !== userId && !p.bIsDroppedPlayer) {
                /* dont distribute winning amount, uncomment to distribute */
                // if (droppedPlayer.nBalance !== 0) {
                //     addedCoins = droppedPlayer.nBalance / activePlayers;
                // }
                // compute base share and include table pot if only one active player
                let baseShare = remainingPot / activePlayers;
                if (activePlayers === 1) {
                    baseShare += this.nTablePot;
                }
                // apply VIP extra percent to split winnings
                const settingsForSplit = await Settings.findOne({}).lean();
                const vipWinPercentForSplit = settingsForSplit?.nVipWinPercent || 0;
                const isVipTable = await this.isVipTable();
                if (isVipTable && p.eUserType === 'vip' && vipWinPercentForSplit > 0) {
                    const extra = Math.round((baseShare * vipWinPercentForSplit) / 100);
                    addedCoins += baseShare + extra;
                    log.info('VIP split win bonus applied', {
                        tableId: this.iTableId,
                        iUserId: p.iUserId?.toString?.() || p.iUserId,
                        nVipWinPercent: vipWinPercentForSplit,
                        baseWinAmount: baseShare,
                        vipExtraAmount: extra,
                        finalWinAmount: baseShare + extra,
                    });
                } else {
                    addedCoins += baseShare;
                }
                p.nBalance += addedCoins;
                p.nTotalCoins += addedCoins;

                // Update reachScore, earnCoins, and winBig challenge when coins are earned from split
                if (addedCoins > 0) {
                    this.updateDailyChallengeProgress(p.iUserId, ['reachScore', 'earnCoins', 'winBig'], addedCoins).catch((e) => {
                        log.error(`Failed to update challenges for player ${p.iUserId} in splitWinningAmount:`, e?.message);
                    });
                }

                await this.save();
                if (activePlayers !== 1) p.emit('resSplitAmountData', { iUserId: userId, nTotalCoins: p.nTotalCoins, coinsToAdd: addedCoins, nTablePot: this.nTablePot });
                const { nSplitAmountTimer } = this.oSetting;
                this.setSchedular('resSplitAmountTimer', null, nSplitAmountTimer, { nSplitAmountTimer, expiredAt: Date.now() + nSplitAmountTimer });
            }
        }
    }

    // Helper function to update daily challenge progress
    async updateDailyChallengeProgress(iUserId, challengeTypes, nProgress = 1) {
        try {
            // Get user token from database
            const user = await User.findOne({ _id: iUserId }).lean();
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
    }

    updateCoins() {
        for (const player of this.aPlayers) {
            /* uncomment if condition, to not distribute player won amount in case of disconnection at game(in case if already distributed at the time of leaving) */
            if (!player.bIsDroppedPlayer) {
                User.findOneAndUpdate({ _id: player.iUserId }, { $set: { nTotalCoins: player.nTotalCoins } }, { new: true }, (err, data) => {
                    if (err) return log.err(`failed to update updateCoins for player ${player.iUserId}`, err);
                    // _.privateEmit(player.iUserId, 'resUpdateCoins', { nTotalCoins: data.nTotalCoins });
                    player.emit('resUpdateCoins', { nTotalCoins: parseInt(data.nTotalCoins, 10) });
                });

                // Update reachScore and winBig challenge when user earns coins from the game
                // Note: earnCoins is tracked per round in declareResult() to avoid double-counting
                // winBig checks if a single win amount >= target, so track it here as well
                if (player.nBalance > 0) {
                    this.updateDailyChallengeProgress(player.iUserId, ['reachScore', 'winBig'], player.nBalance).catch((e) => {
                        log.error(`Failed to update reachScore and winBig challenge for player ${player.iUserId} in updateCoins:`, e?.message);
                    });
                }
            }
            /* comment if not needed to update left player about their coin on game end */
            // if (player.bIsDroppedPlayer) player?.emit('resUpdateCoins', { nTotalCoins: player.nTotalCoins });
        }
    }

    toJSON() {
        const aToBePicked = [
            // prebuilt data
            '_id',
            'iTableId',
            'nTableFee',
            'eState',
            'eGameType',
            'nMaxPlayer',
            /** not in mongodb */
            'aDeck',
            'iUserTurn',
            'iDealerId',
            'nSortHandTime',
            'iCardId',
            'iWinnerId',
            'nScore',
            'oSetting',
            'nTableRound',
            'nTablePot',
            'bIsCardGrabbed',
            'bIsRoundWInner',
            'oFinalWinner',
            'aRoundWinner',
            'nTotalRound',
            'bIsAudio',
            'bIsTournament',
            'iTournamentId',
        ];
        if (this.sCode) aToBePicked.push('sCode'); // for private Table
        const table = _.pick(this, aToBePicked);
        table.aPlayers = this.aPlayers.map((p) => p.toJSON());
        return table;
    }

    /**
     * Notify all friends of a user that they can join this table
     * @param {string} iUserId - User ID who joined the table
     */
    async notifyFriendsToJoin(iUserId) {
        try {
            // Get all friends of the user
            const friends = await Friends.find({ iUserId: mongodb.mongify(iUserId) }, { iFriendId: 1 }).lean();
            if (!friends || friends.length === 0) return;

            // Get table info for the notification
            const tableInfo = {
                iTableId: this._id,
                iTableProtoId: this.iTableId,
                nTableFee: this.nTableFee,
                eGameType: this.eGameType,
                nMaxPlayer: this.nMaxPlayer,
                nCurrentPlayers: this.aPlayers.length,
                sTableName: this.sName || `${this.eGameType} table`,
                iFriendUserId: iUserId.toString(),
            };

            // Get friend user details for notification
            const friendUser = await User.findOne({ _id: mongodb.mongify(iUserId) }, { sUserName: 1, sAvatar: 1 }).lean();
            if (friendUser) {
                tableInfo.iFriendUserId = iUserId.toString();
                tableInfo.sFriendUserName = friendUser.sUserName;
                tableInfo.sFriendAvatar = friendUser.sAvatar;
            }

            // Emit to all friends
            friends.forEach((friend) => {
                _.privateEmit(friend.iFriendId.toString(), 'resFriendTableJoinInvite', tableInfo);
            });
        } catch (error) {
            log.error('notifyFriendsToJoin error:', error);
        }
    }
}

module.exports = Service;
