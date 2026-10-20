const crypto = require('crypto');
const validator = require('validator');
const axios = require('axios');

const { User, Settings, Bonus, Achievements, UserAchievements, Tournament, TournamentUser } = require('../../../../models');
const { social, firebase, mongodb, nodemailer } = require('../../../../utils');
const fairPlay = require('../../../../FairPlay');

const controllers = {};

controllers.register = async (req, res) => {
    try {
        const body = _.pick(req.body, ['sUserName', 'sEmail', 'sPassword', 'sConfirmPassword', 'iReferredBy']);
        if (!body.sUserName) return res.reply(message.required_field('Username', 'en'));
        if (!body.sEmail) return res.reply(message.required_field('Email', 'en'));
        if (!body.sPassword) return res.reply(message.required_field('Password', 'en'));
        if (!body.sConfirmPassword) return res.reply(message.required_field('confirm_password', 'en'));
        if (body.sPassword !== body.sConfirmPassword) return res.reply(message.not_matched('Password', 'en'));

        body.sUserName = body.sUserName.trim();
        body.sEmail = body.sEmail.trim();

        if (body.sUserName === '_') return res.reply(message.invalid('Username', 'en'));
        if (globalThis.filter.isProfane(body.sUserName)) return res.reply(message.inappropriate('Username', 'en'));

        if (!validator.isEmail(body.sEmail)) return res.reply(message.invalid('Email', 'en'));

        // eslint-disable-next-line prefer-const
        let [user, settings, achievements, userAchievement] = await Promise.all([
            User.findOne({ $or: [{ sEmail: body.sEmail }, { sUserName: body.sUserName }] }), //
            Settings.findOne({}),
            Achievements.find({}),
            UserAchievements.find({ sUserName: body.sUserName }),
        ]);

        if (user?.sUserName === body.sUserName) return res.reply(message.already_exists('Username', 'en'));
        if (user?.sEmail === body.sEmail) return res.reply(message.already_exists('Email', 'en'));
        if (!settings) throw new Error(`settings not found`);
        if (!achievements?.length) log.warn(`achievements not found`);

        body.sPassword = _.encryptPassword(body.sPassword);
        body.sReferralCode = _.randomizeAlphaNumericString(9, 99999).pop();
        body.nTotalCoins = settings.nDefaultCoin || 0;
        body.eBadges = 'beginner';
        // if (process.env.NODE_ENV !== 'prod') body.bIsEmailVerified = true;

        user = new User(body);

        const encodedLink = _.encodeToken({ _id: user._id, sEmail: body.sEmail });
        const link = `${process.env.BASE_API_PATH}/auth/verify/email/${encodedLink}`;
        // if (process.env.NODE_ENV === 'prod') email.send(email.verification, { sEmail: body.sEmail, link });
        nodemailer.send(nodemailer.verification, { sEmail: body.sEmail, link });

        if (achievements?.length && !userAchievement) {
            const _userAchievement = new UserAchievements({ sUserName: body.sUserName, aUserAchievements: achievements });
            _userAchievement.save().then();
        }

        if (mongodb.isValidObjectId(body.iReferredBy)) {
            const referedBy = await User.findOne({ _id: mongodb.mongify(body.iReferredBy) });
            if (referedBy) {
                const bonus = new Bonus({ iUserId: user._id, iReferredBy: body.iReferredBy, eCategory: 'referral', nBonus: settings?.nReferralBonus || 100, eBonusType: 'instant' });
                referedBy.nTotalCoins += settings.nReferralBonus || 100;
                user.nTotalCoins += settings.nReferralBonus || 100;
                //
                user.save().then();
                referedBy.save().then();
                bonus.save().then();
            }
        } else log.warn(`invalid iReferredBy: ${body.iReferredBy}`);

        user.sReferralLink = 'https://3cardrumb.onelink.me/z2qh?af_xp=custom&pid=app_redirection&c=redirection&af_dp=deeplinkwithoutgoogleplay%3A%2F%2Fopen&is_retargeting=true';
        user.save().then().catch();
        res.reply(message.verify_email('Register successfully, Please', req?.query?.eLocale || 'en'));
    } catch (err) {
        log.error('auth/register :', err);
        res.reply(message.server_error('', req?.query?.eLocale || 'en'));
    }
};

