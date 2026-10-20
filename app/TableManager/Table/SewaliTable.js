/* eslint-disable no-console */
/* eslint-disable no-loop-func */
/* eslint-disable no-continue */
const Service = require('./Service');
const { User, SewaliPrivateTable, TableHistory, Table, Tournament, Settings } = require('../../models');
const { getPureDeck } = require('../../utils/lib/deck');
const { redis, mongodb, SewaliHand } = require('../../utils');
const fairPlay = require('../../FairPlay');

// this can be treated as calculation of net run rate
function calculateCombinedScore(userStats) {
    // Given weights
    const wPriority = 100; // weight for priority
    const wScore = 10; // weight for score
    const wRank = 1; // weight for rank

    // Extracting values from userStats object
    const { nPriority, nRank, nScore } = userStats;

    // Normalizing values
    const minPriority = 1;
    const maxPriority = 8;
    const minRank = 0;
    const maxRank = 3;
    const minScore = 2;
    const maxScore = 100;

    // However, since the ranges of score, rank, and priority are different
    // it is better to normalize these values before calculating the combined score.
    // Normalization scales the values to a common range (usually between 0 and 1) to ensure each parameter contributes equally to the final score.
    const normalizedPriority = 1 - (nPriority - minPriority) / (maxPriority - minPriority); // Apply linear scaling to prioritize lower priority
    const normalizedRank = 1 - (nRank - minRank) / (maxRank - minRank); // Apply linear scaling to prioritize lower rank
    const normalizedScore = (nScore - minScore) / (maxScore - minScore); // no scalling needed to prioritize higher score

    // Calculating combined score
    const combinedScore = wPriority * normalizedPriority + wRank * normalizedRank + wScore * normalizedScore;

    return combinedScore;
}

class SewaliTable extends Service {
    async initializeGame(bIsPrivate = false) {
        return bIsPrivate ? this.initializePrivateGame() : this.initializeGameTimer();
    }

    async initializeGameTimer() {
        let i = this.oSetting.nBeginCountdown / 1000; // 60 sec
        let track = 6;
        if (this.aPlayers.length === 0) return;
        const initialTimer = setInterval(async () => {
            if (this.aPlayers.length === this.nMaxPlayer && this.aPlayers.every((p) => p.bIsJoinEventCalled)) {
                this.eState = 'initializing';
                await this.save({ eState: this.eState });
                if (i < 5 && track === 4) track = i;
                this.emit('resInitializeTimer', { timer: (track -= 1), bHasPlayerJoined: true });
            } else this.emit('resInitializeTimer', { timer: (i -= 1) }); // emit every second to client about remaining time from 60 sec
            if (i === -1 || track === -1) {
                this.emit('resInitializeTimer', { timer: -1 });
                clearInterval(initialTimer);
                if (this.aPlayers.length !== this.nMaxPlayer) {
                    this.aPlayers.forEach((p) => {
                        p.bIsDroppedPlayer = true;
                        p.leave(); // -  leave table and refund amount to player when table.eState is 'waiting'
                    });
                    await this.save({ aPlayers: this.aPlayers.map((p) => p.toJSON()) });
                    return;
                }
                emitter.emit('reqSchedule', 'distributeCard', this._id.toString());
                this.emit('resRoundNo', { msg: 'Round 1' });
            }
        }, 1000);
    }

    async initializePrivateGame() {
        if (this.aPlayers.length === 0) return;
        if (this.aPlayers.length !== this.nMaxPlayer) return;
        this.eState = 'initializing';
        await this.save();
        let track = 6;
        await SewaliPrivateTable.updateOne({ _id: this._id }, { $set: { eState: 'playing' } });
        const initialTimer = setInterval(async () => {
            this.emit('resInitializeTimer', { timer: (track -= 1), bHasPlayerJoined: true });
            if (track === -1) {
                this.emit('resInitializeTimer', { timer: -1 }); // TODO verify if this is needed.
                clearInterval(initialTimer);
                emitter.emit('reqSchedule', 'distributeCard', this._id.toString());
                this.emit('resRoundNo', { msg: 'Round 1' });
            }
        }, 1000);
    }

