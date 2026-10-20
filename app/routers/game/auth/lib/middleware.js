const { requestLimiter } = require('../../../../utils/index');

const middleware = {};

middleware.apiLimiter = (req, res, next) => {
    const params = {
        path: req.path,
        remoteAddress: req.sRemoteAddress || '127.0.0.1',
        maxRequestTime: 1000,
    };
    requestLimiter.setLimit(params, (error) => {
        if (error) return res.reply(message.too_many_request());
        next();
    });
};

module.exports = middleware;
