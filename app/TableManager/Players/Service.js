const { User } = require('../../models');
const { SewaliHand } = require('../../utils');
const { redis } = require('../../utils');

class Service {
    /**
     *
     * @param {import('../Table/SewaliTable')} table
     * @param {*} oPlayerData
     */
    constructor(table, oPlayerData) {
        /** @type {string} */
        this._id = oPlayerData._id;
        /** @type {string} */
        this.iUserId = oPlayerData.iUserId;
        /** @type {string} */
        this.iTableId = oPlayerData.iTableId;
        /** @type {string} */
        this.sUserName = oPlayerData.sUserName;
        /** @type {string} */
        this.sEmail = oPlayerData.sEmail;
        /** @type {string} */
        this.sAvatar = oPlayerData.sAvatar;
        /** @type {string} */
        this.sRootSocket = oPlayerData.sRootSocket;
        /** @type {string} */
        this.sAgoraId = oPlayerData.sAgoraId || '';
        /** @type {*} */
        this.aPlayerInfo = oPlayerData.aPlayerInfo || [];
        /** @type {'user'|'admin'} */
        this.eUserType = oPlayerData.eUserType;
        /** @type {*} */
        this.eState = oPlayerData.eState;
        /** @type {number} */
        this.nTotalCoins = oPlayerData.nTotalCoins;
        //
        /** @type {number} */
        this.nMatchWon = oPlayerData.nMatchWon || 0;
        /** @type {number} */
        this.nMatchLost = oPlayerData.nMatchLost || 0;
        /** @type {number} */
        this.nTotalMatch = oPlayerData.nTotalMatch || 0;
        //
        /** @type {'beginner' | 'intermediate' | 'expert'} */
        this.eBadges = oPlayerData.eBadges;
        /** @type {Array<import('../../utils/lib/deck').Card & {nGroupId:number}> } */
        this.aHand = oPlayerData.aHand || [];
        /** @type {number} */
        this.nSeat = oPlayerData.nSeat;
        /** @type {number} */
        this.nTurnCount = oPlayerData.nTurnCount || 0;
        /** @type {number} */
        this.nMissedTurn = oPlayerData.nMissedTurn || 0;
        /** @type {number} */
        this.nBalance = oPlayerData.nBalance || 0;
        /** @type {number} */
        this.nPotValue = oPlayerData.nPotValue || 0;
        /** @type {Array<any>} */
        this.aDeclaredHand = oPlayerData.aDeclaredHand || [];
        /** @type {Array<any>} */
        this.aWinnerData = oPlayerData.aWinnerData || [];
        /** @type {Record<string, any>} */
        this.oStatistics = oPlayerData.oStatistics || {};
        /** @type {Record<string, any>} */
        this.oMainStatistics = oPlayerData.oMainStatistics || {};
        /** @type {boolean} */
        this.bIsReqNextGame = oPlayerData.bIsReqNextGame || false;
        /** @type {boolean} */
        this.bIsReqNextRound = oPlayerData.bIsReqNextRound || false;
        /** @type {boolean} */
        this.bIsDroppedPlayer = oPlayerData.bIsDroppedPlayer || false;
        /** @type {boolean} */
        this.bIsAudio = oPlayerData.bIsAudio || true;
        /** @type {boolean} */
        this.bIsJoinEventCalled = oPlayerData.bIsJoinEventCalled || false;
        /** @type {Array<string>} */
        this.aMutedUser = oPlayerData.aMutedUser || []; // array of iUserId

        this.table = table;
    }

    get gameState() {
        const _table = this.table.toJSON(); // must be cloned
        _table.player = this.toJSON();
        _table.aPlayers.map((p) => delete p.aHand);
        return _table;
    }

    get hasValidTurn() {
        return _.isEqual(this.table.iUserTurn, this.iUserId);
    }