    async distributeCard() {
        if (this.aDeck.length !== 52) return false;
        // Mark match start (used for FairPlay rapid game completion detection).
        // We set it only once per match; resetGame() will clear it for the next match.
        if (!Number.isFinite(Number(this.nGameStartedAt))) {
            this.nGameStartedAt = Date.now();
        }
        const playerState = this.aPlayers.sort((a, b) => a.nSeat - b.nSeat).map((p) => p.setHand());
        let oDealer = _.randomFromArray(this.aPlayers);
        if (this.oFinalWinner !== null && this.oFinalWinner.length > 0) {
            const prevWinner = this.aPlayers.findIndex((p) => p.iUserId === this.oFinalWinner[0].iUserId);
            let dealerIndex = prevWinner + 1;
            if (dealerIndex > this.nMaxPlayer - 1) dealerIndex = 0;
            oDealer = this.aPlayers[dealerIndex];
            this.oFinalWinner = [];
        }
        this.iDealerId = oDealer.iUserId;
        this.emit('resPlayerState', playerState);
        this.eState = 'initializing';
        await this.save({
            aDeck: this.aDeck,
            aPlayers: this.aPlayers.map((p) => p.toJSON()),
            iUserTurn: this.iUserTurn,
            iDealerId: this.iDealerId,
            oFinalWinner: this.oFinalWinner,
            eState: this.eState,
            nGameStartedAt: this.nGameStartedAt,
        });
        this.emit('resDealerId', { dealerId: this.iDealerId });
        if (this.nMaxPlayer === 3) {
            this.emit('resUserTurn', { userId: this.iUserTurn });
            log.green(`resShowCard: ${_.stringify({ openCard: this.aDeck[0], msg: 'Arrange your cards' })}`);
            this.emit('resShowCard', { openCard: this.aDeck[0], msg: 'Arrange your cards' });
            const { nGrabTimer } = this.oSetting;
            this.setSchedular('turnTimer-grabTimer', null, nGrabTimer, { nGrabTimer, expiredAt: Date.now() + nGrabTimer });
        } else this.setHandTimer();
    }

