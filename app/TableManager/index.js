const { redis, mongodb, deck } = require('../utils');
const { SewaliTable, SewaliPrivateTable, TimelyBonus, SpinBonus } = require('../models');
const Sewali = require('./Table/SewaliTable');

function TableManager() {
    this.defaultTableSettings = {
        nBeginCountdown: 60000, // wait for other players to join // setTimeOut
        nGrabTimer: 5000, // just used for animation. auto grab logic disabled
        nInitialTimer: 94000, // time to arrange cards def: 94s
        nMaxWaitingTime: 3000, // time before round start when all player clicked ready button
        nTurnTime: 90000, // 90s
        nRoundStartIn: 6000,
        nPopUpTimer: 15000,
        nSplitAmountTimer: 2000,
        nLeaveTimer: 60000, // 60s:  to leave table on disconnect if not rejoined in 60s
    };
    // this.defaultTableSettings = {
    //     nBeginCountdown: 60000, // wait for other players to join
    //     nGrabTimer: 5000,
    //     nInitialTimer: 4000, // time to arrange cards def: 94s
    //     nMaxWaitingTime: 3000,
    //     nTurnTime: 5000, // 90s
    //     nRoundStartIn: 6000,
    //     nPopUpTimer: 15000,
    //     nSplitAmountTimer: 2000,
    //     nLeaveTimer: 6000,
    // };
    this.oTableClasses = {};

    emitter.on('reqSchedule', this.schedular.bind(this));
    emitter.on('resetTable', this.schedular.bind(this, 'resetTable'));
    emitter.on('resetGameTimer', this.schedular.bind(this, 'resetGameTimer'));
    emitter.on('resLeaveTimer', this.schedular.bind(this, 'resLeaveTimer'));
    emitter.on('resLeaveTable', this.schedular.bind(this, 'resLeaveTable'));

    emitter.on('turnTimer-assignRoundTime', this.schedular.bind(this, 'assignRoundTime'));
    emitter.on('turnTimer-assignTurnTime', this.schedular.bind(this, 'assignTurnTime'));
    emitter.on('turnTimer-grabTimer', this.schedular.bind(this, 'grabTimer'));
    emitter.on('turnTimer-assignSetHandTime', this.schedular.bind(this, 'assignSetHandTime')); // nInitialTimer // used for card arrange timer
    emitter.on('turnTimer-assignSkippedTime', this.schedular.bind(this, 'assignSkippedTime')); // nMaxWaitingTime // used when all player clicked on ready button to skip setHandTimer
    //
    emitter.on('timelyBonus', ({ iUserId, iBonusId }) => {
        TimelyBonus.updateOne({ _id: iBonusId, iUserId }, { $set: { eStatus: 'unclaimed' } }).catch((err) => log.red('error on timelyBonus update from redis', err));
    });
    emitter.on('spinBonus', ({ iUserId, iBonusId }) => {
        SpinBonus.updateOne({ _id: iBonusId, iUserId }, { $set: { eStatus: 'unclaimed' } }).catch((err) => log.red('error on spinBonus update from redis', err));
    });
}

TableManager.prototype.schedular = function (sTaskName, message) {
    const [iTableId, iUserId] = message.split('-');
    this.scheduleTask(sTaskName, iTableId, iUserId);
};

TableManager.prototype.createTable = async function (tableData, bIsTournament = false, iTournamentId = undefined) {
    const tableDetails = {
        _id: mongodb.mongify(),
        iTableId: tableData._id,
        sName: tableData.sName,
        nTableFee: tableData.nTableFee,
        nTotalCoins: parseInt(tableData.nTotalCoins, 10),
        eGameType: tableData.eGameType,
        nMaxPlayer: tableData.nMaxPlayer,
        aDeck: deck.getPureDeck(1),
        aPlayers: [],
    };
    const sewaliTable = new SewaliTable(tableDetails);
    if (!bIsTournament) sewaliTable.save(_.errorCallback);
    const nRound = tableData.nMaxPlayer === 3 ? 5 : 4;
    const sewaliClass = this.generateClass({
        ...tableDetails,
        oSetting: this.defaultTableSettings,
        iUserTurn: undefined,
        iDealerId: undefined,
        nTableRound: 0,
        nTotalRound: nRound,
        nTablePot: parseInt(tableData.nTableFee * nRound * tableData.nMaxPlayer, 10),
        bIsTournament,
        iTournamentId,
    });
    await sewaliClass.save();
    return sewaliClass;
};

