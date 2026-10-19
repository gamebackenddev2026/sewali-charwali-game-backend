const Service = require('./Service');
const { redis, SewaliHand, mongodb } = require('../../utils');
const { getPureDeck } = require('../../utils/lib/deck');
const { SewaliTable, SewaliPrivateTable, User, Settings, UserAchievements } = require('../../models');
const fairPlay = require('../../FairPlay');

class Player extends Service {
    async declareCards(body, callback = () => {}) {
        // - body:  [{ "iCardId": "d10"}]
        const initialHandLength = this.aHand?.length || 0;
        log.green(`PRE declareCards(${this.sUserName})`, ' declaring: ', `[${body.map((c) => c.iCardId)}]`, ` hand(${initialHandLength}): `, `[${this.aHand.map((c) => c._id)}]`);
        this.table.deleteScheduler('turnTimer-assignTurnTime', this.iUserId);
        this.eState = 'declared';
        this.table.eState = 'declaring';
        const _aHand = [];
        for (const card of body) {
            const _card = this.aHand.find((c) => _.isEqual(c._id, card.iCardId));
            if (_card) {
                _aHand.push(_card);
                this.aHand.splice(this.aHand.indexOf(_card), 1); // TODO : verify
            } else log.red('card not found', card.iCardId);
        }
        const obj = new SewaliHand(_aHand);
        this.oStatistics = obj.validate();

        this.aDeclaredHand = _aHand;

        if ([6, 7, 8].includes(this.oStatistics.nPriority)) {
            const aAceCards = _aHand.filter((c) => c.nLabel === 1);
            const aRestCards = _aHand.filter((c) => c.nLabel !== 1);
            aRestCards.sort((a, b) => (b.nValue - a.nValue === 0 ? b.nLabel - a.nLabel : b.nValue - a.nValue));
            this.aDeclaredHand = [...aAceCards, ...aRestCards];
        }
        if (this.aDeclaredHand.length === 3) {
            // QKA -> AQK  should be replaced. // 1A, 2...10, 11J, 12Q, 13K
            const ace = this.aDeclaredHand.find((c) => c.nLabel === 1);
            const queen = this.aDeclaredHand.find((c) => c.nLabel === 12);
            const king = this.aDeclaredHand.find((c) => c.nLabel === 13);
            if (ace && queen && king) this.aDeclaredHand = [ace, king, queen];
        }

        callback();

        this.table.emit('resDeclareCard', {
            iUserId: this.iUserId,
            declaredHand: this.aDeclaredHand,
        });

        log.green(this.table.aPlayers.map((p) => `${p.sUserName}:${p.nTurnCount}`));
        const totalTurnCount = this.table.aPlayers.filter((p) => p.nTurnCount === 1 || p.bIsDroppedPlayer).length;

        if (totalTurnCount === this.table.nMaxPlayer) {
            log.green('all players have declared', `${totalTurnCount}/${this.table.nMaxPlayer}`, ' declaring round result');
            this.table.declareResult();
        } else {
            log.blue('not all players have declared', `${totalTurnCount}/${this.table.nMaxPlayer}`);
            const nextPlayer = this.table.getNextPlayer(this.nSeat);
            nextPlayer.takeTurn();
        }
        await this.table.save({
            aPlayers: [this.toJSON()],
            eState: this.table.eState,
        });
        log.green(`POST declareCards(${this.sUserName})`, ' declared: ', `[${this.aDeclaredHand.map((c) => c._id)}]`, ` hand(${this.aHand?.length}): `, `[${this.aHand.map((c) => c._id)}]`);
    }

