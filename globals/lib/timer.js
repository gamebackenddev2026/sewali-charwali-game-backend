const events = require('./emitter');

const operations = {};
const timers = {};

operations.initializeTimer = (_id, duration, callback = () => {}) => {
    if (timers[_id]) clearTimeout(timers[_id]);
    timers[_id] = setTimeout(() => {
        delete timers[_id];
        callback();
    }, duration);
};

operations.getTimer = (_id) => !!timers[_id];

operations.deleteTimer = (_id) => {
    clearTimeout(timers[_id]);
    delete timers[_id];
    return true;
};

operations.listTimers = () => Object.keys(timers);

// events.on('reqInitializeTimer', operations.initializeTimer);
// events.on('reqGetTimer', operations.getTimer);
// events.on('reqDeleteTimer', operations.deleteTimer);

module.exports = operations;
