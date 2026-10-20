const Player = require('./player');
const { redis } = require('../../utils');
const { User } = require('../../models');
const fairPlay = require('../../FairPlay');

const Socket = function () {};

Socket.prototype.init = function () {
    globalThis.io.origins('*:*');
    globalThis.io.adapter(redis.getAdapter());
    this.setEventListeners();
};

Socket.prototype.setEventListeners = function () {
    globalThis.io.use((socket, next) => this.middleware(socket, next));
    globalThis.io.on('connection', (socket) => new Player(socket));
    globalThis.io.on('error', log.red);
};

Socket.prototype.middleware = async function (socket, next) {
    const { Authorization, deviceId, sDeviceId } = socket.handshake.query || {};
    const devId = deviceId || sDeviceId || null;
    const ip = socket.handshake.address || socket.conn?.remoteAddress || null;

    if (devId && (await fairPlay.isDeviceBanned(devId))) {
        const errMsg = (typeof message.noLocale === 'function' && message.noLocale('This device is not allowed to access the game.', 403)?.message) || 'This device is not allowed to access the game.';
        return next(new Error(errMsg));
    }

    if (!Authorization) return next(new Error(message.unauthorized()));
    const decodedToken = _.decodeToken(Authorization);
    if (!decodedToken) return next(new Error(message.unauthorized()));

    const query = { _id: decodedToken._id };
    const project = {
        bIsEmailVerified: 1,
        sRootSocket: 1,
        sToken: 1,
        nTotalCoins: 1,
        sUserName: 1,
        eStatus: 1,
        eFlagLevel: 1,
        dRestrictedUntil: 1,
    };
    const update = {
        $set: { sRootSocket: socket.id },
    };

    User.findOne(query, project, (err, data) => {
        if (err) return next(new Error(message.server_error()));
        if (!data) return next(new Error(message.unauthorized().message));
        if (data.bIsEmailVerified === false) return next(new Error(message.not_verified('Email')));
      

        const allowed = fairPlay.isUserAllowedToPlay(data);
        if (!allowed.allowed) {
            let msg = 'Your account is not allowed to play.';
            if (allowed.reason === 'temp_restriction') {
                const sec = fairPlay.getTempRestrictionSecondsRemaining(data);
                msg =
                    sec != null
                        ? globalThis.i18n.__({ phrase: 'account_temp_restriction_fairplay', locale: 'en' }, { seconds: sec })
                        : globalThis.i18n.__({ phrase: 'account_temp_restriction_fairplay_no_timer', locale: 'en' });
            }
            return next(new Error((typeof message.noLocale === 'function' && message.noLocale(msg, 403)?.message) || msg));
        }
        if (data.eStatus === 'n') return next(new Error(message.user_blocked()));
        if (data.eStatus === 'd') return next(new Error(message.user_deleted()));
        socket.user = { iUserId: data._id };
        User.updateOne(query, update, _.errorCallback);
        log.blue(`${_.now()}: user: ${data.sUserName} connected with iUserId: ${socket.user.iUserId}: sSocketId: ${socket.id} `);
        next();
    });
};

module.exports = new Socket();