    // for quad testing
    // /*
    customHand(totalCards) {
        const aHand = [];
        if (totalCards === 17) {
            const firstQuad = this.table.aDeck.filter((card) => card.nLabel === 4); // [{},{},{},{}]
            const secondQuad = this.table.aDeck.filter((card) => card.nLabel === 6);
            if (firstQuad.length === 4 && secondQuad.length === 4) {
                for (const card of [...firstQuad, ...secondQuad]) {
                    const index = this.table.aDeck.findIndex((c) => c.nLabel === card.nLabel);
                    aHand.push(this.table.aDeck.splice(index, 1)[0]);
                }
                aHand.push(...this.table.aDeck.splice(-9));
            } else {
                aHand.push(...this.table.aDeck.splice(-totalCards));
            }
        } else {
            const quad = this.table.aDeck.filter((card) => card.nLabel === 4);
            if (quad.length === 4) {
                for (const card of quad) {
                    const index = this.table.aDeck.findIndex((c) => c.nLabel === card.nLabel);
                    aHand.push(this.table.aDeck.splice(index, 1)[0]);
                }
                aHand.push(...this.table.aDeck.splice(-9));
            } else {
                aHand.push(...this.table.aDeck.splice(-totalCards));
            }
        }
        return aHand;
    }

    setHand() {
        const totalCards = this.table.eGameType === 'sewali' ? 17 : 13;
        const aHand = process.env.forceQuaq ? this.customHand(totalCards) : this.table.aDeck.splice(-totalCards);
        aHand.map((c) => (c.nGroupId = 0));
        if (totalCards === 17) {
            if (this.table.aDeck[0].nLabel === 2 && this.table.aDeck[0].eSuit === 'd') {
                const hasDiamondOfTen = aHand.some((elem) => elem.nLabel === 10 && elem.eSuit === 'd');
                if (hasDiamondOfTen) this.table.iUserTurn = this.iUserId;
            } else {
                const hasDiamondOfTwo = aHand.some((elem) => elem.nValue === 2 && elem.eSuit === 'd');
                if (hasDiamondOfTwo) this.table.iUserTurn = this.iUserId;
            }
        }
        this.eState = 'initializing';
        this.aHand = aHand;
        this.emit('resHand', this.aHand);

        return {
            iUserId: this.iUserId,
            eState: this.eState,
        };
    }

    checkQuadsV1() {
        const aSortedHand = _.deepClone(this.aHand);
        aSortedHand.sort((a, b) => a.nLabel - b.nLabel);
        const counter = [];
        for (let i = 0; i < aSortedHand.length; i += 1) {
            const cardLength = aSortedHand.filter((c) => c.nLabel === aSortedHand[i].nLabel).length;
            if (cardLength > 3) counter.push(aSortedHand[i]);
            i += cardLength - 1;
        }
        if ((counter.length > 1 && this.table.nMaxPlayer === 3) || (counter.length > 0 && this.table.nMaxPlayer === 4)) {
            this.aHand.map((p) => {
                p.nGroupId = 0;
                return null;
            });
            for (let i = 0; i < counter.length; i += 1) {
                this.aHand.map((p) => {
                    if (p.nLabel === counter[i].nLabel) p.nGroupId = 0;
                    else p.nGroupId += 1;
                    return null;
                });
            }
            this.iWinnerId = this.iUserId;
            return { isValid: true, iWinnerId: this.iWinnerId };
        }
        return { isValid: false };
    }

    checkQuads() {
        /** @type {typeof this.aHand} aHand */
        const aHand = _.deepClone(this.aHand);

        const groups = {};

        aHand.forEach((card) => {
            if (card.nGroupId >= 0) groups[card.nGroupId] = groups[card.nGroupId] ? [...groups[card.nGroupId], card] : [card];
        });

        /** @type {Array<typeof this.aHand>} eligibleGroups */
        const eligibleGroups = Object.values(groups).filter((group) => group.length === 4);
        const quadGroups = eligibleGroups.filter((group) => group.every((card) => card.nLabel === group[0].nLabel));

        const { eGameType } = this.table;

        if (eGameType === 'sewali') return { isValid: quadGroups.length === 2, iWinnerId: quadGroups.length === 2 ? this.iUserId : undefined };
        if (eGameType === 'charwali') return { isValid: quadGroups.length === 1, iWinnerId: quadGroups.length === 1 ? this.iUserId : undefined };

        return { isValid: false };
    }

