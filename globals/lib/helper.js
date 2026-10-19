/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-console */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const axios = require('axios');
const dayjs = require('dayjs');
const https = require('https');
const http = require('http');
const queryString = require('querystring');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const _ = {};

const config = {
    BASE_URL: process.env.BASE_URL,
    VERIFICATION_CODE_LENGTH: process.env.VERIFICATION_CODE_LENGTH,
    JWT_SECRET: process.env.JWT_SECRET,
};

_.parse = function (data) {
    try {
        return JSON.parse(data);
    } catch (error) {
        return data;
    }
};

_.stringify = function (data, offset = 0) {
    return JSON.stringify(data, null, offset);
};

_.clone = function (data = {}) {
    const originalData = data.toObject ? data.toObject() : data; // for mongodb result operations
    const eType = originalData ? originalData.constructor : 'normal';
    if (eType === Object) return { ...originalData };
    if (eType === Array) return [...originalData];
    return data;
    // return JSON.parse(JSON.stringify(data));
};

_.deepClone = function (data) {
    const originalData = !!data.toObject || !!data._doc ? data._doc : data;
    if (originalData.constructor === Object) return this.cloneObject(originalData);
    if (originalData.constructor === Array) return this.cloneArray(originalData);
    return originalData;
};

_.cloneObject = function (object) {
    const newData = {};
    const keys = Object.keys(object);
    for (let i = 0; i < keys.length; i += 1) {
        const eType = object[keys[i]] ? object[keys[i]].constructor : 'normal';
        switch (eType) {
            case 'normal':
                newData[keys[i]] = object[keys[i]];
                break;
            case Array:
                newData[keys[i]] = this.cloneArray(object[keys[i]]);
                break;
            case Object:
                newData[keys[i]] = this.cloneObject(object[keys[i]]);
                break;
            default:
                newData[keys[i]] = object[keys[i]];
                break;
        }
    }
    return newData;
};

_.cloneArray = function (array) {
    const newData = [];
    for (let i = 0; i < array.length; i += 1) {
        const eType = array[i] ? array[i].constructor : 'normal';
        switch (eType) {
            case 'normal':
                newData.push(array[i]);
                break;
            case Array:
                newData.push(this.cloneArray(array[i]));
                break;
            case Object:
                newData.push(this.cloneObject(array[i]));
                break;
            default:
                newData.push(array[i]);
                break;
        }
    }
    return newData;
};

_.pick = function (obj, array) {
    const clonedObj = this.clone(obj);
    return array.reduce((acc, elem) => {
        if (elem in clonedObj) acc[elem] = clonedObj[elem];
        return acc;
    }, {});
};

_.omit = function (obj, array, deepCloning = false) {
    const clonedObject = deepCloning ? this.deepClone(obj) : this.clone(obj);
    const objectKeys = Object.keys(clonedObject);
    return objectKeys.reduce((acc, elem) => {
        if (!array.includes(elem)) acc[elem] = clonedObject[elem];
        return acc;
    }, {});
};

_.isEmptyObject = function (obj = {}) {
    return !Object.keys(obj).length;
};

_.isEqual = function (id1, id2) {
    return (id1 ? id1.toString() : id1) === (id2 ? id2.toString() : id2);
};

_.searchRegex = function (search) {
    if (!search) {
        return '';
    }
    return search.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/\*/g, '\\*').replace(/\+/g, '\\+').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\)/g, '\\)').replace(/\(/g, '\\(').replace(/'/g, "\\'").replace(/"/g, '\\"');
};

_.formattedDate = function () {
    return new Date().toLocaleString('en-us', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: 'numeric' });
};

_.isoTimeString = function () {
    const today = new Date();
    return today;
};

_.getDate = function (_date = undefined) {
    const date = _date ? new Date(_date) : new Date();
    date.setHours(0, 0, 0, 0);
    const timeOffset = date.getTimezoneOffset() === 0 ? 19800000 : 0;
    // return new Date(date.toLocaleString('en-us', { day: 'numeric', month: 'short', year: 'numeric' }));
    return new Date(date - timeOffset);
};

_.addDays = function (date, days) {
    const inputDate = new Date(date);
    return new Date(inputDate.setDate(inputDate.getDate() + days));
};