    async syncHandV1(body, callback = () => {}) {
        // - body:  [{ "iCardId": "d10", "nGroupId": 0 }]
        if (['dev'].includes(process.env.NODE_ENV)) log.magenta(`PRE syncHand(${this.sUserName})`, `\n count(${body?.length}): `, `${body.map((c) => `${c.nGroupId}(${c.iCardId})`)}`);
        const _aHand = [];
        for (const cardInUnity of body) {
            const _card = this.aHand.find((c) => _.isEqual(c._id, cardInUnity.iCardId));
            if (_card) {
                // card found in hand
                _card.nGroupId = cardInUnity.nGroupId;
                _aHand.push(_card);
            } else if (!_card && _.isEqual(this.table.aDeck[0]._id, cardInUnity.iCardId)) {
                log.yellow('syncHand initiated by swapping card');
                this.table.deleteScheduler('turnTimer-grabTimer');
                this.table.bIsCardGrabbed = true;
                const obj = this.table.aDeck[0];
                if (this.table.aDeck[0].nLabel === 2 && this.table.aDeck[0].eSuit === 'd') {
                    this.table.aDeck[0].nLabel = 10;
                    this.table.aDeck[0].nValue = 10;
                    this.table.aDeck[0].eSuit = 'd';
                } else {
                    this.table.aDeck[0].nLabel = 2;
                    this.table.aDeck[0].nValue = 2;
                    this.table.aDeck[0].eSuit = 'd';
                }
                _aHand.push(obj);
                this.table.setHandTimer();
            } else log.yellow('card not synced', cardInUnity.iCardId);
        }

        this.aHand = _aHand;
        if (['dev'].includes(process.env.NODE_ENV)) log.magenta(`POST syncHand(${this.sUserName})`, `\n hand(${this.aHand?.length}): `, `${this.aHand.map((c) => `${c._id}`)}`);
        callback();
        this.table.save({ aPlayers: [this.toJSON()], aDeck: this.table.aDeck });
    }

    /**
     * @param {Array<{iCardId: string, nGroupId?: number}>} body
     * @param {Function} callback
     */

    async syncHand(body, callback = () => {}) {
        try {
            if (['dev'].includes(process.env.NODE_ENV)) log.magenta(`PRE syncHand(${this.sUserName})`, `count(${body?.length}): `, `${body.map((c) => `${c.nGroupId}(${c.iCardId})`)}`);
            /** @type {Array<import('../../utils/lib/deck').Card & {nGroupId?:number}> } */
            const _aHand = [];
            for (const card of body) {
                const currCard = this.aHand.find((c) => _.isEqual(c._id, card.iCardId));
                if (currCard) {
                    currCard.nGroupId = card.nGroupId;
                    _aHand.push(currCard);
                } else if (_.isEqual(this.table.aDeck[0]?._id, card.iCardId)) {
                    log.yellow(this.sUserName, 'swapping card with deck[0]', _.stringify(this.table.aDeck[0]));
                    this.table.deleteScheduler('turnTimer-grabTimer');
                    this.table.bIsCardGrabbed = true;
                    const tableCard = { ...this.table.aDeck[0], nGroupId: card?.nGroupId };
                    _aHand.push(tableCard);
                    this.table.setHandTimer();
                } else log.yellow(`${card.iCardId} card not synced ${this.sUserName}()!!. \nbody: ${body.map((c) => `${c?.nGroupId}(${c?.iCardId})`)} \nhand: ${this.aHand.map((c) => `${c?._id}`)} \ndeck: ${this.table.aDeck.map((c) => `${c?._id}`)}`);
            }
            /** @type {Array<import('../../utils/lib/deck').Card & {nGroupId?:number}> } */
            const unSyncedCardBE = [];
            for (const card of this.aHand) {
                const currCard = body.find((c) => _.isEqual(c.iCardId, card._id));
                if (!currCard) unSyncedCardBE.push(card);
            }
            // prettier-ignore
            if (unSyncedCardBE.length > 1) log.red(this.sUserName, 'unSyncedCardBE', unSyncedCardBE.map(c => c._id), '\nHand: ', _.stringify(this.aHand.map((c) => c._id)));
            else if (unSyncedCardBE.length === 1) this.table.aDeck[0] = unSyncedCardBE[0];

            this.aHand = _aHand;
            if (['dev'].includes(process.env.NODE_ENV)) log.magenta(`POST syncHand(${this.sUserName})`, `hand(${this.aHand?.length}): `, `${this.aHand.map((c) => `${c._id}`)}`);
            this.table.save({ aPlayers: [this.toJSON()], aDeck: this.table.aDeck });
            callback();
            // if (this.checkQuads().isValid) {
            //     log.green('quads available');
            //     this.emit('resQuadAvailable', {});
            // }
        } catch (err) {
            log.error('syncHand failed', err);
        }
    }

