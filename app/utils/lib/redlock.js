const IOREDIS = require('ioredis');

const { default: Redlock, ResourceLockedError } = require('redlock');

const redisOptions = {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
};
if (process.env.REDIS_PASSWORD && process.env.REDIS_PASSWORD.trim() !== '') {
    redisOptions.password = process.env.REDIS_PASSWORD;
}
const redis = new IOREDIS(redisOptions);

redis.on('error', (error) => {
    console.error('Redis[redLock] error:', error.message);
});

async function initialize() {
    redis.on('ready', async () => {
        console.log('\x1b[32m%s\x1b[0m', 'Redis[redLock] is connected');
        const redlock = new Redlock([redis], {
            driftFactor: 0.01, // multiplied by lock ttl to determine drift time
            retryCount: 10,
            retryDelay: 200, // time in ms
            retryJitter: 200, // time in ms
            automaticExtensionThreshold: 500, // time in ms
        });

        function errorHandler(error) {
            // Ignore cases where a resource is explicitly marked as locked on a client.
            if (error instanceof ResourceLockedError) return;
            // Log all other errors.
            console.error(`A error has occurred. [[redlock]] ☠. reason: ${error?.message}`, error);
        }
        redlock.on('error', errorHandler);

        globalThis.Lock = redlock;
    });
}

module.exports = { initialize };
