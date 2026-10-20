const { ClubMember, User } = require('../../../../models');
const { mongodb } = require('../../../../utils');
const fairPlay = require('../../../../FairPlay');

const middleware = {};

// Check if user is authenticated (reuse from friend middleware pattern)
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
                req.user = updatedUser;
                next();
            })
            .catch(() => {
                const restrictionReply = fairPlay.getAuthRestrictionReply(user, req.query?.eLocale || user?.eLocale || 'en');
                if (restrictionReply) return res.reply(restrictionReply);
                if (user.eStatus === 'n') return res.reply(message.user_blocked('', req.query?.eLocale || user?.eLocale || 'en'));
                if (user.eStatus === 'd') return res.reply(message.user_deleted('', req.query?.eLocale || user?.eLocale || 'en'));
                req.user = user;
                next();
            });
    });
};

// Check if user is a member of the club
middleware.isClubMember = async (req, res, next) => {
    try {
        const iClubId = req.params?.iClubId || req.body?.iClubId || req.query?.iClubId;
        if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);
        const member = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
        }).lean();

        if (!member) {
            return res.reply(message.not_found('Club membership', req.query?.eLocale || 'en'));
        }

        req.clubMember = member;
        next();
    } catch (error) {
        log.error('isClubMember error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Check if user is owner or admin of the club
middleware.isClubOwnerOrAdmin = async (req, res, next) => {
    try {
        const iClubId = req.params?.iClubId || req.body?.iClubId || req.query?.iClubId;
        if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);
        const member = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
            eRole: { $in: ['owner', 'admin'] },
        }).lean();

        if (!member) {
            return res.reply(message.only_owner_or_admin_perform_action('', req.query?.eLocale || 'en'));
        }

        req.clubMember = member;
        next();
    } catch (error) {
        log.error('isClubOwnerOrAdmin error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Check if user is owner of the club
middleware.isClubOwner = async (req, res, next) => {
    try {
        const iClubId = req.params?.iClubId || req.body?.iClubId || req.query?.iClubId;
        if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);
        const member = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
            eRole: 'owner',
        }).lean();

        if (!member) {
            return res.reply(message.only_owner_perform_action('', req.query?.eLocale || 'en'));
        }

        req.clubMember = member;
        next();
    } catch (error) {
        log.error('isClubOwner error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

module.exports = middleware;
