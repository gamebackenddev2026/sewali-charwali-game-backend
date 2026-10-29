const redis = require('redis');
const ioRedis = require('socket.io-redis');
const { promisify } = require('util');

function RedisClient() {
    this.options = {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
    };
    if (['dev', 'stag', 'prod'].includes(process.env.NODE_ENV)) {
        this.options.no_ready_check = true;
        // Only set auth_pass if REDIS_PASSWORD is provided and not empty
        if (process.env.REDIS_PASSWORD && process.env.REDIS_PASSWORD.trim() !== '') {
            this.options.auth_pass = process.env.REDIS_PASSWORD;
        }
    }
}

RedisClient.prototype.initialize = function () {
    this.redisClient = redis.createClient(this.options);
    this.publisher = redis.createClient(this.options);
    this.subscriber = redis.createClient(this.options);

    const onError = (label) => (error) => {
        console.error(`Redis ${label} error:`, error.message);
    };
    this.redisClient.on('error', onError('client'));
    this.publisher.on('error', onError('publisher'));
    this.subscriber.on('error', onError('subscriber'));

    // f (process.env.NODE_ENV !== 'prod') this.redisClient.config('SET', 'notify-keyspace-events', 'Ex'); // TODO -> move to setupConfig
    try {
        if (process.env.NODE_ENV !== 'prod') this.redisClient.config('SET', 'notify-keyspace-events', 'Ex');
    } catch (error) {
        console.log(`'SET', 'notify-keyspace-events', 'Ex' failed!!!![ignore]`, error?.message);
    }
    this.redisClient.on('ready', this.setupConfig.bind(this));
};

RedisClient.prototype.setupConfig = function () {
    this.publisher.setMaxListeners(0);
    this.subscriber.setMaxListeners(0);
    this.subscriber.subscribe('__keyevent@0__:expired'); // reminder service
    this.subscriber.on('message', this.onMessage);
    this.setupVariables();
    globalThis.redis = this;
    console.log('\x1b[32m%s\x1b[0m', 'Redis is connected');
};

RedisClient.prototype.getAdapter = function () {
    return ioRedis({ ...this.options, subClient: this.subscriber, pubClient: this.publisher });
};

RedisClient.prototype.setupVariables = function () {
    this.keysAsync = promisify(this.redisClient.keys).bind(this.redisClient);
    this.incrAsync = promisify(this.redisClient.incr).bind(this.redisClient);
    this.decrAsync = promisify(this.redisClient.decr).bind(this.redisClient);
    // timers
    this.getAsync = promisify(this.redisClient.get).bind(this.redisClient);
    this.setAsync = promisify(this.redisClient.set).bind(this.redisClient);
    this.setEx = promisify(this.redisClient.setex).bind(this.redisClient); // (key, s, value)
    this.pSetEx = promisify(this.redisClient.psetex).bind(this.redisClient); // (key, ms, value)

    this.expireAsync = promisify(this.redisClient.expire).bind(this.redisClient);
    this.ttlAsync = promisify(this.redisClient.ttl).bind(this.redisClient);
    this.pexpireAsync = promisify(this.redisClient.pexpire).bind(this.redisClient);
    this.pttlAsync = promisify(this.redisClient.pttl).bind(this.redisClient);
    // hash
    this.hdelAsync = promisify(this.redisClient.hdel).bind(this.redisClient);
    this.hsetAsync = promisify(this.redisClient.hset).bind(this.redisClient);
    this.hkeysAsync = promisify(this.redisClient.hkeys).bind(this.redisClient);
    this.hgetAsync = promisify(this.redisClient.hget).bind(this.redisClient);
    this.hgetallAsync = promisify(this.redisClient.hgetall).bind(this.redisClient);
    this.hmgetAsync = promisify(this.redisClient.hmget).bind(this.redisClient);
    this.hdelAsync = promisify(this.redisClient.hdel).bind(this.redisClient);
    this.hmsetAsync = promisify(this.redisClient.hmset).bind(this.redisClient);
    this.hexistsAsync = promisify(this.redisClient.hexists).bind(this.redisClient);
    // list
    this.lpushAsync = promisify(this.redisClient.lpush).bind(this.redisClient);
    this.rpushAsync = promisify(this.redisClient.rpush).bind(this.redisClient);
    this.lpopAsync = promisify(this.redisClient.lpop).bind(this.redisClient);
    this.rpopAsync = promisify(this.redisClient.rpop).bind(this.redisClient);
    this.llenAsync = promisify(this.redisClient.llen).bind(this.redisClient);
    this.lrangeAsync = promisify(this.redisClient.lrange).bind(this.redisClient);
    this.ltrimAsync = promisify(this.redisClient.ltrim).bind(this.redisClient);
    this.lindexAsync = promisify(this.redisClient.lindex).bind(this.redisClient);
    this.lsetAsync = promisify(this.redisClient.lset).bind(this.redisClient);
    this.lremAsync = promisify(this.redisClient.lrem).bind(this.redisClient);
    // set
    this.saddAsync = promisify(this.redisClient.sadd).bind(this.redisClient);
    this.sismemberAsync = promisify(this.redisClient.sismember).bind(this.redisClient);
    this.smembersAsync = promisify(this.redisClient.smembers).bind(this.redisClient);
    // sorted set
    this.zaddAsync = promisify(this.redisClient.zadd).bind(this.redisClient);
    this.zrangeAsync = promisify(this.redisClient.zrange).bind(this.redisClient);
    this.zrevrangeAsync = promisify(this.redisClient.zrevrange).bind(this.redisClient);
    this.zrangebyscoreAsync = promisify(this.redisClient.zrangebyscore).bind(this.redisClient);
    // delete
    this.deleteAsync = promisify(this.redisClient.del).bind(this.redisClient);
    this.delete = (key, callback = () => { }) => this.redisClient.del(key.toString(), callback);
    this.publish = (eventName, data) => this.publisher.publish(eventName, _.stringify(data));
};