    /* round winner */
    async declareResult() {
        log.yellow('declareResult called');
        const currentTTL = await this.getSchedulerTTL('resLeaveTimer');
        if (currentTTL !== -2) await _.delay(currentTTL);
        this.eState = 'declared';
        let score = 0;
        let rank = 0;
        let priority = 10;
        let winner;
        const playingOrder = await redis.lrangeAsync(`${this._id}:playingOrder`, 0, -1); // contains nSeat
        await redis.deleteAsync(`${this._id}:playingOrder`);
        const playerWithSameScore = [];
        for (let i = 0; i < this.aPlayers.length; i += 1) {
            const p = this.aPlayers[i];
            if (p.bIsDroppedPlayer) continue;
            if (p.oStatistics.nPriority < priority) {
                score = p.oStatistics.nScore;
                rank = p.oStatistics.nRank;
                priority = p.oStatistics.nPriority;
                winner = p;
            } else if (p.oStatistics.nPriority === priority) {
                if (p.oStatistics.nScore > score) {
                    score = p.oStatistics.nScore;
                    rank = p.oStatistics.nRank;
                    winner = p;
                } else if (p.oStatistics.nScore === score) {
                    if (winner && !playerWithSameScore.find((player) => player.nSeat === winner?.nSeat)) playerWithSameScore.push(winner);
                    playerWithSameScore.push(p);
                    winner = p; // the one who put at last will win. and since aPlayers is sorted based on seat, the last one will put card at last as turn is based on nSeat
                }
            }
        }
        if (playerWithSameScore.length > 1) {
            const winnerOrder = playingOrder.filter((p) => playerWithSameScore.map((a) => a.nSeat).includes(p.nSeat)); // [0, 1]
            const updatedWinner = playerWithSameScore.find((p) => p.nSeat === winnerOrder[winnerOrder.length - 1]);
            // eslint-disable-next-line no-console
            if (!updatedWinner) {
                console.error('updatedWinner not found');
            }
            winner = updatedWinner ?? winner;
        }

        this.iWinnerId = winner.iUserId; // TODO it can be undefined
        if (winner.oMainStatistics.nRank == null) {
            winner.oMainStatistics.nRank = winner.oStatistics.nRank;
            winner.oMainStatistics.nPriority = winner.oStatistics.nPriority;
            winner.oMainStatistics.nScore = winner.oStatistics.nScore;
        }
        winner.oMainStatistics.nRank += winner.oStatistics.nRank;
        winner.oMainStatistics.nPriority += winner.oStatistics.nPriority;
        winner.oMainStatistics.nScore += winner.oStatistics.nScore;
        // load vip win percent once per declareResult
        const [settings, isVipTable] = await Promise.all([Settings.findOne({}).lean(), this.isVipTable()]);
        const vipWinPercent = settings?.nVipWinPercent || 0;
        for (const player of this.aPlayers) {
            if (!player.bIsDroppedPlayer) {
                const isWinner = _.isEqual(player.iUserId, winner.iUserId);
                let amountWon = 0;
                let baseWinAmount = 0;
                let vipExtraAmount = 0;
                let appliedVipWinPercent = 0;
                if (isWinner) {
                    baseWinAmount = this.nTableFee * this.aPlayers.filter((p) => !p.bIsDroppedPlayer).length;
                    amountWon += baseWinAmount;
                    // apply VIP extra on winning amount ONLY for VIP tables
                    if (isVipTable && player.eUserType === 'vip' && vipWinPercent > 0) {
                        appliedVipWinPercent = vipWinPercent;
                        vipExtraAmount = Math.round((baseWinAmount * vipWinPercent) / 100);
                        amountWon += vipExtraAmount;
                        log.info('VIP win bonus applied', {
                            tableId: this.iTableId,
                            iUserId: player.iUserId?.toString?.() || player.iUserId,
                            nVipWinPercent: vipWinPercent,
                            baseWinAmount,
                            vipExtraAmount,
                            finalWinAmount: baseWinAmount + vipExtraAmount,
                            round: this.nTableRound,
                        });
                        player.nBalance += baseWinAmount + vipExtraAmount;
                        player.nTotalCoins += baseWinAmount + vipExtraAmount;
                    } else {
                        player.nBalance += baseWinAmount;
                        player.nTotalCoins += baseWinAmount;
                    }
                    player.nPotValue += this.nTableFee * this.nMaxPlayer;

                    // Update reachScore, earnCoins, and winBig challenge progress when coins are earned
                    this.updateDailyChallengeProgress(player.iUserId, ['reachScore', 'earnCoins', 'winBig'], amountWon).catch((e) => {
                        log.error(`Failed to update reachScore, earnCoins, and winBig challenge for player ${player.iUserId}:`, e?.message);
                    });
                }
                if (!this.nTableRound) this.nTableRound = 0;
                const obj = {
                    nTableRound: this.nTableRound,
                    iUserId: player.iUserId,
                    aCards: player.aDeclaredHand,
                    nBalance: amountWon,
                    nWinAmountBase: baseWinAmount,
                    nVipWinPercent: appliedVipWinPercent,
                    nVipExtraAmount: vipExtraAmount,
                    nWinAmountTotal: amountWon,
                    bVipBonusApplied: vipExtraAmount > 0,
                    bIsRoundWinner: isWinner,
                };
                player.aWinnerData.push(obj);
            }
        }
        const { nRoundStartIn } = this.oSetting;
        this.nTablePot -= this.nTableFee * this.aPlayers.filter((p) => !p.bIsDroppedPlayer).length;
        this.emit('resDeclareWinner', { iWinnerId: this.iWinnerId, nTableRound: this.nTableRound, nBalance: Math.round(this.nTableFee * this.aPlayers.filter((p) => !p.bIsDroppedPlayer).length), ttl: nRoundStartIn, eState: 'declared' });
        this.setSchedular('turnTimer-assignRoundTime', null, nRoundStartIn, { nRoundStartIn, expiredAt: Date.now() + nRoundStartIn });
        await this.save();
        await _.delay(nRoundStartIn);
        if (this.nTableRound < this.nTotalRound - 1) await this.resetTable();
        else {
            // Match is completely finished - update playMatch and completeMatch challenges for all players
            const isPrivateTableWithFriends = this.sCode && this.aPlayers.filter((p) => !p.bIsDroppedPlayer).length >= 2;

            for (const player of this.aPlayers) {
                if (!player.bIsDroppedPlayer) {
                    const challengeTypes = ['playMatch', 'completeMatch'];
                    // Add playWithFriend challenge if it's a private table with 2+ players
                    if (isPrivateTableWithFriends) {
                        challengeTypes.push('playWithFriend');
                    }
                    this.updateDailyChallengeProgress(player.iUserId, challengeTypes, 1).catch((e) => {
                        log.error(`Failed to update daily challenges for player ${player.iUserId}:`, e?.message);
                    });
                }
            }
            this.declareWinner();
        }
    }