_.addMonth = function (date, month) {
    const inputDate = new Date(date);
    return new Date(inputDate.setMonth(inputDate.getMonth() + month));
};

_.addMilliseconds = function (date, milliseconds) {
    const inputDate = new Date(date);
    return new Date(inputDate.valueOf() + milliseconds);
};

_.formatedDate = function () {
    return new Date().toLocaleString('en-us', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
    });
};
_.calculateTimeDifference = function (timestamp) {
    // Get current time in milliseconds
    const now = Date.now();

    // Calculate the difference
    const diffInMs = now - timestamp;

    // Calculate days, hours, minutes, and seconds
    const diffInSeconds = Math.floor(diffInMs / 1000);
    const days = Math.floor(diffInSeconds / 86400);
    const hours = Math.floor((diffInSeconds % 86400) / 3600);
    const minutes = Math.floor(((diffInSeconds % 86400) % 3600) / 60);
    const seconds = diffInSeconds % 60;

    return { days, hours, minutes, seconds };
};

_.Date = {
    isValidDate: (d) => dayjs(d).isValid(),
    getDateWithTimezone: () => dayjs().tz(process.env.TZ).startOf('day'),
    formatTimezoneDate: (date, format = 'YYYY-MM-DD HH:mm:ss') => (date ? dayjs(date).tz(process.env.TZ).format(format) : _.Date.getDateWithTimezone().format(format)),
};

_.encryptPassword = function (password) {
    return crypto.createHmac('sha256', config.JWT_SECRET).update(password).digest('hex');
};

_.getRandomChallenges = function (array, num) {
    return array.sort(() => Math.random() - 0.5).slice(0, num);
};
_.salt = function (length, type) {
    // if (process.env.NODE_ENV !== 'prod') return 1234;
    if (type === 'string') {
        return crypto
            .randomBytes(Math.ceil(length / 2))
            .toString('hex')
            .slice(0, length);
    }

    let min = 1;
    let max = 9;
    for (let i = 1; i < length; i += 1) {
        min += '0';
        max += '9';
    }
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

_.shortid = function (len = 9) {
    return nanoid(len);
};

_.sortByKey = function name(array, key) {
    return _.clone(array).sort((a, b) => a[key] - b[key]);
};

_.randomCode = function (size) {
    // const code = Math.random().toString(32);
    const code = Date.now().toString(36);
    return code.slice(code.length - size);
};

_.encodeToken = function (body, expTime) {
    try {
        return expTime ? jwt.sign(this.clone(body), config.JWT_SECRET || process.env.JWT_SECRET, expTime) : jwt.sign(this.clone(body), config.JWT_SECRET || process.env.JWT_SECRET);
    } catch (error) {
        return undefined;
    }
};

_.decodeToken = function (token) {
    try {
        return jwt.decode(token, config.JWT_SECRET);
    } catch (error) {
        return undefined;
    }
};

_.verifyToken = function (token) {
    try {
        return jwt.verify(token, config.JWT_SECRET, function (err, decoded) {
            return err ? err.message : decoded; // return true if token expired
        });
    } catch (error) {
        return error ? error.message : error;
    }
};

_.isOtpValid = function (createdAt) {
    const difference = new Date() - createdAt;
    return difference < process.env.OTP_VALIDITY;
};

_.axios = function (option, callback = () => {}) {
    return axios(option)
        .then((response) => callback(null, _.parse(response.data)))
        .catch((error) => callback(error.message));
};

_.isEmail = function (email) {
    const regeX = /[a-z0-9._%+-]+@[a-z0-9-]+[.]+[a-z]{2,5}$/;
    return !regeX.test(email);
};

_.isUserName = function (name) {
    const regeX = /^[a-zA-Z ]+$/;
    return !regeX.test(name);
};

_.isPassword = function (password) {
    const regeX = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).{8,15}$/;
    return !regeX.test(password);
};

/**
 * Shuffles (randomizes) the elements in an array.
 *
 * @template T
 * @param {T[]} array - The input array to be shuffled.
 * @returns {T[]} - The shuffled array.
 */