controllers.login = async (req, res) => {
    try {
        const body = _.pick(req.body, ['sPassword', 'sEmail', 'sDeviceId', 'deviceId']);
        const deviceId = body.sDeviceId || body.deviceId || null;
        const ip = req.sRemoteAddress || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || null;

        if (deviceId && (await fairPlay.isDeviceBanned(deviceId))) {
            return res.reply(message.noLocale('This device is not allowed to access the game.', 403));
        }

        // Allow login for both user and vip
        const query = {
            eUserType: { $in: ['user', 'vip'] },
        };

        if (body.sEmail) {
            body.sEmail = body.sEmail.trim();
            if (!validator.isEmail(body.sEmail)) return res.reply(message.invalid('Email', 'en'));
            query.sEmail = body.sEmail;
        }
        query.sPassword = _.encryptPassword(body.sPassword);
        const user = await User.findOne(query);
        if (!user || _.isEmptyObject(user)) return res.reply(message.incorrect_email_pass('', 'en'));
        const restrictionReply = fairPlay.getAuthRestrictionReply(user, 'en');
        if (restrictionReply) return res.reply(restrictionReply);
        if (user.eStatus === 'n') return res.reply(message.user_blocked('', 'en'));
        if (user.eStatus === 'd') return res.reply(message.user_deleted('', 'en'));
        if (user.bIsEmailVerified === false) return res.reply(message.not_verified('Email', 'en'));

        user.sToken = _.encodeToken({ _id: user._id, eLocale: 'en' }, { expiresIn: '1h' });
        user.eLoginType = 'default';
        user.dLastLoginAt = new Date();

        // Manage login streak
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (!user.dLAstStreakLoginAt) {
            // First time login streak
            user.nLoginStreak = 1;
            user.dLAstStreakLoginAt = new Date();
        } else {
            const lastStreakDate = new Date(user.dLAstStreakLoginAt);
            lastStreakDate.setHours(0, 0, 0, 0);

            const daysDifference = Math.floor((today - lastStreakDate) / (1000 * 60 * 60 * 24));

            if (daysDifference === 0) {
                // User already logged in today, don't update streak
                // Keep existing streak count
            } else if (daysDifference === 1) {
                // Consecutive day login - increment streak
                user.nLoginStreak = (user.nLoginStreak || 0) + 1;
                user.dLAstStreakLoginAt = new Date();
            } else {
                // Streak broken - reset to 1
                user.nLoginStreak = 1;
                user.dLAstStreakLoginAt = new Date();
            }
        }
        //
        // if (!user.sReferralCode || !user.sReferralLink) {
        //     user.sReferralCode = _.randomizeAlphaNumericString(9, 99999).pop();
        //     // Save referral code first, then get deep link asynchronously
        //     user.sReferralLink = null; // Will be updated in callback
        //     firebase.deepLink(user._id, user.sReferralCode, (error, response) => {
        //         if (error) {
        //             console.error('error', user._id.toString(), error);
        //             return;
        //         }
        //         // Use findOneAndUpdate to avoid parallel save error
        //         User.findByIdAndUpdate(user._id, { $set: { sReferralLink: response.shortLink } }, { new: true }, _.errorCallback);
        //     });
        // }
        //
        if (user.iLastTournamentId) {
            const tournament = await Tournament.findOne({ _id: mongodb.mongify(user.iLastTournamentId) }, { _id: 1, eStatus: 1 }).lean();
            if (!['completed'].includes(tournament?.eStatus)) await TournamentUser.updateOne({ iTournamentId: mongodb.mongify(user.iLastTournamentId), iUserId: user._id }, { $set: { eStatus: 'disconnected' } });
            user.iLastTournamentId = null;
        }

        await user.save();
        log.red('deviceId=============================', deviceId);
        await fairPlay.recordSession(user._id.toString(), deviceId, ip).catch((e) => log.error('FairPlay recordSession on login failed', e?.message));

        const userToken = user.sToken;

        if (!userToken) {
            log.error('Token is null after save in login');
            return res.reply(message.server_error('', 'en'));
        }

        (async () => {
            try {
                const baseUrl = process.env.NODE_ENV === 'dev' ? 'http://localhost:3401' : process.env.BASE_URL;
                const listResponse = await axios.get(`${baseUrl}/api/v1/daily-challenge/list`, {
                    headers: {
                        Authorization: userToken,
                        authorization: userToken, // Some middleware expects lowercase
                    },
                    timeout: 4000,
                });
                // dailyLogin could be present in either daily or weekly challenge arrays, merge both for search
                const dailyArray = Array.isArray(listResponse.data?.data?.daily) ? listResponse.data.data.daily : [];
                const weeklyArray = Array.isArray(listResponse.data?.data?.weekly) ? listResponse.data.data.weekly : [];
                const dailyChallenges = [...dailyArray, ...weeklyArray];

                // Find an incomplete dailyLogin challenge (isCompleted: false)
                const dailyLoginChallenge = dailyChallenges.find((challenge) => challenge.eChallengeType === 'dailyLogin' && challenge.isCompleted === false) || null;

                if (dailyLoginChallenge) {
                    await axios.post(
                        'http://localhost:3401/api/v1/profile/daillyChallange/progress',
                        {
                            eChallengeType: 'dailyLogin',
                            nProgress: 1,
                        },
                        {
                            headers: {
                                Authorization: userToken,
                                authorization: userToken, // Some middleware expects lowercase
                            },
                            timeout: 4000,
                        }
                    );
                }
            } catch (e) {
                log.error('Failed to assign daily challenge tasks in login:', e?.message || e);
            }
        })();

        // Return successful login response - don't wait for daily challenge operations
        return res.reply(message.successfully('Login', 'en'), { sToken: userToken }, { authorization: userToken });
    } catch (e) {
        console.log('error in login', e);
        log.error('Login error:', e?.message || e);
        return res.reply(message.server_error('', 'en'));
    }
};

