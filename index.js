/* eslint-disable import/no-commonjs, global-require */
if (require('dotenv').config().error) { // eslint-disable-line
    console.error('No environment variable found'); // eslint-disable-line no-console
    process.exit(1);
}
require('./globals');

const { mongodb, redis, redlock } = require('./app/utils');
const router = require('./app/routers');
const socket = require('./app/sockets');
// const { initializeCleanup } = require('./app/utils/lib/messageCleanup');

redlock.initialize();
mongodb.initialize();
redis.initialize();
router.initialize();
socket.initialize(router.httpServer);

// Initialize message cleanup job (runs every 24 hours)
// initializeCleanup();

module.exports = router;