_.randomizeArray = function (array = []) {
    const arrayLength = array.length;
    for (let i = 0; i < arrayLength; i += 1) {
        let randomNumber = Math.floor(Math.random() * arrayLength);
        [array[i], array[randomNumber]] = [array[randomNumber], array[i]];
        randomNumber = Math.floor(Math.random() * arrayLength);
        [array[i], array[randomNumber]] = [array[randomNumber], array[i]];
    }
    return array;
};

_.randomizeAlphaNumericString = function (length, size) {
    let result = '';
    const output = new Set();
    const characters = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789'; // used 0-9 twice to reduce generating only chars string
    const charactersLength = characters.length;
    for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < length; i += 1) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        output.add(result);
        result = '';
    }
    return [...output];
};

_.request = function (body, options, callback) {
    const httpRequest = options.isSecure ? https : http;
    delete options.isSecure;
    const req = httpRequest.request(options, function (res) {
        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', (error) => callback(error));
        res.on('end', () => callback(null, _.parse(Buffer.concat(chunks))));
    });

    const requetsBody = options.headers['Content-Type'] === 'application/x-www-form-urlencoded' ? queryString.stringify(body) : _.stringify(body);
    req.write(requetsBody);
    req.end();
};

/** @param {number} min
 * @param {number} max
 */