controllers.forgotPassword = (req, res) => {
    const body = _.pick(req.body, ['sEmail']);

    User.findOne({ sEmail: body.sEmail }, (err, user) => {
        if (err) return res.reply(message.server_error('', 'en'));
        if (!user) return res.reply(message.not_found('Email', 'en'));
        if (user.eStatus === 'n') return res.reply(message.user_blocked('', 'en'));
        if (user.eStatus === 'd') return res.reply(message.user_deleted('', 'en'));

        /**
         * Provide link
         */
        // const link = `${process.env.BASE_API_PATH}/auth/verify/link/`;

        // email.send(email.forgotPassword, { sEmail: user.sEmail, link });
        // user.save(_.errorCallback);
        // return res.reply(message.successfully('Link sent'));

        /**
         * Provide OTP
         */
        // user.nOTP = process.env.NODE_ENV === 'prod' ? _.salt(4) : 1234;
        user.nOTP = _.salt(4);
        user.sVerificationToken = _.encodeToken({ _id: user._id, nOTP: user.nOTP, eLocale: user?.eLocale || 'en' }, { expiresIn: '1m' });

        // if (process.env.NODE_ENV === 'prod') email.send(email.forgotPassword, { sEmail: user.sEmail, nOTP: user.nOTP, sUserName: user.sUserName });
        nodemailer.send(nodemailer.forgotPassword, { sEmail: user.sEmail, nOTP: user.nOTP, sUserName: user.sUserName });
        user.save(_.errorCallback);
        return res.reply(message.custom('OTP_sent', 'en'), {}, { Verification: user.sVerificationToken });
    });
};

controllers.resendOTP = (req, res) => {
    const body = _.pick(req.body, ['sEmail']);

    if (!body.sEmail) return res.reply(message.required_field('Email', 'en'));

    User.findOne({ sEmail: body.sEmail }, (err, user) => {
        if (err) return res.reply(message.server_error('', 'en'));
        if (!user) return res.reply(message.not_found('Email', 'en'));
        if (user.eStatus === 'n') return res.reply(message.user_blocked('', 'en'));
        if (user.eStatus === 'd') return res.reply(message.user_deleted('', 'en'));

        // body.nOTP = process.env.NODE_ENV === 'prod' ? _.salt(4) : 1234;
        body.nOTP = _.salt(4);
        body.sVerificationToken = _.encodeToken({ _id: user._id, nOTP: user.nOTP, eLocale: user?.eLocale || 'en' }, { expiresIn: '3m' });

        user.nOTP = body.nOTP;
        user.sVerificationToken = body.sVerificationToken;

        // email.send(email.forgotPassword, { sEmail: body.sEmail, nOTP: user.nOTP, sUserName: body.sUserName });
        nodemailer.send(nodemailer.forgotPassword, { sEmail: body.sEmail, nOTP: user.nOTP, sUserName: user.sUserName });
        user.save(_.errorCallback);
        res.reply(message.otp_sent('', 'en'), { nExpiresIn: 3 * 60 * 1000 }, { Verification: body.sVerificationToken });
    });
};

