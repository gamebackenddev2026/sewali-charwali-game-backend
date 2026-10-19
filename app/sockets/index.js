const socketIO = require('socket.io');
const root = require('./root/socket');

function Socket() {
    this.options = {
        pingInterval: 10000,
        pingTimeout: 5000,
        cookie: false,
        maxHttpBufferSize: 1024,
        serveClient: true,
        transports: ['polling', 'websocket'],
        allowUpgrades: true,
        perMessageDeflate: false,
    };
}

Socket.prototype.initialize = function (httpServer) {
    const io = socketIO(httpServer, this.options);
    globalThis.io = io;
    root.init();
};

module.exports = new Socket();

/** @type {typeEnv} */