    /* final game winner */
    async declareWinner() {
        this.eState = 'finished';
        let roundWinner = [];
        let result = [];
        let finalWinner;
        let winnerBalance = 0;
        this.aPlayers.map((ap) => {
            result = ap.aWinnerData.filter((p) => p.bIsRoundWinner === true);
            if (result) {
                result.map((p) => roundWinner.push(p));
            }
            // ----------------------------------------
            if (this.bIsTournament) {
                finalWinner = ap;
                if (ap.oMainStatistics.nPriority < finalWinner.oMainStatistics.nPriority) finalWinner = ap;
                else if (ap.oMainStatistics.nPriority === finalWinner.oMainStatistics.nPriority) {
                    if (ap.oMainStatistics.nScore > finalWinner.oMainStatistics.nScore) finalWinner = ap;
                    else if (ap.oMainStatistics.nScore === finalWinner.oMainStatistics.nScore) {
                        if (ap.oMainStatistics.nRank < finalWinner.oMainStatistics.nRank) finalWinner = ap;
                    }
                }
                return null;
            }
            // ----------------------------------------
            if (!ap.bIsDroppedPlayer) {
                if (ap.nBalance > winnerBalance) {
                    winnerBalance = ap.nBalance;
                    finalWinner = ap;
                } else if (ap.nBalance !== 0 && ap.nBalance === winnerBalance) {
                    if (ap.oMainStatistics.nPriority < finalWinner.oMainStatistics.nPriority) finalWinner = ap;
                    else if (ap.oMainStatistics.nPriority === finalWinner.oMainStatistics.nPriority) {
                        if (ap.oMainStatistics.nScore > finalWinner.oMainStatistics.nScore) finalWinner = ap;
                        else if (ap.oMainStatistics.nScore === finalWinner.oMainStatistics.nScore) {
                            if (ap.oMainStatistics.nRank < finalWinner.oMainStatistics.nRank) finalWinner = ap;
                        }
                    }
                }
            }
            return null;
        });
        roundWinner = roundWinner.sort((a, b) => a.nTableRound - b.nTableRound);
        this.aRoundWinner = roundWinner;
        if (!finalWinner) {
            finalWinner = { aWinnerData: [] };
        }
        this.oFinalWinner = finalWinner.aWinnerData;
        await this.save({ oFinalWinner: this.oFinalWinner, aRoundWinner: this.aRoundWinner, eState: this.eState });
        const { nPopUpTimer } = this.oSetting;
        this.emit('resWinnerData', { roundWinnerData: this.aRoundWinner, winner: this.oFinalWinner, eState: this.eState, ttl: nPopUpTimer, nPopUpTimer: 0, nTotalTurnTime: nPopUpTimer });
        await this.setStatistics(finalWinner.iUserId);

        // Update winMatch, reachScore, and winBig challenge progress for the winner (only for non-tournament games)
        if (finalWinner && finalWinner.iUserId && !this.bIsTournament) {
            // Update winMatch and reachScore challenges
            this.updateDailyChallengeProgress(finalWinner.iUserId, ['winMatch', 'reachScore'], 1).catch((e) => {
                log.error(`Failed to update winMatch challenge for winner ${finalWinner.iUserId}:`, e?.message);
            });

            // Update winBig challenge with winner's balance (amount won)
            // winBig: Win a match with reward >= target coins
            if (finalWinner.nBalance > 0) {
                this.updateDailyChallengeProgress(finalWinner.iUserId, ['winBig'], finalWinner.nBalance).catch((e) => {
                    log.error(`Failed to update winBig challenge for winner ${finalWinner.iUserId}:`, e?.message);
                });
            }
        } else if (finalWinner && finalWinner.iUserId && this.bIsTournament) {
            // For tournament games, only update winMatch and reachScore (winBig is handled in tournament module)
            this.updateDailyChallengeProgress(finalWinner.iUserId, ['winMatch', 'reachScore'], 1).catch((e) => {
                log.error(`Failed to update winMatch challenge for winner ${finalWinner.iUserId}:`, e?.message);
            });
        }

        this.updateCoins();
        await this.generateTableHistory();
    }

