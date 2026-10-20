/* eslint-disable prettier/prettier */
const { redis, mongodb } = require('../../utils');

const tableManager = require('../../TableManager');
const tournamentManager = require('../../TournamentManager');
const fairPlay = require('../../FairPlay');
const { Tournament, TournamentUser, User, Settings, Message, Friends, ClubMember, ClubChat } = require('../../models');


function PlayerListener(iTableId, iUserId, socket) {
    this.iTableId = iTableId;
    this.iUserId = iUserId;
    this.socket = socket;
}

PlayerListener.prototype.onEvent = function ({ sEventName, oData }, callback = () => { }) {
    if (['dev', 'stag'].includes(process.env.NODE_ENV) && !['reqSyncHand', 'reqDeclareCard'].includes(sEventName)) log.cyan('PlayerListener.onEvent', `(${this.iUserId})`, 'sEventName', sEventName, 'oData', _.stringify(oData));
    redis.setEx(_.getUserSocketKey(this.iUserId), globalThis.PING_INTERVAL, this.socket.id).catch((err) => {
        if (err) log.error(`failed to update user(${this.iUserId}) socketId`, err);
    });
    switch (sEventName) {
        case 'reqLeave':
            this.leaveTable(oData, callback);
            break;
        case 'reqSyncHand':
            this.syncHand(oData, callback);
            break;
        case 'reqDeclareCard':
            this.declaredCards(oData, callback);
            break;
        case 'reqRoundStart':
            this.roundStart(oData, callback);
            break;
        case 'reqReshuffleGame':
            this.reshuffleGame(oData, callback);
            break;
        case 'reqDiscardCard':
            this.discardCards(oData, callback);
            break;
        case 'reqResetGame':
            this.resetGame(oData, callback);
            break;
        case 'reqCheckQuad':
            this.checkQuad(oData, callback);
            break;
        case 'reqGroupChat':
            this.groupChat(oData, callback);
            break;
        case 'reqCardSwitch':
            this.reqCardSwitch(oData, callback);
            break;
        case 'reqPrivateChat':
            this.privateChat(oData, callback);
            break;
        case 'reqSendEmoji':
            this.sendEmoji(oData, callback);
            break;
        case 'reqSendGift':
            this.sendGift(oData, callback);
            break;
        case 'reqSendCoin':
            this.reqSendCoin(oData, callback);
            break;
        case 'reqCustomText':
            // unknown
            this.customText(oData, callback);
            break;
        case 'reqUpdateAgoraId':
            this.updateAgoraId(oData, callback);
            break;
        case 'reqMicStatus':
            this.micStatus(oData, callback);
            break;
        case 'reqMuteUser':
            this.muteUser(oData, callback);
            break;
        case 'reqTipToDealer':
            this.tipToDealer(oData, callback);
            break;
        default:
            log.red('unknown event', sEventName);
            break;
    }
};

PlayerListener.prototype.reqCardSwitch = async function (body, callback = () => { }) {
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);
    callback(null, {});
    table.emit('resCardSwitch', { iUserId: this.iUserId });
};

PlayerListener.prototype.privateChat = async function (body, callback = () => { }) {
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(globalThis.message.not_found('table'), callback);

    const { iReceiverId, message } = body;
    const player = table.getPlayer(iReceiverId);

    player.emit('resPrivateChat', { iReceiverId, message: globalThis.filter.clean(message), iSenderId: this.iUserId });
    callback(null);
};

PlayerListener.prototype.reqSendCoin = async function (body, callback = () => { }) {
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);

    player.sendCoin(body, (error) => {
        if (error) return this.logError(error, callback);
        callback(null, player.aHand);
    });
};

PlayerListener.prototype.sendEmoji = async function (body = {}, callback = () => { }) {
    log.green('sendEmoji called', body); // { "emoji": 0, "iReceiverId": "614d8da73514438d8b0f40ac" }
    if (!body.emoji) body.emoji = 0;
    body.emoji = parseInt(body.emoji, 10) || 0;
    if (!body.iReceiverId) return this.logError(message.required_field('iReceiverId'), callback);

    if (!this.iUserId) return this.logError(message.not_found('user'), callback);
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const [user, setting] = await Promise.all([
        User.findOne({ _id: mongodb.mongify(this.iUserId) }, { _id: 1, sName: 1, nTotalCoins: 1, eLocale: 1 }),
        Settings.findOne({}, { _id: 0, aEmojiCost: 1 }).lean(), //
    ]);
    if (!user) return this.logError(message.not_found('user'), callback);
    if (!setting) return this.logError(message.not_found('setting'), callback);
    if (Number.isNaN(setting.aEmojiCost[body.emoji])) return this.logError(message.not_found('emoji'), callback);
    const cost = setting.aEmojiCost.find((c) => c.nEmojiId === body.emoji)?.nCost || 0;
    if (user.nTotalCoins < cost) return callback(message.insufficient_balance('', user.eLocale || 'en'));
    user.nTotalCoins -= cost;
    await user.save();

    // Update spendCoins daily challenge when sending emoji
    if (cost > 0 && table.updateDailyChallengeProgress) {
        table.updateDailyChallengeProgress(this.iUserId, ['spendCoins'], cost).catch((e) => {
            log.error(`Failed to update spendCoins challenge for player ${this.iUserId} in sendEmoji:`, e?.message);
        });
    }

    _.privateEmit(this.iUserId, 'resUpdateCoins', { nTotalCoins: parseInt(user.nTotalCoins, 10) });
    table.emit('resSendEmoji', { ...body, iSenderId: this.iUserId });
    callback(null);
};