    // setGroupHandV1(nTotalGroup, nLastCardIndex) {
    //     const aCards = _.deepClone(this.aHand);
    //     const aGroupped = [];
    //     const aUnGroupped = [];
    //     for (let gId = 0; gId <= 6; gId += 1) {
    //         const group = aCards.filter((card) => card.nGroupId === gId);
    //         // eslint-disable-next-line no-continue
    //         if (!group.length) continue;
    //         // eslint-disable-next-line no-unused-expressions
    //         group.length === 3 ? aGroupped.push(...group) : aUnGroupped.push(...group);
    //     }
    //     const { nGroupAlreadyMade, aOldGroup } = _.reAssignGroup(aGroupped);

    //     const nGroupRemaining = nTotalGroup - nGroupAlreadyMade;

    //     if (nGroupRemaining === 0) {
    //         this.aHand.splice(nLastCardIndex, 2);
    //         this.emit('resBestHand', this.aHand);
    //         this.table.save({ aPlayers: [this.toJSON()] });
    //         return;
    //     }
    //     const botHand = new Bot(aUnGroupped, nGroupRemaining);
    //     const oNewGroup = botHand.getBestGroup();
    //     const aNewGroup = [oNewGroup.aPure235, oNewGroup.aImpure235, oNewGroup.aSet, oNewGroup.aStraight, oNewGroup.aNormal, oNewGroup.aColor, oNewGroup.aPair, oNewGroup.aHighCard].filter((_group) => _group.length);

    //     let counter = nGroupAlreadyMade;
    //     for (const group of aNewGroup) {
    //         for (const subgroup of group) {
    //             for (const card of subgroup) {
    //                 card.nGroupId = counter;
    //             }
    //             counter += 1;
    //         }
    //     }

    //     this.aHand = aOldGroup;
    //     this.aHand.push(...aNewGroup.flat(2));
    //     this.emit('resBestHand', this.aHand);
    //     this.table.save({ aPlayers: [this.toJSON()] });
    // }

    setGroupHand(nTotalGroup) {
        const aCards = _.deepClone(this.aHand);
        const aGroupped = [];
        const aUnGroupped = [];
        for (let gId = 0, i = 0; gId <= 6; gId += 1) {
            const group = aCards.filter((card) => card.nGroupId === gId);
            // eslint-disable-next-line no-continue
            if (!group.length) continue;
            // eslint-disable-next-line no-unused-expressions
            if (group.length === 3) {
                group.forEach((card) => {
                    card.nGroupId = i;
                    return card;
                });
                aGroupped.push(...group);
                i += 1;
            } else {
                aUnGroupped.push(...group);
            }
        }

        const rem = nTotalGroup - aGroupped.length / 3;
        for (let i = 0, j = 0; i < rem; i += 1) {
            const aGroup = aUnGroupped.splice(j, 3);
            aGroup.forEach((c) => (c.nGroupId = aGroupped.length / 3));
            aGroupped.push(...aGroup);
        }

        this.aHand = aGroupped;
        this.emit('resBestHand', this.aHand);
        this.table.save({ aPlayers: [this.toJSON()] });
    }

    showBestHand() {
        const _aHand = _.deepClone(this.aHand);
        const oGroup = {};
        const _oStatistics = {};
        for (const card of _aHand) {
            // eslint-disable-next-line no-unused-expressions
            oGroup[`${card.nGroupId}`] ? oGroup[`${card.nGroupId}`].push(card) : (oGroup[`${card.nGroupId}`] = [card]);
        }
        for (const [sGroupId, aCard] of Object.entries(oGroup)) {
            if (aCard.length === 3) {
                const obj = new SewaliHand(aCard);
                _oStatistics[sGroupId] = obj.validate();
            }
        }

        let nscore = 0;
        let rank = 0;
        let priority = 10;
        let bestGroup;
        for (const [sGroupId, oStatistics] of Object.entries(_oStatistics)) {
            if (oStatistics.nPriority < priority) {
                nscore = oStatistics.nScore;
                rank = oStatistics.nRank;
                priority = oStatistics.nPriority;
                bestGroup = oGroup[sGroupId];
            } else if (oStatistics.nPriority === priority) {
                if (oStatistics.nScore > nscore) {
                    nscore = oStatistics.nScore;
                    rank = oStatistics.nRank;
                    bestGroup = oGroup[sGroupId];
                } else if (oStatistics.nScore === nscore) {
                    if (oStatistics.nRank < rank) {
                        rank = oStatistics.nRank;
                        bestGroup = oGroup[sGroupId];
                    }
                }
            }
        }
        return bestGroup;
    }