controllers.resetPassword = (req, res) => {
    const body = _.pick(req.body, ['sNewPassword']);

    const token = req.header('Verification');
    if (!token) return res.reply(message.unauthorized('', 'en'));
    const decodedToken = _.verifyToken(token);
    if (decodedToken === 'jwt expired') return res.reply(message.expired('session', req.query?.eLocale || decodedToken?.eLocale || 'en'));

    if (!body.sNewPassword) return res.reply(message.required_field('New password', req.query?.eLocale || decodedToken?.eLocale || 'en'));

    User.findOneAndUpdate({ _id: decodedToken._id }, { $set: { sPassword: _.encryptPassword(body.sNewPassword) } }, (err, user) => {
        if (err) return res.reply(message.server_error(), decodedToken?.eLocale || 'en');
        res.reply(message.successfully('password_changed', 'en'));
    });
};

controllers.verifyEmail = (req, res) => {
    const body = req.params.token;
    if (!body) return res.reply(message.unauthorized('', 'en'));
    const verifiedToken = _.verifyToken(body);
    if (verifiedToken === 'jwt expired') return res.reply(message.expired('session', req.query?.eLocale || verifiedToken?.eLocale || 'en'));

    const query = { sEmail: verifiedToken.sEmail };
    const updateQuery = { $set: { bIsEmailVerified: true } };

    User.findOneAndUpdate(query, updateQuery, (err, user) => {
        if (err) return res.reply(message.server_error('', req.query?.eLocale || user?.eLocale || 'en'));
        res.redirect('/verified.html');
    });
};

controllers.verifyOTP = (req, res) => {
    const body = _.pick(req.body, ['OTP', 'sEmail']);
    const token = req.header('Verification');
    if (!token) return res.reply(message.unauthorized('', 'en'));
    const decodedToken = _.verifyToken(token); // - { _id:'',, nOTP: 1234, eLocale: "en" }
    if (decodedToken === 'jwt expired') return res.reply(message.expired('otp', req.query?.eLocale || decodedToken?.eLocale || 'en'));
    const updateQuery = { bIsEmailVerified: true };
    if (decodedToken.nOTP !== Number(body.OTP)) return res.reply(message.wrong_otp('', req.query?.eLocale || decodedToken?.eLocale || 'en'));
    const query = { _id: decodedToken._id };

    User.findOneAndUpdate(query, { $set: updateQuery }, (err, user) => {
        if (err) return res.reply(message.server_error('', user?.eLocale || 'en'));
        if (!user) return res.reply(message.not_found('User', 'en'));
        const restrictionReply = fairPlay.getAuthRestrictionReply(user, 'en');
        if (restrictionReply) return res.reply(restrictionReply);
        if (user.eStatus === 'n') return res.reply(message.user_blocked('', 'en'));
        if (user.eStatus === 'd') return res.reply(message.user_deleted('', 'en'));

        user.sToken = _.encodeToken({ _id: user._id, eLocale: 'en' });
        user.save(_.errorCallback);
        return res.reply(message.successfully('Login', 'en'), {}, { Authorization: user.sToken });
    });
};

// controllers.verifyLink = (req, res) => {
//     const body = _.pick(req.params, ['link']);
//     const token = req.header('Verification');

//     if (!token) return res.reply(message.unauthorized());
//     const decodedToken = _.verifyToken(token);

//     if (decodedToken.sLink !== body.link) return res.reply(message.not_matched());

//     res.sendFile(path.join(__filename, '/reset_password.html'));
// };