PlayerListener.prototype.sendGift = async function (body = {}, callback = () => { }) {
    log.green('sendGift called', body); // { "gift": 0, "iReceiverId": "614d8da73514438d8b0f40ac" }
    if (!body.gift) body.gift = 0;
    body.gift = parseInt(body.gift, 10) || 0;
    if (!body.iReceiverId) return this.logError(message.required_field('iReceiverId'), callback);
    console.log('llll')
    if (!this.iUserId) return this.logError(message.not_found('user'), callback);
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const [user, setting] = await Promise.all([
        User.findOne({ _id: mongodb.mongify(this.iUserId) }, { _id: 1, sName: 1, nTotalCoins: 1, eLocale: 1 }),
        Settings.findOne({}, { _id: 0, aGiftCost: 1 }).lean(),
    ]);
    console.log('user:::', user);
    console.log('setting:::', setting);
    if (!user) return this.logError(message.not_found('user'), callback);
    if (!setting) return this.logError(message.not_found('setting'), callback);
    if (!setting.aGiftCost || !Array.isArray(setting.aGiftCost)) return this.logError(message.not_found('gift setting'), callback);
    const cost = setting.aGiftCost.find((c) => c.nGiftId === body.gift)?.nCost || 0;
    if (!cost) return this.logError(message.not_found('gift'), callback);
    if (user.nTotalCoins < cost) return callback(message.insufficient_balance('', user.eLocale || 'en'));
    user.nTotalCoins -= cost;
    await user.save();

    // Update spendCoins daily challenge when sending gift
    if (cost > 0 && table.updateDailyChallengeProgress) {
        table.updateDailyChallengeProgress(this.iUserId, ['spendCoins'], cost).catch((e) => {
            log.error(`Failed to update spendCoins challenge for player ${this.iUserId} in sendGift:`, e?.message);
        });
    }

    _.privateEmit(this.iUserId, 'resUpdateCoins', { nTotalCoins: parseInt(user.nTotalCoins, 10) });
    table.emit('resSendGift', { ...body, iSenderId: this.iUserId });
    callback(null);
};

PlayerListener.prototype.leaveTable = async function (body, callback = () => { }) {
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);

    player.leave(body, (error, response) => {
        if (error) return this.logError(error, callback);
        return callback(null, response);
    });
};

PlayerListener.prototype.syncHand = async function (body = [], callback = () => { }) {
    /**
     * [{iCardId, nGroupId}]
     */
    if (body.length > 17) return this.logError(message.invalid_hand_length(''), callback);
    const redLock = await globalThis.Lock.acquire([_.genLockKey(this.iTableId, 'TBL:SYNC')], _.REDLOCK_TTL_MS);
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);

    player.syncHand(body, async (error) => {
        if (redLock && redLock.expiration > Date.now()) {
            await redLock.release();
        } else log.red(`${_.now()}::syncHand(${this.iUserId}):: redLock unable to release lock from key ${_.genLockKey(this.iTableId, 'TBL:SYNC')}. auto released`);
        if (error) return this.logError(error, callback);
        callback(null, player.aHand);
    });
};

PlayerListener.prototype.declaredCards = async function (body, callback = () => { }) {
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);

    player.declareCards(body, async (error) => {
        if (error) return this.logError(error, callback);
        callback(null, player.aHand);
    });
    await redis.rpushAsync(`${player.iTableId}:playingOrder`, player.nSeat);
    await redis.expireAsync(`${player.iTableId}:playingOrder`, 180);
};

/**  player clicks on ready button after arranging cards */
PlayerListener.prototype.roundStart = async function (body, callback = () => { }) {
    const redLock = await globalThis.Lock.acquire([_.genLockKey(this.iTableId, 'TBL:SYNC')], _.REDLOCK_TTL_MS);
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);

    await player.setRound();
    log.green(
        'READY_STAT',
        table.aPlayers.map((p) => ({ name: p.sUserName, ready: p.bIsReqNextRound }))
    );
    const bNeedToSkip = table.aPlayers.every((p) => p.bIsReqNextRound || p.bIsDroppedPlayer);

    const readyCount = table.aPlayers.filter((p) => p.bIsReqNextRound || p.bIsDroppedPlayer).length;
    log.green('readyCount: ', readyCount);

    if (redLock && redLock.expiration > Date.now()) {
        await redLock.release();
    } else log.red(`${_.now()}::roundStart(${this.iUserId}):: redLock unable to release lock from key ${_.genLockKey(this.iTableId, 'TBL:SYNC')}. auto released`);
    if (bNeedToSkip) table.startRound();
    callback(null, {});
};

