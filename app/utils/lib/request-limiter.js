const redis = require('./redis');

const operation = {};

operation.setLimit = async (params, callback = () => {}) => {
    const body = _.pick(params, ['path', 'remoteAddress', 'maxRequestTime']);
    const key = `${body.remoteAddress}:${body.path}`;
    const isExist = await redis.getAsync(key);
    if (isExist) return callback('Too many request');
    await redis.setAsync(key, Date.now());
    await redis.expireAsync(key, (body.maxRequestTime || 1000) / 1000);
    return callback();
};

module.exports = operation;
