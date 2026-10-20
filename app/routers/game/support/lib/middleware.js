const { User } = require('../../../../models');
const fairPlay = require('../../../../FairPlay');

const middleware = {};
middleware.isAuthenticated = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));

    const decodedToken = _.decodeToken(token);
    if (!decodedToken) return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));

    req.query.eLocale = req.query.eLocale || decodedToken?.eLocale;

    const project = {
        _id: true,
        sUserName: true,
        sEmail: true,
        eStatus: true,
        eUserType: true,
        eFlagLevel: true,
        dRestrictedUntil: true,
        sToken: true,
    };
    User.findOne({ _id: decodedToken._id }, project, (error, user) => {
        if (error) return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        if (!user) return res.reply(message.not_found('user', req.query?.eLocale || 'en'));
        if (user.sToken !== token) return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
        req.query.eLocale = user?.eLocale || decodedToken?.eLocale || 'en';
        _.checkAndDowngradeVip(user)
            .then((updatedUser) => {
                const restrictionReply = fairPlay.getAuthRestrictionReply(updatedUser, req.query?.eLocale || 'en');
                if (restrictionReply) return res.reply(restrictionReply);
                if (updatedUser.eStatus === 'n') return res.reply(message.user_blocked('', req.query?.eLocale || 'en'));
                if (updatedUser.eStatus === 'd') return res.reply(message.user_deleted('', req.query?.eLocale || 'en'));
                if (updatedUser.eUserType !== 'user' && updatedUser.eUserType !== 'admin') return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
                req.user = updatedUser;
                next();
            })
            .catch(() => {
                // fallback to original user object on error
                const restrictionReply = fairPlay.getAuthRestrictionReply(user, req.query?.eLocale || 'en');
                if (restrictionReply) return res.reply(restrictionReply);
                if (user.eStatus === 'n') return res.reply(message.user_blocked('', req.query?.eLocale || 'en'));
                if (user.eStatus === 'd') return res.reply(message.user_deleted('', req.query?.eLocale || 'en'));
                if (user.eUserType !== 'user' && user.eUserType !== 'admin') return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
                req.user = user;
                next();
            });
    });
};
module.exports = middleware;