    grabFirstGroup() {
        return this.aHand.filter((c) => c.nGroupId === 0);
    }

    async setNextGame() {
        this.bIsReqNextGame = true;
        await this.table.save({ aPlayers: [this.toJSON()] });
    }

    /**
     * - sets `player.bIsReqNextRound = true`
     * - and then saves table
     */
    async setRound() {
        this.bIsReqNextRound = true;
        await this.table.save({ aPlayers: [this.toJSON()] });
        // const a = await redis.hgetallAsync(_.getTableKey(this.iTableId));
        // log.green(
        //     'this,json',
        //     this.toJSON().bIsReqNextRound,
        //     `setRound(${this.sUserName})=>`,
        //     JSON.stringify(
        //         Object.keys(a)
        //             .filter((k) => k.startsWith('aPlayers'))
        //             .map((x) => JSON.parse(a[x]))
        //             .map((p) => ({ [p.sUserName]: p.bIsReqNextRound }))
        //     )
        // );
    }

    emit(sEventName, oData = {}) {
        if (!sEventName) return false;
        if (this.sRootSocket) globalThis.io.to(this.sRootSocket).emit(this.table._id, { sEventName, oData });
    }

    deletePlayer() {
        log.error(`deletePlayer(${this.sUserName}) called!`);
    }

    resetRound() {
        this.nTurnCount = 0;
        this.nMissedTurn = 0;
        this.aDeclaredHand = [];
    }

    reset() {
        this.aHand = [];
        this.nTurnCount = 0;
        this.nMissedTurn = 0;
        this.aDeclaredHand = [];
        this.aWinnerData = [];
        this.oStatistics = {};
        this.nBalance = 0;
        this.oMainStatistics = {};
        this.bIsReqNextGame = false;
        this.bIsReqNextRound = false;
        this.aMutedUser = [];
    }

    async setUser(updateQuery) {
        if (!updateQuery) return false;
        const query = { _id: this.iUserId };
        await User.updateOne(query, updateQuery, _.errorCallback);
    }

    async stateHandler() {
        if (process.env.NODE_ENV !== 'prod') log.blue(`table is in ${this.table.eState} stage`);
        if (this.table.eState === 'waiting') return;
        if (this.table.eState === 'initialized') return this.sendArrangeCardTimer();
        if (this.table.eState === 'declaring') return this.sendDeclaringInfo();
        if (this.table.eState === 'declared') return this.sendDeclaredInfo();
        if (this.table.eState === 'finished') return this.sendWinnerInfo();
        if (this.table.eState === 'quadwinner') return this.sendQuadWinnerInfo();
    }

    async getTurnInfo() {
        const currentTTL = await this.table.getSchedulerTTL('turnTimer-assignTurnTime', this.iUserId);
        if (currentTTL <= 0) return false;

        return {
            iUserId: this.iUserId,
            ttl: Math.round(currentTTL / 1000) * 1000,
            initialValue: Math.round((this.table.oSetting.nTurnTime - currentTTL) / this.table.oSetting.nTurnTime),
            nTotalTurnTime: this.table.oSetting.nTurnTime,
        };
    }

    /** It emits `resSetHandTimer` to user when `turnTimer-assignSetHandTime` is not expired in redis. i.e table is in initialized state */
    async sendArrangeCardTimer() {
        const player = this.table.getPlayer(this.table.iUserTurn);
        if (!player) return this.logError('player not found');

        const currentTTL = await this.table.getSchedulerTTL('turnTimer-assignSetHandTime');
        if (currentTTL <= 0) return this.logError('turnTimer-assignSetHandTime cleared but sendArrangeCardTimer is called');

        this.emit('resSetHandTimer', {
            ttl: Math.round(currentTTL / 1000) * 1000,
            initialValue: Math.round((this.table.oSetting.nInitialTimer - currentTTL) / this.table.oSetting.nInitialTimer),
            nTotalTurnTime: this.table.oSetting.nInitialTimer,
        });
    }