    /**
     * - __for self mute/unmute__
     * - it will emit event`resMicStatus` to all players in table who don't have this.iUserId in their aMutedUser
     * - emit payload `{ iUserId: this.iUserId, bIsAudio: body.bIsAudio }`
     * @param {{bIsAudio: boolean}} body
     * @param {Function} callback
     * @returns
     */
    async micSetting(body, callback = () => {}) {
        this.bIsAudio = body.bIsAudio;
        await this.table.save();
        const payload = { iUserId: this.iUserId, bIsAudio: body.bIsAudio };
        this.table.aPlayers.forEach((p) => {
            if (!p.aMutedUser.includes(payload.iUserId)) p.emit('resMicStatus', payload);
        });
        callback(null, {});
    }

    async reshuffle(body, callback = () => {}) {
        this.table.bIsReshuffled = true;
        this.table.emit('resReshuffle', { iUserId: this.iUserId });
        await _.delay(5000);
        this.reshuffleData();
        this.table.distributeCard();
        callback(null, {});
    }

    reshuffleData() {
        this.table.aDeck = getPureDeck(1);
        this.table.aPlayers.map((p) => (p.aHand = []));
    }

    async discard(body, callback = () => {}) {
        this.table.emit('resDiscardCard', { iUserId: this.iUserId });
        callback(null, {});
    }