PlayerListener.prototype.reshuffleGame = async function (body, callback = () => { }) {
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);

    player.reshuffle(body, async (error, response) => {
        if (error) return this.logError(error, callback);
        callback(null, response);
    });
};

PlayerListener.prototype.discardCards = async function (body, callback = () => { }) {
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);

    player.discard(body, async (error, response) => {
        if (error) return this.logError(error, callback);
        callback(null, response);
    });
};

PlayerListener.prototype.resetGame = async function (body, callback = () => { }) {
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);

    const tableRound = table.nMaxPlayer === 3 ? 5 : 4;
    if (player.nTotalCoins < table.nTableFee * tableRound) return this.logError(message.insufficient_balance(), callback);

    await player.setNextGame();

    if (table.aPlayers.every((p) => p.bIsReqNextGame === true)) {
        table.resetGame();
        callback(null, {});
    }
    callback(null, {});
};

PlayerListener.prototype.checkQuad = async function (body, callback = () => { }) {
    log.green('reqQuadWinner called');
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    if (['quadwinner', 'finished'].includes(table.eState)) callback(null, {});

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);
    table.quadChecking(player.iUserId);
    callback(null, {});
};

PlayerListener.prototype.groupChat = async function (body, callback = () => { }) {
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);
    table.emit('resGroupChat', { sMessage: globalThis.filter.clean(body.sMessage), oSender: this.iUserId });
    callback(null, {});
};

PlayerListener.prototype.customText = async function (body, callback = () => { }) {
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    table.emit('resCustomText', { ...body, iSenderId: this.iUserId });
    callback(null, {});
};

PlayerListener.prototype.updateAgoraId = async function (body, callback = () => { }) {
    const { sAgoraId } = body;
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);
    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);
    player.sAgoraId = sAgoraId;
    await table.save();
    callback(null, {});
    const response = table.toJSON()?.aPlayers?.map((p) => ({ iUserId: p?.iUserId, sAgoraId: p?.sAgoraId }));
    // log.yellow('resUpdateAgoraId', response);
    table.emit('resUpdateAgoraId', response || {});
};

/**
 * - __for self mute/unmute__
 * - it will call player.micSetting() which emit event`resMicStatus` to all players in table
 * - emit payload `{ iUserId: this.iUserId, bIsAudio: body.bIsAudio }`
 * @param {{bIsAudio: boolean}} body
 * @param {Function} callback
 * @returns
 */
PlayerListener.prototype.micStatus = async function (body, callback = () => { }) {
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);

    player.micSetting(body, async (error) => {
        if (error) return this.logError(error, callback);
        callback(null, player.aHand);
    });
};

/**
 * - to mute/unmute a user
 * - update player muted user list
 * @param {{iUserId: string, bIsMuted: boolean}} body
 * @param {Function} callback
 * @returns
 */
PlayerListener.prototype.muteUser = async function (body, callback = () => { }) {
    const { iUserId, bIsMuted } = body;
    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);

    player.aMutedUser = bIsMuted ? [...new Set([...player.aMutedUser, iUserId])] : player.aMutedUser.filter((id) => id.toString() !== iUserId);
    await table.save();
    callback(null, {});
};

/**
 * - to give tip to the dealer
 * @param {{nAmount: string | number}} body
 * @param {Function} callback
 */
PlayerListener.prototype.tipToDealer = async function (body, callback = () => { }) {
    const redLock = await globalThis.Lock.acquire([_.genLockKey(this.iUserId, 'USR:UPD')], _.REDLOCK_TTL_MS);
    const nAmount = Number(body?.nAmount);
    if (!body || !body.nAmount < 0) body.nAmount = 0;

    if (!nAmount) callback(message.required_field('nAmount'));

    const table = await tableManager.getTable(this.iTableId);
    if (!table) return this.logError(message.not_found('table'), callback);

    const player = table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);

    await player.tipToDealer({ nAmount }, callback);
    if (redLock && redLock.expiration > Date.now()) {
        await redLock.release();
    } else log.red(`${_.now()}::tipToDealer(${this.iUserId}):: redLock unable to release lock from key ${_.genLockKey(this.iUserId, 'USR:UPD')}. auto released`);
};

// customText
PlayerListener.prototype.logError = function (error, callback = () => { }) {
    // eslint-disable-next-line no-console
    return callback(error);
};

function Player(socket) {
    this.socket = socket;
    this.iUserId = socket.user.iUserId;
    this.iTableId = undefined;
    this.iTournamentId = undefined;
    this.setEventListeners();
    // in sec:: 900. in min:: 15
    redis.setEx(_.getUserSocketKey(this.iUserId), globalThis.PING_INTERVAL, this.socket.id).catch((err) => {
        if (err) log.error(`failed to update user(${this.iUserId}) socketId`, err);
    });
}