    /*
    1. store data structure for different scenarios
    2.
    */
    async generateTableHistory() {
        try {
            console.log('generateTableHistory called', _.getTableKey(this._id));
            const [data, table] = await Promise.all([
                redis.hgetallAsync(_.getTableKey(this._id)),
                Table.findOne({ _id: this.iTableId }).lean(), //
            ]);
            if (!data) {
                console.log('data not found in redis', _.getTableKey(this._id));
            }
            const { iTableId, iDealerId, iWinnerId, eState, eGameType, iTournamentId, oSetting } = data;
            let { nTablePot, nTotalRound, nTableRound, nMaxPlayer, nTableFee, bIsTournament } = data;

            nTablePot = parseInt(nTablePot, 10);
            nTotalRound = parseInt(nTotalRound, 10);
            nTableRound = parseInt(nTableRound, 10);
            nMaxPlayer = parseInt(nMaxPlayer, 10);
            nTableFee = parseInt(nTableFee, 10);
            bIsTournament = bIsTournament === 'true';

            console.log('bIsTournament, iTournamentId', bIsTournament, iTournamentId);
            let players = [];
            for (const keys of Object.keys(data)) {
                if (keys.startsWith('aPlayers:')) {
                    players.push(_.parse(data[keys]));
                }
            }

            players.forEach((p) => {
                const roundData = p.aWinnerData?.find((x) => x.nTableRound === nTableRound);
                if (roundData) return;
                p.aWinnerData.push({
                    nTableRound,
                    iUserId: p.iUserId,
                    aCards: p.aDeclaredHand,
                    nBalance: 0,
                    nWinAmountBase: 0,
                    nVipWinPercent: 0,
                    nVipExtraAmount: 0,
                    nWinAmountTotal: 0,
                    bVipBonusApplied: false,
                    bIsRoundWinner: !p.bIsDroppedPlayer,
                });
            });

            players = players.map((player) => ({
                iUserId: mongodb.mongify(player.iUserId) || '', // mongify
                sUserName: player.sUserName || '',
                sEmail: player.sEmail || '',
                eUserType: player.eUserType || '',
                bIsVipUser: player.eUserType === 'vip',
                nTotalCoins: player.nTotalCoins || 0,
                eBadges: player.eBadges || '',
                nTurnCount: player.nTurnCount || 0,
                nBalance: player.nBalance || 0,
                nPotValue: player.nPotValue || 0,
                nSeat: player.nSeat || 0,
                bIsDroppedPlayer: player.bIsDroppedPlayer || false,
                aWinnerData: player.aWinnerData || [],
            }));

            const __players = players.map((x) => {
                const { aWinnerData, ...rest } = x;
                let nScore = 0;
                aWinnerData.forEach((rnd) => {
                    if (rnd?.aCards?.length) {
                        const Sewali = new SewaliHand(rnd.aCards);
                        let oStatistics = { nScore: 0, nRank: 3, nPriority: 8 };
                        try {
                            oStatistics = Sewali.validate();
                        } catch (e) {
                            /**/
                        }
                        nScore += Math.max(calculateCombinedScore(oStatistics), 0);
                    }
                });

                if (this.eState === 'quadwinner' && this.iWinnerId?.toString() === x.iUserId?.toString()) {
                    rest.nRoundWon = this.nTotalRound;
                } else {
                    rest.nRoundWon = aWinnerData.filter((w) => w.bIsRoundWinner).length || 0;
                }
                rest.nTotalScore = nScore;
                return rest;
            });

            const _players = __players.map((x) => {
                if (this.eState === 'quadwinner') {
                    if (this.iWinnerId?.toString() === x.iUserId?.toString()) x.nRoundWon = this.nTotalRound;
                    else x.nRoundWon = 0;
                    return x;
                }
                return x;
            });

            const aRoundInfo = [];

            for (let i = 0; i < nTotalRound; i += 1) {
                const round = { nTableRound: i, aDeclaredHand: [] };
                for (const player of players) {
                    round.aDeclaredHand.push(
                        player.aWinnerData
                            .map((x) => {
                                const Sewali = new SewaliHand(x.aCards);
                                let oStatistics = { nScore: 0, nRank: 3, nPriority: 8 };
                                try {
                                    oStatistics = Sewali.validate();
                                } catch (e) {
                                    /**/
                                }
                                return {
                                    nTableRound: x.nTableRound,
                                    iUserId: mongodb.mongify(x.iUserId), // mongify
                                    aCards: x.aCards || [],
                                    oStatistics,
                                    nScore: Math.max(calculateCombinedScore(oStatistics), 0),
                                    nBalance: x.nBalance,
                                    nWinAmountBase: x.nWinAmountBase || 0,
                                    nVipWinPercent: x.nVipWinPercent || 0,
                                    nVipExtraAmount: x.nVipExtraAmount || 0,
                                    nWinAmountTotal: x.nWinAmountTotal || x.nBalance || 0,
                                    bVipBonusApplied: !!x.bVipBonusApplied,
                                    bIsRoundWinner: x.bIsRoundWinner,
                                };
                            })
                            .shift()
                    );
                    player.aWinnerData.shift(); // just to sync with round bcz shift on prev dont work bcz of map
                }
                aRoundInfo.push(round);
            }

            // sort by {nRoundWon: -1, nTotalScore: -1}
            const uList = _players
                ?.map((p) => ({
                    iUserId: p?.iUserId,
                    nTotalScore: p?.nTotalScore,
                    nRoundWon: p?.nRoundWon,
                }))
                ?.sort((a, b) => {
                    if (a.nRoundWon === b.nRoundWon) {
                        return b.nTotalScore - a.nTotalScore;
                    }
                    return b.nRoundWon - a.nRoundWon;
                });

            const history = {
                _id: mongodb.mongify(this._id), // actual table id
                iTableId: mongodb.mongify(iTableId), // proto
                iDealerId: mongodb.mongify(iDealerId),
                iWinnerId: uList[0]?.iUserId || mongodb.mongify(iWinnerId),
                nTablePot: typeof nTablePot === 'string' ? parseInt(nTablePot, 10) : nTablePot,
                nTotalRound: typeof nTotalRound === 'string' ? parseInt(nTotalRound, 10) : nTotalRound,
                nTableRound: typeof nTableRound === 'string' ? parseInt(nTableRound, 10) : nTableRound,
                nMaxPlayer: typeof nMaxPlayer === 'string' ? parseInt(nMaxPlayer, 10) : nMaxPlayer,
                nTableFee: typeof nTableFee === 'string' ? parseInt(nTableFee, 10) : nTableFee,
                eState,
                eGameType,
                oSetting: JSON.parse(oSetting || '{}'),
                oTable: table || {},
                aPlayer: _players,
                aRoundInfo: aRoundInfo || [],
                bIsTournament: typeof bIsTournament === 'string' ? bIsTournament === 'true' : bIsTournament,
                iTournamentId: iTournamentId && mongodb.isValidObjectId(iTournamentId) ? mongodb.mongify(iTournamentId) : undefined,
            };
            history.nTablePot = history.nTotalRound * history.nTableFee * history.nMaxPlayer;

            const previousHistory = await TableHistory.findOne({ _id: history._id }).lean();
            if (previousHistory) {
                console.warn('previousHistory exists for iTableID', previousHistory.iTableId, previousHistory);
                const res = await TableHistory.updateOne({ _id: history._id }, { $set: history });
                log.green('TableHistory updated', res);
            } else {
                log.yellow('before TableHistory created');
                await TableHistory.create(history);
            }
            // console.log('TableHistory created', history);

            if (history.iWinnerId && history.aPlayer?.length && !history.bIsTournament) {
                const winnerId = history.iWinnerId?.toString?.() || history.iWinnerId;
                const playerIds = (history.aPlayer || []).map((p) => (p.iUserId?.toString && p.iUserId.toString()) || p.iUserId).filter(Boolean);

                // Compute match duration if we have a tracked start time.
                const startedAtMs = Number(data?.nGameStartedAt);
                const gameDurationMs = Number.isFinite(startedAtMs) ? Math.max(Date.now() - startedAtMs, 0) : null;

                fairPlay.afterMatchEnd(winnerId, playerIds, history._id?.toString?.() || this._id, gameDurationMs).catch((e) => log.error('FairPlay afterMatchEnd failed', e?.message));
            }

            //
            if (history.bIsTournament && iTournamentId) {
                const tournament = await Tournament.findOne({ _id: history.iTournamentId });
                if (!tournament) return log.red('[generateTableHistory] Tournament not found', history.iTournamentId);
                const playingPlayer = tournament.aUsers.filter((p) => p.eStatus === 'playing');
                playingPlayer.eStatus = 'waiting';
                // if round ends
                // tournament.eStatus = 'matchMaking';
                // prettier-ignore
                tournament.save(_.errorCallback);
                emitter.emit('endRound', { iTournamentId: history.iTournamentId, iTableId: history._id });
            } else {
                history.aPlayer.forEach((p) => {
                    User.updateOne({ _id: mongodb.mongify(p.iUserId.toString()) }, { $set: { iLastTournamentId: null } }).then(
                        () => { },
                        () => { }
                    );
                });
            }
        } catch (err) {
            console.error(`error in generateTableHistory`, err);
        } finally {
            try {
                const { nPopUpTimer } = this.oSetting;
                this.setSchedular('resetGameTimer', null, nPopUpTimer, { nPopUpTimer, expiredAt: Date.now() + nPopUpTimer });
            } catch (e) {
                console.error(`error in generateTableHistory. Failed to schedule resetGameTimer ${e?.message}`);
            }
        }
    }