_.randomBetween = function (min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

_.randomFromArray = function (array) {
    return array[Math.floor(Math.random() * array.length)];
};

_.appendZero = (number) => (number < 10 ? '0' : '') + number;

_.delay = (ttl) => new Promise((resolve) => setTimeout(resolve, ttl));

_.roundDownToMultiple = function (number, multiple) {
    return number - (number % multiple);
};

_.emptyCallback = (error, response) => {};

_.errorCallback = (error, response) => {
    if (error) console.error(error);
};

/**
 * Ensure VIP user is still VIP based on dVipExpiresAt.
 * If VIP expired, downgrade user.eUserType to 'user' in DB and in-memory.
 * Returns a Promise that resolves to the (possibly updated) user object.
 */
_.checkAndDowngradeVip = async function (user) {
    try {
        if (!user) return user;
        if (user.eUserType !== 'vip') return user;
        if (user.dVipExpiresAt && new Date(user.dVipExpiresAt) > new Date()) return user;

        // downgrade in DB only if still vip
        /* eslint-disable global-require */
        const { User } = require('../../app/models');
        /* eslint-enable global-require */
        await User.updateOne({ _id: user._id, eUserType: 'vip' }, { $set: { eUserType: 'user' } });
        // reflect change in returned object
        user.eUserType = 'user';
        return user;
    } catch (error) {
        // On error, return original user (don't block flow)
        return user;
    }
};

_.getUserKey = (iUserId) => `aPlayers:${iUserId}`; //  player->aPlayers

_.getTableKey = (iTableId) => `${iTableId}:tbl`;

_.getUserSocketKey = (iUserId) => `sck:${iUserId}`;

_.getTablePlayerCountKey = (id) => `${id}:counter`;

_.getTimelyBonusKey = (iUserId, iBonusId, host = process.env.HOST) => `t_bon:${iUserId}:${iBonusId}:${host}`;
_.getSpinBonusKey = (iUserId, iBonusId, host = process.env.HOST) => `s_bon:${iUserId}:${iBonusId}:${host}`;

_.getTournamentKey = (sTask, iTournamentId = '', iTableId = '', iUserId = '', host = process.env.HOST) => `tr:${iTournamentId}:scheduler:${sTask}:${iTableId}:${iUserId}:${host}`; // tr:iTournamentId:scheduler:sTask:iTableId:iUserId:host
_.getTournamentLeaderBoardKey = (iTournamentId = '') => `trlb:${iTournamentId}`;

_.getSchedulerKey = (sTask, iTableId = '', iUserId = '', host = process.env.HOST) => `${iTableId}:scheduler:${sTask}:${iUserId}:${host}`;

_.reAssignGroup = (aGroupedCard) => {
    const obj = {};
    const res = [];
    for (const card of aGroupedCard) {
        // eslint-disable-next-line no-unused-expressions
        obj[`${card.nGroupId}`] ? obj[`${card.nGroupId}`].push(card) : (obj[`${card.nGroupId}`] = [card]);
    }
    let counter = 0;
    for (const aCards of Object.values(obj)) {
        // eslint-disable-next-line no-loop-func
        aCards.forEach((card) => (card.nGroupId = counter));
        counter += 1;
    }
    for (const aCards of Object.values(obj)) res.push(...aCards);

    return { nGroupAlreadyMade: Object.keys(obj).length, aOldGroup: res };
};

_.base64ToBuffer = function (base64) {
    const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const contentType = base64.split(';')[0].split('/')[1];
    return { buffer, contentType };
};

_.base64UrlDecodeToJson = function (part) {
    if (!part || typeof part !== 'string') return null;
    try {
        const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
        const str = Buffer.from(padded, 'base64').toString('utf8');
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
};

_.decodeJwtPayload = function (token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    return _.base64UrlDecodeToJson(parts[1]);
};

_.privateEmit = async function (iUserId, sEventName, data) {
    try {
        // First, try to get socket ID from Redis
        let socketId = await globalThis.redis?.getAsync(_.getUserSocketKey(iUserId));

        // If not found in Redis, fallback to database
        if (!socketId) {
            /* eslint-disable */
            const { User } = require('../../app/models');
            const { mongodb } = require('../../app/utils');
            /* eslint-enable */
            const user = await User.findOne({ _id: mongodb.mongify(iUserId) }, { sRootSocket: 1 }).lean();

            if (user && user.sRootSocket) {
                socketId = user.sRootSocket;
                // Update Redis with the socket ID from database (refresh TTL)
                if (globalThis.redis) {
                    globalThis.redis.setEx(_.getUserSocketKey(iUserId), globalThis.PING_INTERVAL, socketId).catch((err) => {
                        if (err) log.error(`failed to update user(${iUserId}) socketId from DB fallback`, err);
                    });
                }
            }
        }

        if (!socketId) {
            log.red(`active socketId not found for user ${iUserId} (Redis expired, DB fallback also failed). Message saved in DB, will be delivered on reconnect.`);
            return;
        }

        log.blue(`iUserId: ${iUserId}, sEventName: ${sEventName}, data: ${JSON.stringify(data)}`);
        globalThis.io.to(socketId).emit(sEventName, JSON.stringify(data));
    } catch (error) {
        log.error(`Error in privateEmit for user ${iUserId}:`, error);
        // Message is already saved in DB, so it's okay if emit fails
    }
};
// _.privateEmit('615291893fc60176ca658d0f', 'resUpdateCoins', { nTotalCoins: 1 })

/**
 * a utility function to log and calls the cb passed.
 * It can be used in place where we throw some error and just do logging in catch block
 */
_.abort = (msg, cb = () => {}) => {
    log.red(msg);
    cb(msg, {}); // cb(error, data)
};
_.isNullOrUndefined = (value) => value === null || value === undefined;

_.genLockKey = (id = '', flag = '') => `LK:${flag}:${id}`;
_.REDLOCK_TTL_MS = 3000;

_.now = () => {
    const date = new Date();
    //
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = String(date.getFullYear()).slice(-2);
    //
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    //
    return `${dd}/${mm}/${yy} ${hh}:${min}:${ss}:${ms}`;
};

_.ISODate = () => {
    const date = new Date();
    return date.toISOString();
};

_.groupBy = (array, keyGetter) => {
    const map = new Map();
    array.forEach((item) => {
        const key = keyGetter(item);
        const collection = map.get(key);
        if (!collection) {
            map.set(key, [item]);
        } else {
            collection.push(item);
        }
    });
    return map;
};

_.getClubRoleLabel = function (eRole, eLocale = 'en') {
    if (!eRole) return eRole;
    const locale = eLocale || 'en';
    if (locale !== 'hi') return eRole;

    const phrase = `club_roles.${eRole}`;
    const translated = globalThis.i18n?.__ ? globalThis.i18n.__({ phrase, locale }) : undefined;
    if (!translated || translated === phrase) return eRole;
    return translated;
};

/* Example usage
const people = [
    { id: 1, name: 'Alice', age: 25 },
    { id: 2, name: 'Bob', age: 30 },
    { id: 3, name: 'Charlie', age: 25 },
];

const groupedByAge = _.groupBy(people, (p) => p.age);
*/
module.exports = _;