Player.prototype.setEventListeners = function () {
    this.socket.on('ping', this.ping.bind(this));
    this.socket.on('reqJoinTable', this.joinTable.bind(this));
    this.socket.on('reqJoinPrivateTable', this.joinPrivateTable.bind(this));
    this.socket.on('reqJoinTournament', this.joinTournament.bind(this));
    this.socket.on('reqExitTournament', this.exitTournament.bind(this));
    this.socket.on('reqResultScreenClosed', this.resultScreenClosed.bind(this));
    this.socket.on('reqGetTournamentStatus', this.getTournamentStatus.bind(this));
    this.socket.on('reqSendMessage', this.sendMessage.bind(this));
    this.socket.on('reqMarkMessagesRead', this.markMessagesRead.bind(this));
    this.socket.on('reqFriendlist', this.reqFriendlist.bind(this));
    this.socket.on('reqInvite', this.reqInvite.bind(this));
    // Club: separate send message event (group)
    this.socket.on('reqClubSendMessage', this.reqClubSendMessage.bind(this));
    this.socket.on('disconnect', this.disconnect.bind(this));
    this.socket.on('error', (error) => log.red('socket error', error));
};

/** Fresh DB check: block table rejoin if FairPlay restriction applied after initial socket connect. */
Player.prototype.ensureFairPlayAllowedForTable = async function (callback = () => { }) {
    const userDoc = await User.findOne({ _id: mongodb.mongify(this.iUserId) }, { eStatus: 1, eFlagLevel: 1, dRestrictedUntil: 1, eLocale: 1 }).lean();
    if (!userDoc) {
        this.logError(message.not_found('user'), callback);
        return false;
    }
    const playAllowed = fairPlay.isUserAllowedToPlay(userDoc);
    if (playAllowed.allowed) return true;
    const locale = userDoc.eLocale || 'en';
    if (playAllowed.reason === 'temp_restriction') {
        const r = fairPlay.getAuthRestrictionReply(userDoc, locale, 403);
        if (r) {
            this.logError(r, callback);
            return false;
        }
        this.logError(message.account_temp_restriction_fairplay('', locale, undefined, 403), callback);
        return false;
    }
    if (playAllowed.reason === 'banned') {
        this.logError(message.user_blocked('', locale), callback);
        return false;
    }
    if (playAllowed.reason === 'deleted') {
        this.logError(message.user_deleted('', locale), callback);
        return false;
    }
    this.logError(message.noLocale('You are not allowed to play at this time.', 403), callback);
    return false;
};

Player.prototype.ping = function (body, callback = () => { }) {
    // console.log('ping called', this.iUserId, new Date().toLocaleString());
    callback(null, 'pong');
    redis.setEx(_.getUserSocketKey(this.iUserId), globalThis.PING_INTERVAL, this.socket.id).catch((err) => {
        if (err) log.error(`failed to update user(${this.iUserId}) socketId`, err);
    });
};

Player.prototype.joinTable = async function ({ iTableId }, callback = () => { }) {
    if (['dev', 'stag'].includes(process.env.NODE_ENV)) log.blue('reqJoinTable called', 'iTableId: ', iTableId, 'iUserId: ', this.iUserId); //
    if (!iTableId) return this.logError(message.required_field('iTableId'), callback);
    if (!(await this.ensureFairPlayAllowedForTable(callback))) return;
    const table = await tableManager.getTable(iTableId);
    if (!table) {
        return this.logError(message.not_found('table'), callback);
    }
    // if (['dev', 'stag'].includes(process.env.NODE_ENV)) log.blue('table', table); //
    if (table.eState === 'finished') {
        const ttl = await table.getSchedulerTTL('resetGameTimer');
        if (ttl <= 0) return this.logError(message.not_found('table'), callback);
    }
    table.deleteScheduler('resLeaveTable', this.iUserId);

    const player = table.getPlayer(this.iUserId);
    if (!player) {
        return this.logError(message.not_found('player'), callback);
    }
    // if (['dev', 'stag'].includes(process.env.NODE_ENV)) log.blue('table', player); //
    if (player.bIsDroppedPlayer) return this.logError(message.not_found('player'), callback);
    if (!this.socket.eventNames().includes(iTableId)) {
        const playerListener = new PlayerListener(iTableId, player.iUserId, this.socket);
        this.socket.on(iTableId, playerListener.onEvent.bind(playerListener));
    }

    player.sRootSocket = this.socket.id;
    player.bIsJoinEventCalled = true;
    this.iTableId = iTableId;
    // callback(null, { oData: player.gameState });

    // Enrich players with friend information
    const enrichedPlayers = await table.enrichPlayersWithFriendInfo(player.gameState.aPlayers || [], this.iUserId);
    const gameState = {
        ...player.gameState,
        nTotalCoins: parseInt(player.nTotalCoins, 10),
        player: { ...player.gameState.player, nTotalCoins: parseInt(player.gameState.player.nTotalCoins, 10) },
        aPlayers: enrichedPlayers.map((pl) => {
            pl.nTotalCoins = parseInt(pl.nTotalCoins, 10);
            return pl;
        }),
    };
    callback(null, {
        oData: gameState,
    });

    await table.save({ aPlayers: [player.toJSON()] });
    // table.emit('resUserJoined', player.toJSON());
    table.emit('resUserJoined', { ...player.toJSON(), nTotalCoins: parseInt(player.nTotalCoins, 10) });
    player.stateHandler();

    /* for tournament only */
    if (table.iTournamentId && !['finished', 'quadwinner'].includes(table.eState)) {
        await TournamentUser.updateOne({ iTournamentId: mongodb.mongify(table.iTournamentId), iUserId: mongodb.mongify(this.iUserId) }, { $set: { eStatus: 'playing' } });
    }
};