    async sendDeclaringInfo() {
        const player = this.table.getPlayer(this.table.iUserTurn);
        if (!player) return this.logError('player not found');

        this.table.aPlayers.forEach(async (p) => {
            if (p.nTurnCount === 1 && p.aDeclaredHand.length > 0) {
                this.table.emit('resDeclareCard', { iUserId: p.iUserId, declaredHand: p.aDeclaredHand });
            }
            const response = await p.getTurnInfo();
            if (response) {
                this.emit('resPlayerTurn', response);
            }
        });
    }

    async sendDeclaredInfo() {
        const player = this.table.getPlayer(this.table.iUserTurn);
        if (!player) return this.logError('player not found');

        let ttl = await this.table.getSchedulerTTL('turnTimer-assignRoundTime');
        if (ttl <= 0) return false;

        ttl = Math.round(ttl / 1000) * 1000;
        const winner = this.table.iWinnerId;
        if (!winner) return false;

        this.emit('resDeclareWinner', { iWinnerId: winner, nTableRound: this.table.nTableRound, nBalance: this.table.nTableFee * this.table.nMaxPlayer, ttl });
    }

    async sendWinnerInfo() {
        log.green('sendWinnerInfo called');
        const player = this.table.getPlayer(this.table.iUserTurn);
        if (!player) return this.logError('player not found');

        let ttl = await this.table.getSchedulerTTL('resetGameTimer');
        if (ttl <= 0) return false;

        ttl = Math.round(ttl / 1000) * 1000;
        log.green('sendWinnerInfo called', { roundWinnerData: this.table.aRoundWinner, winner: this.table.oFinalWinner, ttl });

        this.emit('resWinnerData', { roundWinnerData: this.table.aRoundWinner, winner: this.table.oFinalWinner, ttl });
    }

    async sendQuadWinnerInfo() {
        const _aHand = this.table.aPlayers.find((p) => p.iUserId === this.table.iWinnerId).aHand;
        this.emit('resWinnerWithQuads', { iWinnerId: this.table.iWinnerId, aHand: _aHand, nBalance: this.table.nTableFee * 15 });
    }

    async takeTurn() {
        if (this.table.eState === 'finished') return;
        if (this.table.nTableRound > this.table.nTotalRound - 1) return;
        this.table.eState = 'declaring';
        this.eState = 'declaring';
        await this.table.save({ eState: this.table.eState });
        this.nTurnCount += 1;

        if (this.bIsDroppedPlayer) {
            await this.table.save({ aPlayers: [this.toJSON()] });
            return this.table.skipTurn(this.nSeat);
        }

        this.table.iUserTurn = this.iUserId;
        const { nTurnTime } = this.table.oSetting;
        this.table.setSchedular('turnTimer-assignTurnTime', this.iUserId, nTurnTime, { nTurnTime, expiredAt: Date.now() + nTurnTime });
        await this.table.emit('resPlayerTurn', { iUserId: this.iUserId, ttl: nTurnTime, initialValue: 0, nTotalTurnTime: nTurnTime, eState: this.eState });
        await this.table.save({ iUserTurn: this.table.iUserTurn, aPlayers: [this.toJSON()] });
    }