RedisClient.prototype.onMessage = function (channel, message) {
    let _channel;
    let _message;

    if (channel === '__keyevent@0__:expired') {
        // eslint-disable-next-line no-console
        if (process.env.NODE_ENV !== 'prod') console.log('REDIS', message);

        // for timelyBonus
        if (message.startsWith('t_bon:')) {
            const [, iUserId, iBonusId, host] = message.split(':'); // [ 't_bon', 'u1', 'b1', '127.0.0.1' ]
            if (host !== process.env.HOST) return false;
            return emitter.emit('timelyBonus', { iUserId, iBonusId });
        }

        // for spinBonus
        if (message.startsWith('s_bon:')) {
            const [, iUserId, iBonusId, host] = message.split(':'); // [ 's_bon', 'u1', 'b1', '127.0.0.1' ]
            if (host !== process.env.HOST) return false;
            return emitter.emit('spinBonus', { iUserId, iBonusId });
        }

        // for tournament
        // `tr:${iTournamentId}:scheduler:${sTask}:${iTableId}:${iUserId}:${host}`
        if (message.startsWith('tr:')) {
            const [, iTournamentId, , sTask, iTableId, iUserId, host] = message.split(':'); // [ 't_bon', 'u1', 'b1', '127.0.0.1' ]
            if (host !== process.env.HOST || !sTask || !iTournamentId) return false;
            // if (![].includes(sTask)) return false;
            return emitter.emit(sTask, { iTournamentId, iTableId, iUserId });
        }

        const [$preMessage, task, $channel, $postMessage, ip] = message.split(':');
        if (ip !== process.env.HOST) return false;
        if (task !== 'scheduler') return false;

        _channel = $channel;
        _message = `${$preMessage}-${$postMessage || ''}`; // iTabled + -iUserId
    } else {
        _channel = channel;
        _message = message;
    }

    let parsedMessage = '';
    try {
        parsedMessage = _.parse(_message);
    } catch (error) {
        log.red('can not parse -> ', _message);
        parsedMessage = _message;
    }
    emitter.emit(_channel, parsedMessage);
};

module.exports = new RedisClient();

// redis-commander --redis-host redis-14133.c264.ap-south-1-1.ec2.cloud.redislabs.com --redis-port 14133 --redis-password XTAQfKrgM042RxQk6C63IQsDeUhiLgD6