Player.prototype.joinPrivateTable = async function ({ iTableId }, callback = () => { }) {
    if (!iTableId) return this.logError(message.required_field('iTableId'), callback);
    if (!(await this.ensureFairPlayAllowedForTable(callback))) return;
    const table = await tableManager.getPrivateTable(iTableId);
    if (!table) return this.logError(message.invalid('sCode'), callback); // invalid iTableId or Table is Full

    const player = await table.getPlayer(this.iUserId);
    if (!player) return this.logError(message.not_found('player'), callback);
    if (player.bIsDroppedPlayer) return this.logError(message.not_found('player'), callback);
    if (!this.socket.eventNames().includes(iTableId)) {
        const playerListener = new PlayerListener(iTableId, player.iUserId);
        this.socket.on(iTableId, playerListener.onEvent.bind(playerListener));
    }

    player.sRootSocket = this.socket.id;
    this.iTableId = iTableId;
    // callback(null, { oData: player.gameState });

    // Enrich players with friend information
    const enrichedPlayers = await table.enrichPlayersWithFriendInfo(player.gameState.aPlayers || [], this.iUserId);

    callback(null, {
        oData: {
            ...player.gameState,
            player: { ...player.gameState.player, nTotalCoins: parseInt(player.gameState.player.nTotalCoins, 10) },
            aPlayers: enrichedPlayers.map((pl) => {
                pl.nTotalCoins = parseInt(pl.nTotalCoins, 10);
                return pl;
            }),
        },
    });

    await table.save({ aPlayers: [player.toJSON()] });
    // table.emit('resUserJoined', player.toJSON());
    table.emit('resUserJoined', { ...player.toJSON(), nTotalCoins: parseInt(player.nTotalCoins, 10) });
    player.stateHandler();
};

Player.prototype.joinTournament = async function ({ iTournamentId }, callback = () => { }) {
    if (!iTournamentId) return this.logError(message.required_field('iTournamentId'), callback);
    this.socket.iTournamentId = iTournamentId;
    await tournamentManager.joinTournament({ iTournamentId, iUserId: this.iUserId }, callback);
};

Player.prototype.exitTournament = async function (param = {}, callback = () => { }) {
    const user = await User.findOne({ _id: mongodb.mongify(this.iUserId) }, { _id: 1, iLastTournamentId: 1 }).lean();
    if (!user) return this.logError(message.not_found('user'), callback);
    if (user.iLastTournamentId) tournamentManager.leave({ iTournamentId: mongodb.mongify(user.iLastTournamentId), iUserId: user._id }, callback);
};

Player.prototype.resultScreenClosed = async function (param = {}, callback = () => { }) {
    // log.green('resultScreenClosed[socket]', param);
    const user = await User.findOne({ _id: mongodb.mongify(this.iUserId) }, { _id: 1, iLastTournamentId: 1 }).lean();
    if (!user) return this.logError(message.not_found('user'), callback);
    if (user?.iLastTournamentId) tournamentManager.resultScreenClosed({ iTournamentId: mongodb.mongify(user.iLastTournamentId), iUserId: user._id }, callback);
};

Player.prototype.getTournamentStatus = async function (param = {}, callback = () => { }) {
    log.cyan(_.now(), 'getTournamentStatus[socket]', param);
    const user = await User.findOne({ _id: mongodb.mongify(this.iUserId) }, { _id: 0, iLastTournamentId: 1 }).lean();
    if (!user) return callback('user not found!');
    if (!user?.iLastTournamentId) return callback('user not in tournament!');
    const tournament = await Tournament.findOne({ _id: user.iLastTournamentId }, { _id: 0, eStatus: 1 }).lean();
    if (!tournament) return callback('tournament not found!');
    callback(null, { iTournamentId: user.iLastTournamentId || '', eStatus: tournament.eStatus || '' });
};