// create PrivateTable in mongo, and store privateTable class in redis hash
TableManager.prototype.createPrivateTable = async function (tableData) {
    const tableDetails = {
        _id: mongodb.mongify(),
        iTableId: tableData._id,
        sName: tableData.sName,
        sCode: _.shortid(6), // TODO : remove collision that may occur due to less digits
        nTableFee: parseInt(tableData.nTableFee, 10),
        eGameType: tableData.eGameType,
        nMaxPlayer: tableData.nMaxPlayer,
        aDeck: deck.getPureDeck(1),
        aPlayers: [],
        __proto: tableData,
    };
    // IMPORTANT: await the Mongo save, otherwise immediate reads in the same request
    // (e.g. joinPrivateTable -> findOne) can intermittently return null.
    await new SewaliPrivateTable(tableDetails).save();
    const nRound = tableData.nMaxPlayer === 3 ? 5 : 4;
    const sewaliClass = await this.generateClass({
        ...tableDetails,
        oSetting: this.defaultTableSettings,
        iUserTurn: undefined,
        iDealerId: undefined,
        nTableRound: 0,
        nTotalRound: nRound,
        nTablePot: tableData.nTableFee * nRound * tableData.nMaxPlayer,
    });
    await sewaliClass.save();
    return sewaliClass;
};

/**
 * @typedef {Object} AddPlayerParams
 * @property {string} iTableId
 * @property {Object} protoData
 * @property {Object} userData
 */

/**
 * It fetch table from redis and then calls table.addPlayer() to add curr player to the table , if not found then create new table and add player to it
 * @param {AddPlayerParams} params
 * @param {Function} callback
 * @returns {Promise<void>}
 */
TableManager.prototype.addPlayer = async function (params, callback = () => { }) {
    try {
        // log.cyan(`${_.now()}::TableManager.prototype.addPlayer():: redLock acquiring a lock on key ${_.genLockKey(params.iTableId, 'TBL')}`);
        const redLock = await globalThis.Lock.acquire([_.genLockKey(params.iTableId, 'TBL')], _.REDLOCK_TTL_MS); // ms
        // log.green(`${_.now()}::TableManager.prototype.addPlayer():: redLock acquired a lock on key ${_.genLockKey(params.iTableId, 'TBL')}`);
        let table = await this.getTable(params.iTableId);
        if (!table) {
            params.protoData._id = params.iTableId;
            const newTable = await this.createTable(params.protoData);
            if (!newTable) return this.logError('newTable not found');
            table = await this.getTable(newTable._id);
            if (!table) return this.logError('table not found!!', callback);
        }

        table.addPlayer(params.userData, async (error, response) => {
            // log.cyan(`${_.now()}::TableManager.prototype.addPlayer():: redLock releasing a lock on key ${_.genLockKey(params.iTableId, 'TBL')}`);
            if (redLock && redLock.expiration > Date.now()) {
                await redLock.release();
                // log.green(`${_.now()}::TableManager.prototype.addPlayer():: redLock released a lock on key ${_.genLockKey(params.iTableId, 'TBL')}`);
            } else log.red(`${_.now()}::TableManager.prototype.addPlayer():: redLock unable to release lock from key ${_.genLockKey(params.iTableId, 'TBL')}. auto released`);
            //
            if (error) return callback(error);
            return callback(null, response);
        });
    } catch (err) {
        console.log('addPlayer error:', err);
        log.red(`${_.now()}::TableManager.prototype.addPlayer():: failed`, err.message);
    }
};

TableManager.prototype.addPrivatePlayer = async function (params, callback = () => { }) {
    let table = await this.getTable(params.iTableId);
    if (!table) {
        params.protoData._id = params.iTableId;
        const newTable = await this.createPrivateTable(params.protoData);
        if (!newTable) return this.logError('newTable not found');
        table = await this.getTable(newTable._id);
        if (!table) return this.logError('table not found!!', callback);
    }

    table.addPrivatePlayer(params.userData, (error, response) => {
        if (error) return callback(error);
        return callback(null, response); // response: { sCode: this.sCode, iTableId: this._id }
    });
};

/** @returns {Promise<Sewali>} */
TableManager.prototype.getTable = async function (iTableId) {
    if (!iTableId) return null;
    const table = await redis.hgetallAsync(_.getTableKey(iTableId));
    if (!table) return null;

    // const jsonKey = ['aDeck', 'oSetting', 'aRoundWinner', 'oFinalWinner'];
    const jsonKey = ['aDeck', 'oSetting', 'aWinnerData', 'aRoundWinner', 'oFinalWinner'];
    const floatKey = ['nTableFee', 'nTotalCoins', 'nTurnTime', 'nSeat', 'nTurnTime', 'nTableRound', 'nMaxPlayer', 'nTotalRound', 'nBalance', 'nTablePot'];
    const object = {};
    for (const [key, value] of Object.entries(table)) {
        if (jsonKey.includes(key) && !_.isNullOrUndefined(value)) object[key] = _.parse(value);
        else if (floatKey.includes(key) && !_.isNullOrUndefined(value)) object[key] = parseFloat(value);
        else if (key.includes('aPlayers') && !_.isNullOrUndefined(value)) {
            object.aPlayers = object.aPlayers || [];
            object.aPlayers.push(_.parse(value));
        } else if (!_.isNullOrUndefined(value)) object[key] = value;
    }
    if (object.aPlayers) object.aPlayers.sort((a, b) => a.nSeat - b.nSeat);
    return table._id in this.oTableClasses ? this.oTableClasses[table._id].update(object) : this.generateClass(object);
};