    async resetGame() {
        this.deleteScheduler('resetGameTimer');
        // New match will set this again in distributeCard().
        this.nGameStartedAt = null;
        for (const player of this.aPlayers) {
            player.reset();
            if (player.bIsDroppedPlayer) player.eState = 'left';
        }
        this.aDeck = getPureDeck(1);
        this.nTablePot = this.nTableFee * this.nMaxPlayer * this.nTotalRound;
        this.nTableRound = '0';
        this.aRoundWinner = [];
        this.iUserTurn = undefined;
        this.iDealerId = undefined;
        this.bIsCardGrabbed = false;
        this.bIsReshuffled = false;
        await this.save();
        this.updateTable({ $set: { eState: this.eState, nTableRound: this.nTableRound } });
        this.aPlayers.map(async (p) => {
            const _player = await User.findOneAndUpdate({ _id: p.iUserId }, { nTotalCoins: p.nTotalCoins - this.nTableFee * this.nTotalRound }, { new: true });
            p.nTotalCoins = _player.nTotalCoins;
            globalThis.io.to(_player.sRootSocket).emit('resUpdateCoins', { nTotalCoins: parseInt(_player.nTotalCoins, 10) });
            await this.save({ aPlayers: [p.toJSON()], eState: this.eState });
            // DB store
            await this.updateTable({
                $inc: { nCoinsIn: this.nTableFee * this.nTotalRound },
                $push: {
                    aPlayers: p.iUserId,
                },
            });
            p.emit('resGameState', {
                ...p.gameState,
                player: { ...p.gameState.player, nTotalCoins: parseInt(p.gameState.player.nTotalCoins, 10) },
                aPlayers: p?.gameState?.aPlayers?.map((pl) => {
                    pl.nTotalCoins = parseInt(pl.nTotalCoins, 10);
                    return pl;
                }),
            });
            return null;
        });
        this.initializeGame();
    }

