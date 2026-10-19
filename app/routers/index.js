/* eslint-disable no-console */
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const gameRoute = require('./game');

function Router() {
    this.app = express();
    this.httpServer = http.createServer(this.app);
    this.corsOptions = {
        origin: ['*'],
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    };
}

Router.prototype.initialize = function () {
    this.setupMiddleware();
    this.setupServer();
};

Router.prototype.setupMiddleware = function () {
    this.app.disable('etag');
    this.app.enable('trust proxy');

    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(compression());
    this.app.use(bodyParser.json({ limit: '16mb' }));
    this.app.use(bodyParser.urlencoded({ limit: '16mb', extended: true, parameterLimit: 50000 }));

    this.app.use(globalThis.i18n.init);

    if (process.env.NODE_ENV !== 'prod') this.app.use(morgan('dev', { skip: (req) => req.path === '/ping' || req.path === '/favicon.ico' }));

    this.app.use(this.routeConfig);
    this.app.use('/api/v1', gameRoute);
    this.app.use(express.static('./seeds'));
    this.app.get('/socketFile', function (req, res) {
        res.sendFile('socket.html', { root: './seeds' });
    });
    this.app.use('*', this.routeHandler);
    this.app.use(this.logErrors);
    this.app.use(this.errorHandler);
};

Router.prototype.setupServer = function () {
    this.httpServer = http.Server(this.app);
    this.httpServer.timeout = 10000;
    this.httpServer.listen(process.env.PORT, '0.0.0.0', () => log.green(`Spinning on ${process.env.PORT}`));
};

Router.prototype.routeConfig = function (req, res, next) {
    req.sRemoteAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (req.path === '/ping') return res.status(200).send({});
    res.reply = ({ code, message }, data = {}, header = undefined) => {
        res.status(code).header(header).json({ message, data });
    };
    next();
};

Router.prototype.routeHandler = function (req, res) {
    res.status(404);
    res.send({ message: 'Route not found' });
};

Router.prototype.logErrors = function (err, req, res, next) {
    console.error(`${req.method} ${req.url}`);
    console.error('body -> ', req.body);
    console.error(err.stack);
    return next(err);
};

Router.prototype.errorHandler = function (err, req, res, next) {
    res.status(500);
    res.send({ message: err });
};

module.exports = new Router();
