const { User } = require('../../../../models');
const fairPlay = require('../../../../FairPlay');

const middleware = {};

middleware.isAuthenticated = async (req, res, next) => {
    try {
        const token = req.header('authorization');
        if (!token) return res.reply(message.unauthorized());
        const decodedToken = _.decodeToken(token);
        if (!decodedToken) return res.reply(message.unauthorized());

        let user = await User.findOne({ _id: decodedToken._id }).lean();

        if (!user) return res.reply(message.unauthorized());
        if (user.sToken !== token) return res.reply(message.unauthorized());
        req.query.eLocale = user?.eLocale || decodedToken?.eLocale || 'en';
        try {
            user = await _.checkAndDowngradeVip(user);
        } catch (err) {
            // ignore helper errors
        }

        const restrictionReply = fairPlay.getAuthRestrictionReply(user, req.query?.eLocale || 'en');
        if (restrictionReply) return res.reply(restrictionReply);
        if (user.eStatus === 'n') return res.reply(message.user_blocked('', req.query?.eLocale || 'en'));
        if (user.eStatus === 'd') return res.reply(message.user_deleted('', req.query?.eLocale || 'en'));

        // if (!admin.isEmailVerified) return res.reply(message.not_verified('Email'));
        req.user = user;
        next();
    } catch (error) {
        log.error('🚀 ~ file: middlewares.js:20 ~ middleware.isAuthenticated= ~ error:', error);
        return res.reply(message.server_error(), error.toString());
    }
};

module.exports = middleware;
