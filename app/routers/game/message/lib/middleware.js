const { User } = require('../../../../models');
const fairPlay = require('../../../../FairPlay');

const middleware = {};

middleware.isAuthenticated = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));

    const decodedToken = _.decodeToken(token);
    if (!decodedToken) return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));

    req.query.eLocale = req.query.eLocale || decodedToken?.eLocale;

    User.findOne({ _id: decodedToken._id }, (err, user) => {
        if (err) return res.reply(message.server_error('', req.query?.eLocale || user?.eLocale || 'en'));
        if (!user) return res.reply(message.not_found('User', req.query?.eLocale || user?.eLocale || 'en'));
        if (user.sToken !== token) {
            return res.reply(message.unauthorized('', req.query?.eLocale || user?.eLocale || 'en'));
        }
        req.query.eLocale = user?.eLocale || decodedToken?.eLocale || 'en';
        _.checkAndDowngradeVip(user)
            .then((updatedUser) => {
                const restrictionReply = fairPlay.getAuthRestrictionReply(updatedUser, req.query?.eLocale || updatedUser?.eLocale || 'en');
                if (restrictionReply) return res.reply(restrictionReply);
                if (updatedUser.eStatus === 'n') return res.reply(message.user_blocked('', req.query?.eLocale || updatedUser?.eLocale || 'en'));
                if (updatedUser.eStatus === 'd') return res.reply(message.user_deleted('', req.query?.eLocale || updatedUser?.eLocale || 'en'));
                if (updatedUser.bIsEmailVerified === false) return res.reply(message.not_verified('Email', req.query?.eLocale || updatedUser?.eLocale || 'en'));
                req.user = updatedUser;
                next();
            })
            .catch(() => {
                const restrictionReply = fairPlay.getAuthRestrictionReply(user, req.query?.eLocale || user?.eLocale || 'en');
                if (restrictionReply) return res.reply(restrictionReply);
                if (user.eStatus === 'n') return res.reply(message.user_blocked('', req.query?.eLocale || user?.eLocale || 'en'));
                if (user.eStatus === 'd') return res.reply(message.user_deleted('', req.query?.eLocale || user?.eLocale || 'en'));
                if (user.bIsEmailVerified === false) return res.reply(message.not_verified('Email', req.query?.eLocale || user?.eLocale || 'en'));
                req.user = user;
                next();
            });
    });
};

module.exports = middleware;