controllers.socialLogin = async (req, res) => {
    const body = _.pick(req.body, ['sFacebookId', 'accessToken', 'idToken', 'userId', 'sDeviceId', 'deviceId']); // apple: 'idToken', 'userId'  // facebook: 'sFacebookId', 'accessToken'
    const deviceId = body.sDeviceId || body.deviceId || null;
    const ip = req.sRemoteAddress || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || null;

    if (deviceId && (await fairPlay.isDeviceBanned(deviceId))) {
        return res.reply(message.noLocale('This device is not allowed to access the game.', 403));
    }

    const authFunction = body.sFacebookId ? social.facebookLogin : social.appleLogin;
    authFunction(body, async (err, data) => {
        if (err) return res.reply(message.server_error('', 'en'));

        try {
            const details = _.pick(data, ['sEmail', 'sFacebookId', 'sUserName', 'sAppleUserId']);

            if (details.sUserName) {
                details.sUserName = details.sUserName.replace(/ +/g, '');
                if (details.sUserName.length > 15) details.sUserName = details.sUserName.substring(0, 15);
            } else {
                details.sUserName = `apple_${body.userId}`;
                if (details.sUserName.length > 15) details.sUserName = details.sUserName.substring(0, 15);
            }

            const query = { $or: [] };
            if (details.sEmail) query.$or.push({ sEmail: details.sEmail });
            if (details.sFacebookId) query.$or.push({ sFacebookId: details.sFacebookId });
            if (details.sAppleUserId) query.$or.push({ sAppleId: details.sAppleUserId });

            const project = {
                _id: true,
                sEmail: true,
                sUserName: true,
                sToken: true,
                eUserType: true,
                eStatus: true,
                eFlagLevel: true,
                dRestrictedUntil: true,
                sFacebookId: true,
                sAppleId: true,
                eLoginType: true,
            };

            let user = await User.findOne(query, project);

            if (!user) {
                const userObj = {};
                if (details.sEmail) userObj.sEmail = details.sEmail;
                if (details.sUserName) userObj.sUserName = details.sUserName.toLowerCase();
                if (details.sFacebookId) userObj.sFacebookId = details.sFacebookId;
                if (details.sAppleUserId) userObj.sAppleId = details.sAppleUserId;

                const setting = await Settings.findOne({}).lean();
                userObj.nTotalCoins = setting.nDefaultCoin;

                user = new User(userObj);
                //
                user.sToken = _.encodeToken({ _id: user._id, eLocale: user?.eLocale || 'en' });
                user.bIsEmailVerified = true;
                user.eLoginType = 'social';
                await user.save();
                fairPlay.recordSession(user._id.toString(), deviceId, ip).catch((e) => log.error('FairPlay recordSession social new user failed', e?.message));
                res.reply(message.successfully('', 'en'), { fields: { sEmail: user.sEmail, sToken: user.sToken } }, { Authorization: user.sToken });
            } else {
                const restrictionReply = fairPlay.getAuthRestrictionReply(user, 'en');
                if (restrictionReply) return res.reply(restrictionReply);
                if (user.eStatus === 'n') return res.reply(message.user_blocked('', 'en'));
                if (user.eStatus === 'd') return res.reply(message.user_deleted('', 'en'));

                if (!user.sEmail && details.sEmail) user.sEmail = details.sEmail;
                if (!user.sUserName && details.sUserName) user.sUserName = details.sUserName;
                if (!user.sFacebookId && details.sFacebookId) user.sFacebookId = details.sFacebookId;
                if (!user.sAppleId && details.sAppleUserId) user.sAppleId = details.sAppleUserId;

                user.eLoginType = 'social';
                user.bIsEmailVerified = true;
                user.sToken = _.encodeToken({ _id: user._id, eLocale: user?.eLocale || 'en' });

                await user.save();
                fairPlay.recordSession(user._id.toString(), deviceId, ip).catch((e) => log.error('FairPlay recordSession social login failed', e?.message));
                res.reply(message.successfully('Login', 'en'), {}, { Authorization: user.sToken });
            }

            // if (err) return res.reply(message.server_error());
            if (!user.sReferralCode || !user.sReferralLink) {
                user.sReferralCode = _.randomizeAlphaNumericString(9, 99999).pop();
                firebase.deepLink(user._id, user.sReferralCode, (error, response) => {
                    user.sReferralLink = response.shortLink;
                    user.save(_.errorCallback);
                    // eslint-disable-next-line no-console
                    if (error) console.error('error', user._id.toString(), error);
                });
            }
        } catch (error) {
            log.error('error on socialLogin');
            return res.reply(message.server_error('en'));
        }
    });
};