TableManager.prototype.getPrivateTable = async function (iTableId) {
    if (!iTableId) return null;
    const table = await redis.hgetallAsync(_.getTableKey(iTableId));
    if (!table) return null;

    // const jsonKey = ['aDeck', 'oSetting', 'aRoundWinner', 'oFinalWinner'];
    const jsonKey = ['aDeck', 'oSetting', 'aWinnerData', 'aRoundWinner', 'oFinalWinner'];
    const floatKey = ['nTableFee', 'nTotalCoins', 'nTurnTime', 'nSeat', 'nTurnTime', 'nTableRound', 'nMaxPlayer', 'nTotalRound', 'nBalance', 'nTablePot'];
    const object = {};
    for (const [key, value] of Object.entries(table)) {
        if (jsonKey.includes(key) && value) object[key] = _.parse(value);
        else if (floatKey.includes(key) && value) object[key] = parseFloat(value);
        else if (key.includes('aPlayers')) {
            object.aPlayers = object.aPlayers || [];
            object.aPlayers.push(_.parse(value));
        } else if (value) object[key] = value;
    }
    if (object.aPlayers) object.aPlayers.sort((a, b) => a.nSeat - b.nSeat);
    return table._id in this.oTableClasses ? this.oTableClasses[table._id].update(object) : this.generateClass(object);
};

TableManager.prototype.searchEmptyTable = async function (oProtoData, iUserId, callback = () => { }) {
    const aggregate = [
        {
            $match: {
                iTableId: oProtoData._id,
                // aPlayers: { $ne: iUserId },
                bIsTournament: { $ne: true },
                $expr: { $lt: [{ $size: '$aPlayers' }, '$nMaxPlayer'] },
            },
        },
        {
            $project: {
                eGameType: 1,
                nTableFee: 1,
                nMaxPlayer: 1,
            },
        },
    ];
    SewaliTable.aggregate(aggregate, async (error, [data]) => {
        if (error) return callback(error);
        if (!data) return callback();
        return callback(null, data);
    });
};

TableManager.prototype.generateClass = function (oTableData) {
    let table = null;
    switch (oTableData.eGameType) {
        case 'sewali':
            table = new Sewali(oTableData);
            break;
        case 'charwali':
            table = new Sewali(oTableData);
            break;
        default:
            return null;
    }
    if (table) this.oTableClasses[table._id] = table;
    return table;
};

TableManager.prototype.scheduleTask = async function (sTaskName, iTableId, iUserId) {
    const table = await this.getTable(iTableId);
    if (!table) return false;

    const player = iUserId ? table.getPlayer(iUserId) : undefined;

    log.magenta(_.now(), 'TIMER TRIGGERED! sTaskName: ', sTaskName, 'iTableId: ', iTableId, 'iUserId: ', iUserId);

    switch (sTaskName) {
        case 'distributeCard':
            table.distributeCard();
            break;
        case 'assignTurnTime':
            if (!player) return log.red(sTaskName, ' => ', message.not_found('player').message);
            player.assignTurnTime();
            break;
        case 'assignSetHandTime':
            // - arrange card timer expired
            table.startTurn();
            break;
        case 'grabTimer':
            table.forceGrabCard();
            break;
        case 'resetTable':
            table.resetTable();
            break;
        /* this remove all game data at round end */
        case 'resetGameTimer':
            table.aPlayers.forEach((p) => (p.bIsDroppedPlayer = true));
            table.deleteGame(null, false);
            // table.deleteGame(null, table.bIsTournament);
            break;
        case 'assignRoundTime':
            break;
        case 'assignSkippedTime':
            // - all player clicked on ready button and the timer before game start got expired
            table.startTurn();
            break;
        case 'resLeaveTable':
            if (!player) return log.red(sTaskName, ' => ', message.not_found('player').message);
            player.leave();
            break;
        default:
            log.red('case did not matched', sTaskName);
            break;
    }
};

TableManager.prototype.logError = function (error, callback = () => { }) {
    log.trace(error);
    callback(error);
};

module.exports = new TableManager();
