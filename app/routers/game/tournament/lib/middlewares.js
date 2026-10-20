const { User } = require('../../../../models');
const fairPlay = require('../../../../FairPlay');

const middlewares = {};

middlewares.isAuthenticated = (req, res, next) => {
    try {
        const token = req.header('Authorization');
        const decodedToken = _.verifyToken(token);
        req.query.eLocale = req.query.eLocale || decodedToken?.eLocale;
        if (token) {
            User.findOne({ _id: decodedToken._id })
                .then((user) => {
                    if (!user) {
                        return res.reply(message.not_found('user', req.query?.eLocale || 'en'));
                    }
                    req.query.eLocale = user?.eLocale || decodedToken?.eLocale || 'en';
                    return _.checkAndDowngradeVip(user)
                        .then((updatedUser) => {
                            if (updatedUser.sToken !== token) return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
                            const restrictionReply = fairPlay.getAuthRestrictionReply(updatedUser, req.query?.eLocale || 'en');
                            if (restrictionReply) return res.reply(restrictionReply);
                            if (updatedUser.eStatus === 'n') return res.reply(message.user_blocked('', req.query?.eLocale || 'en'));
                            if (updatedUser.eStatus === 'd') return res.reply(message.user_deleted('', req.query?.eLocale || 'en'));
                            // if (updatedUser.eUserType === 'user') return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
                            req._id = updatedUser._id;
                            req.user = updatedUser;
                            return next(null, null);
                        })
                        .catch(() => {
                            if (user.sToken !== token) return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
                            const restrictionReply = fairPlay.getAuthRestrictionReply(user, req.query?.eLocale || 'en');
                            if (restrictionReply) return res.reply(restrictionReply);
                            if (user.eStatus === 'n') return res.reply(message.user_blocked('', req.query?.eLocale || 'en'));
                            if (user.eStatus === 'd') return res.reply(message.user_deleted('', req.query?.eLocale || 'en'));
                            req._id = user._id;
                            req.user = user;
                            return next(null, null);
                        });
                })
                .catch((error) => {
                    log.console(error);
                    return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
                });
        } else {
            return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
        }
    } catch (error) {
        log.console(error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

// middlewares.isAuthenticated = (req, res, next) => {
//     const token = req.header('Authorization');
//     if (!token) return res.reply(message.unauthorized());

//     const decodedToken = _.decodeToken(token);
//     if (!decodedToken) return res.reply(message.unauthorized());

//     req.query.eLocale = req.query.eLocale || decodedToken?.eLocale;

//     const query = { _id: decodedToken._id };
//     User.findOne(query, (err, data) => {
//         if (err) return res.reply(message.server_error());
//         if (!data) return res.reply(message.not_found('User'));
//         if (data.sToken !== token) return res.reply(message.unauthorized('', req.query?.eLocale || 'en'));
//         if (data.eStatus === 'n') return res.reply(message.user_blocked('', req.query?.eLocale || 'en'));
//         if (data.eStatus === 'd') return res.reply(message.user_deleted('', req.query?.eLocale || 'en'));
//         req.user = data;
//         next();
//     });
// };

module.exports = middlewares;