// Send message (friend or club) via socket
Player.prototype.sendMessage = async function (body, callback = () => { }) {
    try {
        const { iReceiverId, sMessage } = body;
        console.log('sendMessage called', body);
        if (!iReceiverId) return callback(message.required_field('Receiver ID'));
        if (!sMessage || !sMessage.trim()) return callback(message.required_field('Message'));

        const iReceiverIdObj = mongodb.mongify(iReceiverId);

        // Check if users are friends
        const friendship = await Friends.findOne({
            $or: [
                { iUserId: mongodb.mongify(this.iUserId), iFriendId: iReceiverIdObj },
                { iUserId: iReceiverIdObj, iFriendId: mongodb.mongify(this.iUserId) },
            ],
        });
        if (!friendship) return callback(message.not_found('Friendship'));

        // Check if receiver exists and is active
        const receiver = await User.findOne({ _id: iReceiverIdObj, eStatus: 'y' }, { sUserName: 1, sAvatar: 1 }).lean();
        if (!receiver) return callback(message.not_found('Receiver'));

        // Get sender details
        const sender = await User.findOne({ _id: mongodb.mongify(this.iUserId) }, { sUserName: 1, sAvatar: 1 }).lean();
        if (!sender) return callback(message.not_found('Sender'));

        // Clean the message
        const cleanedMessage = globalThis.filter ? globalThis.filter.clean(sMessage.trim()) : sMessage.trim();

        // Create message
        const newMessage = await Message.create({
            iSenderId: mongodb.mongify(this.iUserId),
            iReceiverId: iReceiverIdObj,
            sMessage: cleanedMessage,
            eStatus: 'sent',
        });

        // Emit real-time message to receiver via socket
        await _.privateEmit(iReceiverIdObj.toString(), 'resNewMessage', {
            iMessageId: newMessage._id.toString(),
            iSenderId: this.iUserId.toString(),
            sSenderUserName: sender.sUserName,
            sMessage: cleanedMessage,
            dCreatedDate: newMessage.dCreatedDate,
        });

        // Send confirmation to sender
        return callback(null, {
            iMessageId: newMessage._id.toString(),
            iReceiverId: iReceiverIdObj.toString(),
            sMessage: cleanedMessage,
            eStatus: newMessage.eStatus,
            dCreatedDate: newMessage.dCreatedDate,
        });
    } catch (error) {
        log.error('sendMessage[socket] error:', error);
        callback(message.server_error());
    }
};

// Send club message via socket (separate event)
Player.prototype.reqClubSendMessage = async function (body = {}, callback = () => { }) {
    try {
        const { iClubId, sMessage } = body;
        if (!iClubId) return callback(message.required_field('Club ID'));
        if (!sMessage || !sMessage.trim()) return callback(message.required_field('Message'));

        const iClubIdObj = mongodb.mongify(iClubId);

        // Check if user is a member
        const membership = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: mongodb.mongify(this.iUserId),
            eStatus: 'active',
        }).lean();
        if (!membership) return callback(message.not_found('Club membership'));

        const trimmedMessage = sMessage.trim();
        if (globalThis.filter.isProfane(trimmedMessage)) return callback(message.inappropriate('Message'));

        // Save message
        const clubMsg = await ClubChat.create({
            iClubId: iClubIdObj,
            iSenderId: mongodb.mongify(this.iUserId),
            sMessage: trimmedMessage,
        });

        // sender info
        const sender = await User.findOne({ _id: mongodb.mongify(this.iUserId) }, { sUserName: 1, sAvatar: 1 }).lean();

        // Broadcast to active members (fallback using privateEmit)
        const members = await ClubMember.find({ iClubId: iClubIdObj, eStatus: 'active' }).select('iUserId').lean();
        const payload = {
            iMessageId: clubMsg._id.toString(),
            iClubId: iClubIdObj.toString(),
            iSenderId: this.iUserId.toString(),
            sSenderUserName: sender?.sUserName || '',
            sSenderAvatar: sender?.sAvatar || '',
            sMessage: trimmedMessage,
            dCreatedDate: clubMsg.dCreatedDate || new Date(),
        };
        await Promise.all(
            members
                .filter((m) => m.iUserId.toString() !== this.iUserId.toString())
                .map((m) => _.privateEmit(m.iUserId.toString(), 'resNewClubMessage', payload))
        );

        return callback(null, {
            iMessageId: clubMsg._id.toString(),
            iClubId: iClubIdObj.toString(),
            iSenderId: this.iUserId.toString(),
            sMessage: trimmedMessage,
            dCreatedDate: clubMsg.dCreatedDate || new Date(),
        });
    } catch (error) {
        log.error('reqClubSendMessage[socket] error:', error);
        return callback(message.server_error());
    }
};

// Mark messages as read via socket
Player.prototype.markMessagesRead = async function (body, callback = () => { }) {
    try {
        const { iFriendId } = body;

        if (!iFriendId) return callback(message.required_field('Friend ID'));

        const iFriendIdObj = mongodb.mongify(iFriendId);

        // Check if users are friends
        const friendship = await Friends.findOne({
            $or: [
                { iUserId: mongodb.mongify(this.iUserId), iFriendId: iFriendIdObj },
                { iUserId: iFriendIdObj, iFriendId: mongodb.mongify(this.iUserId) },
            ],
        });

        if (!friendship) return callback(message.not_found('Friendship'));

        // Mark all unread messages as read
        const result = await Message.updateMany(
            {
                iSenderId: iFriendIdObj,
                iReceiverId: mongodb.mongify(this.iUserId),
                eStatus: { $ne: 'read' },
            },
            { $set: { eStatus: 'read' } }
        );

        callback(null, { nUpdatedCount: result.modifiedCount });
    } catch (error) {
        log.error('markMessagesRead[socket] error:', error);
        callback(message.server_error());
    }
};