    async startRound() {
        this.deleteScheduler('turnTimer-assignSetHandTime');
        const { nMaxWaitingTime } = this.oSetting;
        this.state = 'declaring';
        this.setSchedular('turnTimer-assignSkippedTime', null, nMaxWaitingTime, { nMaxWaitingTime, expiredAt: Date.now() + nMaxWaitingTime });
        this.emit('resRoundStartsIn', { ttl: nMaxWaitingTime, initialValue: 0, nTotalTurnTime: nMaxWaitingTime });
        this.save({ eState: this.eState, aPlayers: this.aPlayers.map((p) => p.toJSON()) });
        await _.delay(nMaxWaitingTime);
    }

    // on end of every round
    async resetTable() {
        for (const player of this.aPlayers) {
            player.resetRound();
        }
        this.nTableRound += 1;
        // this.aPlayers.map((p) => p.emit('resGameState', p.gameState));
        this.aPlayers.map((p) =>
            p.emit('resGameState', {
                ...p.gameState,
                player: { ...p.gameState.player, nTotalCoins: parseInt(p.gameState.player.nTotalCoins, 10) },
                aPlayers: p?.gameState?.aPlayers?.map((pl) => {
                    pl.nTotalCoins = parseInt(pl.nTotalCoins, 10);
                    return pl;
                }),
            })
        );
        this.emit('resRoundNo', { nTableRound: this.nTableRound });
        await this.save();
        this.restartGame(true);
    }

    restartGame(isReStart) {
        let player;
        if (isReStart) {
            if (this.iWinnerId) player = this.aPlayers.find((p) => _.isEqual(p.iUserId, this.iWinnerId));
            player.takeTurn();
        } else {
            player = this.aPlayers.find((p) => _.isEqual(p.iUserId, this.iDealerId));
            const turnPlayer = this.getNextPlayer(player.nSeat);
            turnPlayer.takeTurn();
        }
    }
}

module.exports = SewaliTable;