    async leave(body, callback = () => {}) {
        let redLock;
        try {
            // - log.green(`${_.now()}::Player.leave(${this.iUserId}):: redLock acquiring a lock on key ${_.genLockKey(this.iTableId, 'TBL')}`);
            redLock = await globalThis.Lock.acquire([_.genLockKey(this.iTableId, 'TBL')], _.REDLOCK_TTL_MS); // ms
            // - log.green(`${_.now()}::Player.leave(${this.iUserId}):: redLock acquired a lock on key ${_.genLockKey(this.iTableId, 'TBL')}`);
            const leaveOnWaiting = async () => {
                console.log('leaveOnWaiting');
                await redis.decrAsync(_.getTablePlayerCountKey(this.iTableId));

                const playerIndex = this.table.aPlayers.findIndex((p) => _.isEqual(p.iUserId, this.iUserId));
                if (playerIndex < 0) return callback(null, {});
                const [nPlayer] = this.table.aPlayers.splice(playerIndex, 1);
                if (!nPlayer) return callback(null, {});
                console.log('refund', this.table.nTableFee, this.table.nTotalRound, this.table.nTotalRound * this.table.nTableFee);
                const userData = await User.findOne({ _id: this.iUserId }, _.errorCallback);
                if (!userData) return callback(null, {});
                userData.nTotalCoins += this.table.nTableFee * this.table.nTotalRound;
                await userData.save();
                // here 2nd param denote privateTable
                await this.table.updateTable(
                    {
                        $pull: {
                            aPlayers: this.iUserId,
                        },
                    },
                    this.table.sCode
                );

                // if no player in table, then delete table from redis & mongo
                if (this.table.aPlayers.length === 0) {
                    if (this.table.sCode) await SewaliPrivateTable.findOneAndDelete({ _id: this.iTableId }, _.errorCallback);
                    else await SewaliTable.findOneAndDelete({ _id: this.iTableId }, _.errorCallback);
                    await redis.deleteAsync(_.getTableKey(this.iTableId));
                    await redis.deleteAsync(_.getTablePlayerCountKey(this.iTableId));
                    if (process.env.NODE_ENV === 'dev') log.green('Table removal Success.');
                } else {
                    await redis.hdelAsync(_.getTableKey(this.table._id), _.getUserKey(this.iUserId)); // remove player from redis // TODO verify
                }

                const locale = userData?.eLocale || 'en';
                const sReason = message.custom('Unable to find sufficient players', locale)?.message || 'Unable to find sufficient players';
                this.emit('resKickout', { iUserId: this.iUserId, sReason });
                this.table.emit('resLeavePlayer', { iUserId: this.iUserId });
                callback(null, userData || {});
            };

            const leaveOnDeclaring = async () => {
                console.log('leaveOnDeclaring');
                this.bIsDroppedPlayer = true;

                /*
                // below code is causing issue: it calls assignSkippedTime twice::
                // join 3 player. arrange card and click on ready.
                // then leave player who got 1st turn
                let bSkipTime = true;
                for (let i = 0; i < this.table.aPlayers.length; i += 1) {
                    if (!this.table.aPlayers[i].bIsDroppedPlayer && !this.table.aPlayers[i].bIsReqNextRound) {
                        bSkipTime = false;
                        break;
                    }
                }
                if (bSkipTime) this.table.startRound();
                */

                await this.table.save({ aPlayers: [this.toJSON()] });
                // this.setUser({ $pull: { aSewaliTable: this.table._id } });
                this.table.emit('resDropPlayer', { iUserId: this.iUserId });

                // Player leave during their turn then skip turn
                const response = await this.getTurnInfo();
                if (response) {
                    this.table.deleteScheduler('turnTimer-assignTurnTime', this.iUserId);
                    this.table.skipTurn(this.nSeat);
                }

                if (this.bIsDroppedPlayer) await this.table.lossSetStatistics(this.iUserId); // Set game statistics
                const activePlayer = this.table.aPlayers.filter((p) => !p.bIsDroppedPlayer).length;
                await this.table.splitWinningAmount(this.iUserId);
                if (activePlayer === 1) {
                    this.table.eState = 'finished';
                    this.table.aPlayers.forEach((user) => {
                        this.table.deleteScheduler('turnTimer-assignTurnTime', user.iUserId); // TODO verify
                    });

                    this.table.updateCoins(); // Update coins in db

                    const { nPopUpTimer } = this.table.oSetting;

                    const maxCard = this.table.eGameType === 'sewali' ? 15 : 12;
                    const winner = this.table.aPlayers.find((p) => !p.bIsDroppedPlayer); // TODO: it can be undefined
                    if (winner.aHand.length > maxCard) winner.aHand.splice(maxCard, winner.aHand.length - maxCard);
                    else {
                        const _aHand = [];
                        for (const roundData of winner.aWinnerData) {
                            for (const card of roundData.aCards) {
                                _aHand.push(card);
                            }
                        }
                        if (winner.aDeclaredHand) {
                            for (const card of winner.aDeclaredHand) {
                                _aHand.push(card);
                            }
                        }
                        for (const card of winner.aHand) {
                            _aHand.push(card);
                        }
                        let nGroupId = 0;
                        for (let i = 0; i < maxCard; i += 1) {
                            _aHand[i].nGroupId = nGroupId;
                            if ((i + 1) % 3 === 0) nGroupId += 1;
                        }
                        winner.aHand = _aHand;
                    }
                    await this.table.save();
                    await this.table.wonSetStatistics(winner.iUserId);
                    this.table.emit('resForcedWinner', {
                        iWinnerId: winner.iUserId,
                        aHand: winner.aHand,
                        nBalance: winner.nBalance,
                        ttl: nPopUpTimer,
                        expiredAt: Date.now() + nPopUpTimer,
                    });
                    //
                    await this.table.generateTableHistory();
                    //
                    return SewaliTable.findOneAndDelete({ _id: this.table._id }, _.errorCallback);
                }
                callback(null, {});
            };
            if (this.table.eState === 'waiting') return leaveOnWaiting();
            if (this.table.eState === 'declaring' || this.table.eState === 'initializing' || this.table.eState === 'initialized') return leaveOnDeclaring();
            callback(null, {});
        } catch (err) {
            log.error(`player.leave failed`, err);
            callback('server error', {});
        } finally {
            if (redLock && redLock.expiration > Date.now()) {
                await redLock.release();
                // - log.green(`${_.now()}::Player.leave(${this.iUserId}):: redLock released a lock on key ${_.genLockKey(this.iTableId, 'TBL')}`);
            } else log.red(`${_.now()}::Player.leave(${this.iUserId}):: redLock unable to release lock from key ${_.genLockKey(this.iTableId, 'TBL')}. auto released`);
            //
        }
    }