// Get friend list via socket
Player.prototype.reqFriendlist = async function (_body = {}, callback = () => { }) {
    try {
        // If user is already sitting in a table, we can mark friends who already joined the same table
        // so frontend can disable the "Invite/Challenge" button for them.
        const effectiveTableId = _body?.iTableId ? _body.iTableId : this.iTableId;
        let tablePlayerIdSet = null;
        if (effectiveTableId) {
            let table = await tableManager.getTable(effectiveTableId);
            if (!table) table = await tableManager.getPrivateTable(effectiveTableId);
            if (table && Array.isArray(table.aPlayers)) {
                const ids = table.aPlayers
                    .map((p) => (p && typeof p === 'object' ? p.iUserId : p))
                    .filter(Boolean)
                    .map((id) => id.toString());
                tablePlayerIdSet = new Set(ids);
            }
        }

        const query = [
            {
                $match: {
                    iUserId: mongodb.mongify(this.iUserId),
                },
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'iFriendId',
                    foreignField: '_id',
                    as: 'user',
                },
            },
            {
                $unwind: '$user',
            },
            {
                $project: {
                    _id: 0,
                    iUserId: '$iUserId',
                    iFriendId: '$iFriendId',
                    sUserName: '$user.sUserName',
                    nTotalCoins: '$user.nTotalCoins',
                    sAvatar: { $ifNull: ['$user.sAvatar', ''] },
                    ePlayerStatus: '$user.eStatus',
                    dCreatedDate: '$dCreatedDate',
                },
            },
            {
                $sort: { dCreatedDate: -1 },
            },
        ];

        const friends = await Friends.aggregate(query);
        const friendsWithInviteFlag = (friends || []).map((f) => {
            const friendIdStr = f?.iFriendId?.toString?.() || `${f?.iFriendId || ''}`;
            // isInvite = can invite (true) / already joined (false)
            const isInvite = tablePlayerIdSet ? !tablePlayerIdSet.has(friendIdStr) : true;
            return { ...f, isInvite };
        });
        callback(null, {
            friends: friendsWithInviteFlag,
            count: friendsWithInviteFlag.length || 0,
        });
    } catch (error) {
        log.error('reqFriendlist[socket] error:', error);
        callback(message.server_error());
    }
};

// Send invite to a friend via socket
Player.prototype.reqInvite = async function (body, callback = () => { }) {
    try {
        const { iFriendId, oInviteData } = body;

        if (!iFriendId) return callback(message.required_field('Friend ID'));

        const iFriendIdObj = mongodb.mongify(iFriendId);
        const iUserIdObj = mongodb.mongify(this.iUserId);

        // Check if users are friends
        const friendship = await Friends.findOne({
            $or: [
                { iUserId: iUserIdObj, iFriendId: iFriendIdObj },
                { iUserId: iFriendIdObj, iFriendId: iUserIdObj },
            ],
        });

        if (!friendship) return callback(message.not_found('Friendship'));

        // Get sender details
        const sender = await User.findOne({ _id: iUserIdObj }, { sUserName: 1, sAvatar: 1, nTotalCoins: 1, eBadges: 1 }).lean();
        if (!sender) return callback(message.not_found('Sender'));

        // Get receiver details to verify they exist
        const receiver = await User.findOne({ _id: iFriendIdObj, eStatus: 'y' }, { sUserName: 1, sAvatar: 1 }).lean();
        if (!receiver) return callback(message.not_found('Receiver'));

        // Get table information if user is in a table
        let tableInfo = null;
        let aPlayers = [];
        let sCode = null;
        const inviteType = 'table';
        let tableType = 'Public'; // Default

        if (this.iTableId) {
            // Try to get table (both normal and private)
            let table = await tableManager.getTable(this.iTableId);
            if (!table) {
                // If not found, try private table
                table = await tableManager.getPrivateTable(this.iTableId);
            }

            if (table) {
                // Check if table is private (has sCode)
                sCode = table.sCode || null;
                tableType = sCode ? 'private' : 'public';

                tableInfo = {
                    iTableId: table._id?.toString() || this.iTableId.toString(),
                    sName: table.sName || '',
                    nTableFee: parseInt(table.nTableFee || 0, 10),
                    nMaxPlayer: parseInt(table.nMaxPlayer || 0, 10),
                    eGameType: table.eGameType || '',
                    nCurrentPlayers: table.aPlayers?.length || 0,
                };

                // Get current players information
                if (table.aPlayers && table.aPlayers.length > 0) {
                    const playerIds = table.aPlayers.map((p) => p.iUserId || p).filter(Boolean);
                    const players = await User.find(
                        { _id: { $in: playerIds.map((id) => mongodb.mongify(id)) } },
                        { sUserName: 1, sAvatar: 1, eBadges: 1, nTotalCoins: 1 }
                    ).lean();

                    aPlayers = players.map((player) => ({
                        iUserId: player._id.toString(),
                        sUserName: player.sUserName || '',
                        sAvatar: player.sAvatar || '',
                        eBadges: player.eBadges || 'beginner',
                        nTotalCoins: parseInt(player.nTotalCoins || 0, 10),
                    }));
                }
            }
        }

        // Prepare invite data with table and user information
        const inviteDataPayload = {
            iSenderId: this.iUserId.toString(),
            sSenderUserName: sender.sUserName || '',
            sSenderAvatar: sender.sAvatar || '',
            iReceiverId: iFriendIdObj.toString(),
            type: inviteType,
            sType: tableType,
            oInviteData: {
                ...(oInviteData || {}),
                // Table information
                ...(tableInfo ? {
                    iTableId: tableInfo.iTableId,
                    sName: tableInfo.sName,
                    nTableFee: tableInfo.nTableFee,
                    nMaxPlayer: tableInfo.nMaxPlayer,
                    eGameType: tableInfo.eGameType,
                    nCurrentPlayers: tableInfo.nCurrentPlayers,
                    // Include sCode if table is private
                    ...(sCode ? { sCode } : {}),
                } : {}),
                // Sender user information
                oSender: {
                    iUserId: this.iUserId.toString(),
                    sUserName: sender.sUserName || '',
                    sAvatar: sender.sAvatar || '',
                    nTotalCoins: parseInt(sender.nTotalCoins || 0, 10),
                    eBadges: sender.eBadges || 'beginner',
                },
                // Current players in table
                aPlayers,
            },
            dCreatedDate: new Date(),
        };

        // Send invite via private emit to the friend (if they're connected)
        await _.privateEmit(iFriendIdObj.toString(), 'resInviteReceived', inviteDataPayload);

        // Send confirmation to sender
        callback(null, {
            iReceiverId: iFriendIdObj.toString(),
            sReceiverUserName: receiver.sUserName,
            oInviteData: inviteDataPayload.oInviteData,
            type: inviteType,
            tableType,
            bSent: true,
        });
    } catch (error) {
        log.error('reqInvite[socket] error:', error);
        callback(message.server_error());
    }
};