controllers.facebookCallback = (req, res) => {
    function base64decode(data) {
        while (data.length % 4 !== 0) {
            // eslint-disable-next-line no-param-reassign
            data += '=';
        }
        // eslint-disable-next-line no-param-reassign
        data = data.replace(/-/g, '+').replace(/_/g, '/');
        return Buffer.from(data, 'base64').toString('utf-8');
    }

    function parseSignedRequest(signedRequest, secret) {
        log.blue('parseSignedRequest signedRequest :: ', signedRequest);
        const encodedData = signedRequest.split('.', 2);
        // decode the data
        const sig = encodedData[0];
        const json = base64decode(encodedData[1]);
        const data = JSON.parse(json);
        log.yellow('data of signed request :: ', data);
        if (!data.algorithm || data.algorithm.toUpperCase() !== 'HMAC-SHA256') {
            throw Error(`Unknown algorithm: ${data.algorithm}. Expected HMAC-SHA256`);
        }
        const expectedSig = crypto.createHmac('sha256', secret).update(encodedData[1]).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace('=', '');
        if (sig !== expectedSig) {
            throw Error(`Invalid signature: ${sig}. Expected ${expectedSig}`);
        }
        log.green('final data :: ', data);
        return data;
    }

    const fbDetails = parseSignedRequest(req.body.signed_request, process.env.FB_APP_SECRET);
    log.console('fbDetails', fbDetails);
    const query = {
        sFacebookId: fbDetails.user_id,
    };
    const updateQuery = {
        sFacebookId: '',
    };
    User.findOneAndUpdate(query, { $set: updateQuery }, (error, user) => {
        if (error) return res.reply(message.server_error('', 'en'), error.toString());
        return res.status(200).jsonp({ url: `${process.env.BASE_API_PATH}/delink/facebook`, confirmation_code: '200' });
    });
};

controllers.deLinkFacebook = (req, res) => res.reply(message.successfully('Your facebook account delinked', 'en'));

controllers.logout = (req, res) => {
    const token = req.header('Authorization');
    if (!token) return res.reply(message.unauthorized('', 'en'));
    const decodedToken = _.verifyToken(token);

    User.updateOne({ _id: decodedToken._id }, { $set: { sToken: null } }, (err, user) => {
        if (err) return res.reply(message.server_error('', req.query?.eLocale || user?.eLocale || decodedToken?.eLocale || 'en'));
        return res.reply(message.successfully('Logout', req.query?.eLocale || user?.eLocale || decodedToken?.eLocale || 'en'));
    });
};

controllers.refreshToken = (req, res) => {
    const token = req.header('Authorization');
    if (!token) return res.reply(message.unauthorized('', 'en'));

    const decodedToken = _.decodeToken(token);
    if (!decodedToken) return res.reply(message.unauthorized('', 'en'));

    User.findOne({ _id: decodedToken._id }, (error, user) => {
        if (error) return res.reply(message.server_error('', 'en'), error.toString());
        if (!user) return res.reply(message.not_found('User', 'en'));
        const restrictionReply = fairPlay.getAuthRestrictionReply(user, 'en');
        if (restrictionReply) return res.reply(restrictionReply);
        if (user.eStatus === 'n') return res.reply(message.user_blocked('', 'en'));
        if (user.eStatus === 'd') return res.reply(message.user_deleted('', 'en'));
        if (user.bIsEmailVerified === false) return res.reply(message.not_verified('Email', 'en'));
        user.sToken = _.encodeToken({ _id: user._id, eLocale: 'en' });
        user.save();
        res.reply(message.successfully('Login', 'en'), { sToken: user.sToken }, { Authorization: user.sToken });
    });
};

controllers.verifyReferral = (req, res) => {
    const { sReferralCode } = _.pick(req.body, ['sReferralCode']);
    if (!sReferralCode) return res.reply(message.required_field('Referral code', 'en'));
    const query = {
        sReferralCode,
    };
    User.findOne(query, { _id: true }, (error, user) => {
        if (error) return res.reply(message.server_error('', 'en'), error.toString());
        if (!user) return res.reply(message.custom('Invalid Referral code', 'en'));
        return res.reply(message.custom('Your referral code has been successfully applied.', 'en'), { iReferredBy: user._id });
    }).lean();
};

module.exports = controllers;