    async sendCoin(body, callback = () => {}) {
        try {
            let { iReceiverId, nCoins } = body;
            nCoins = Number.parseInt(nCoins);

            if (!iReceiverId) return callback(`required field iReceiverId`, {});
            if (!nCoins) return callback(`required field nCoins`, {});
            if (nCoins < 1) return callback(`coins should be greater than 0`, {});
            //
            const _sender = this.table.aPlayers.find((p) => p.iUserId.toString() === this.iUserId.toString());
            const _receiver = this.table.aPlayers.find((p) => p.iUserId.toString() === iReceiverId);

            if (!this.iUserId === iReceiverId) return callback(`can not send to same id ${this.iUserId}`, {});
            if (!_sender) return callback(`sender not found with id ${this.iUserId}`, {});
            if (!_receiver) return callback(`receiver not found with id ${iReceiverId}`, {});

            if (_sender.nTotalCoins < nCoins) return callback(`not enough coins available`, {});
            _sender.nTotalCoins -= nCoins;
            _receiver.nTotalCoins += nCoins;

            // Update spendCoins daily challenge when sending coins
            this.table.updateDailyChallengeProgress(this.iUserId, ['spendCoins'], nCoins).catch((e) => {
                log.error(`Failed to update spendCoins challenge for player ${this.iUserId} in sendCoin:`, e?.message);
            });

            this.emit('resUpdateCoins', { nTotalCoins: parseInt(_sender.nTotalCoins, 10) });
            _.privateEmit(iReceiverId, 'resUpdateCoins', { nTotalCoins: parseInt(_receiver.nTotalCoins, 10) });

            await this.table.save({ aPlayers: this.table.aPlayers.map((p) => p.toJSON()) });
            //
            callback(null, { nTotalCoins: parseInt(_sender.nTotalCoins, 10) });
            this.table.emit('resSendCoin', { iSenderId: this.iUserId, iReceiverId, nCoins, nSenderTotalCoin: parseInt(_sender.nTotalCoins, 10), nReceiverTotalCoin: parseInt(_receiver.nTotalCoins, 10) });
            fairPlay.recordCoinTransfer(this.iUserId.toString(), iReceiverId.toString(), nCoins, this.table._id?.toString?.()).catch(() => {});
        } catch (err) {
            log.error(`player.sendCoin failed`, err);
            callback('server error', {});
        }
    }

    /**
     * - to give tip to the dealer
     * @param {{nAmount: number}} body
     * @param {Function} callback
     */
    async tipToDealer(body, callback = () => {}) {
        const [user, setting] = await Promise.all([
            User.findOne({ _id: mongodb.mongify(this.iUserId) }, { _id: 1, nTotalCoins: 1, eLocale: 1 }).lean(),
            Settings.findOne({}, { iTipGiverId: 1 }).lean(), //
        ]);
        if (!user) return callback(message.not_found('User', user.eLocale || 'en')?.message, {});
        if (!setting.iTipGiverId) return callback(message.not_found('Settings', user.eLocale || 'en')?.message, {});
        if (user.nTotalCoins < body.nAmount) return callback(message.insufficient_balance('', user.eLocale || 'en')?.message);

        this.nTotalCoins = Math.round(this.nTotalCoins - body.nAmount);
        await Promise.all([
            User.updateOne({ _id: mongodb.mongify(this.iUserId) }, { $inc: { nTotalCoins: -body.nAmount } }),
            this.table.save(), //
        ]);

        // Update spendCoins daily challenge when tipping dealer
        this.table.updateDailyChallengeProgress(this.iUserId, ['spendCoins'], body.nAmount).catch((e) => {
            log.error(`Failed to update spendCoins challenge for player ${this.iUserId} in tipToDealer:`, e?.message);
        });

        callback(null, { nTotalCoins: this.nTotalCoins, sToast: message.tip_sent('', user.eLocale || 'en')?.message });
        _.privateEmit(this.iUserId, 'resUpdateCoins', { nTotalCoins: this.nTotalCoins });
        this.table.emit('resTipToDealer', { iUserId: this.iUserId, nAmount: body.nAmount });

        // update achievement
        const parentAchievement = await UserAchievements.findOne({ iUserId: mongodb.mongify(this.iUserId), iAchievementId: setting.iTipGiverId }).lean();
        if (!parentAchievement) return callback(message.not_found('Achievement', user.eLocale || 'en'));

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
    }
}

module.exports = Player;