    /**
     * @param {Array<{iCardId:string, eSuit:string, isJoker:boolean, nGroupId:number, nLabel:number, nValue:number}>} body
     * @param {Function} callback
     */
    async forceDeclareCards(body, callback = () => {}) {
        const initialHandLength = this.aHand?.length || 0;
        log.green(`PRE FORCE-declareCards(${this.sUserName})`, ' declaring: ', `[${body.map((c) => c.iCardId)}]`, ` hand(${initialHandLength}): `, `[${this.aHand.map((c) => c._id)}]`);
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

        this.table.emit('resDeclareCard', { iUserId: this.iUserId, declaredHand: this.aDeclaredHand });
        this.emit('resForceDeclare', { nGroupId: this.aDeclaredHand[0].nGroupId });

        const totalTurnCount = this.table.aPlayers.filter((p) => p.nTurnCount === 1 || p.bIsDroppedPlayer).length;

        if (totalTurnCount === this.table.nMaxPlayer) {
            log.green('all players have declared', `${totalTurnCount}/${this.table.nMaxPlayer}`, ' declaring round result');
            this.table.declareResult();
        } else {
            log.blue('not all players have declared', `${totalTurnCount}/${this.table.nMaxPlayer}`);
            const nextPlayer = this.table.getNextPlayer(this.nSeat);
            nextPlayer.takeTurn();
        }
        await this.table.save({ aPlayers: [this.toJSON()], eState: this.table.eState });
        log.green(`POST FORCE-declareCards(${this.sUserName})`, ' declared: ', `[${this.aDeclaredHand.map((c) => c._id)}]`, ` hand(${this.aHand?.length}): `, `[${this.aHand.map((c) => c._id)}]`);
    }

    // called when player dont take turn
    async assignTurnTime() {
        try {
            if (this.table.nTableRound > this.table.nTotalRound - 1) return;
            log.yellow(`assignTurnTime(${this.sUserName})`, ' hand: ', `[${this.aHand?.map((c) => c?._id)}]`);
            const aCardToDeclare = this.grabFirstGroup().map((x) => ({
                iCardId: x._id,
                eSuit: x.eSuit,
                isJoker: x.isJoker,
                nGroupId: x.nGroupId,
                nLabel: x.nLabel,
                nValue: x.nValue,
            })); // - this.showBestHand()
            if (!aCardToDeclare?.length) {
                log.red(`assignTurnTime(${this.sUserName})`, ' no cards to declare ', `Hand(${this.aHand.length}): `, `[${this.aHand.map((c) => c._id)}]`, ' aCardToDeclare:', aCardToDeclare);
                return;
            }
            await this.forceDeclareCards(aCardToDeclare);
        } catch (error) {
            log.error(`assignTurnTime(${this.sUserName}) failed`, error.message);
            this.logError(error);
        } finally {
            await redis.rpushAsync(`${this.iTableId}:playingOrder`, this.nSeat);
            await redis.expireAsync(`${this.iTableId}:playingOrder`, 180);
        }
    }

    async dropPlayer() {
        this.eState = 'dropped';

        this.table.deleteScheduler('turnTimer-*', this.iUserId);
        this.table.emit('resDroppedPlayer', { iUserId: this.iUserId });

        this.table.save({ aPlayers: [this.toJSON()] });
        const playingPlayers = this.table.aPlayers.filter((e) => e.eState === 'declaring');

        if (playingPlayers.length === 1) {
            this.table.iWinnerId = playingPlayers[0].iUserId;
            return this.emit('resWinnerData', { aHand: playingPlayers[0].aHand });
        }
        const nextTurn = this.getNextPlayer(this.nSeat);
        return nextTurn.takeTurn();
    }

    logError(error) {
        log.trace({
            error,
            iTableId: this.iTableId,
            iUserId: this.iUserId,
            sUserName: `${this.sUserName}-${this.eUserType}`,
            eTableState: this.table.eState,
            eGameType: this.table.eGameType,
        });
    }

    toJSON() {
        return _.pick(this, [
            // prebuilt data
            '_id',
            'iUserId',
            'iTableId',
            'sUserName',
            'sEmail',
            'sAvatar',
            'sRootSocket',
            'sAgoraId',
            'eState',
            'eUserType',
            'nGraceTime',
            'nTotalCoins',
            'nMatchWon',
            'nMatchLost',
            'nTotalMatch',
            'eBadges',
            'nTurnCount',
            'nBalance',
            'nPotValue',
            'nSeat',
            'aHand',
            'aDeclaredHand',
            'aWinnerData',
            'oStatistics',
            'oMainStatistics',
            'bIsReqNextGame',
            'bIsReqNextRound',
            'bIsDroppedPlayer',
            'bIsAudio',
            'bIsJoinEventCalled',
            'aMutedUser',
        ]);
    }
}

module.exports = Service;