Player.prototype.disconnect = async function (reason) {
    try {
        redis.deleteAsync(_.getUserSocketKey(this.iUserId)).catch((err) => {
            if (err) log.error(`failed to delete user(${this.iUserId}) socketId on disconnect`, err);
        });
        /* update aUsers.eStatus = 'inactive' where aUsers.iUserId = this.iUserId */
        // if (this.socket.iTournamentId) {
        //     await Tournament.updateOne({ _id: mongify(this.socket.iTournamentId), 'aUsers.iUserId': mongify(this.iUserId) }, { $set: { 'aUsers.$.eStatus': 'inactive' } });
        //     emitter.emit('broadCastLeaderBoard', { iTournamentId: this.socket.iTournamentId });
        // }
        User.findOne({ _id: mongodb.mongify(this.iUserId) }, async (err, user) => {
            // if (process.env.NODE_ENV !== 'prod')
            log.red(`${_.now()}:: `, 'Root disconnected', user._id || this.iUserId, user.sUserName, 'with ', this.socket.id, 'reason: ', reason);
            if (err) return log.error(`Error while finding user on disconnect [iUserId: ${this.iUserId}]`, err?.message);
            if (user.iLastTournamentId) {
                const tournament = await Tournament.findOne({ _id: mongodb.mongify(user.iLastTournamentId) }, { _id: 1, eStatus: 1 }).lean();
                if (!['completed'].includes(tournament?.eStatus)) await TournamentUser.updateOne({ iTournamentId: mongodb.mongify(user.iLastTournamentId), iUserId: mongodb.mongify(this.iUserId), eStatus: { $nin: ['removed', 'left'] } }, { $set: { eStatus: 'disconnected' } });
                emitter.emit('broadCastLeaderBoard', { iTournamentId: user.iLastTournamentId });
                if (['canceled', 'completed'].includes(tournament?.eStatus)) user.iLastTournamentId = null;
                user.save(_.errorCallback);
            }
        });

        // if (process.env.NODE_ENV !== 'prod') log.red('Root disconnected', this.iUserId, 'with ', this.socket.id);
        if (!this.iTableId) return;
        const table = await tableManager.getTable(this.iTableId);
        // if (!table) return this.logError(message.not_found('table'));
        if (!table) return;

        const player = await table.getPlayer(this.iUserId);
        // if (!player) return this.logError(message.not_found('player'));
        if (!player) return;

        const { nLeaveTimer } = table.oSetting;
        table.setSchedular('resLeaveTable', this.iUserId, nLeaveTimer, { nLeaveTimer, expiredAt: Date.now() + nLeaveTimer });
    } catch (err) {
        if (process.env.NODE_ENV !== 'prod') {
            log.red('Some error Occur at player disconnection');
            log.red(`reason: ${err.message}`);
        }
    }
};

Player.prototype.logError = function (error, callback = () => { }) {
    log.trace(error);
    callback(error);
};

module.exports = Player;
