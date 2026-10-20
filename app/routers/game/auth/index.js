const router = require('express').Router();
const controllers = require('./lib/controllers');

router.post('/register', controllers.register);
router.post('/login', controllers.login);
router.post('/password/forgot', controllers.forgotPassword);
router.post('/password/reset', controllers.resetPassword);
router.get('/verify/email/:token', controllers.verifyEmail);
router.post('/verify/otp', controllers.verifyOTP);
// router.get('/verify/link/:link', controllers.verifyLink);
router.post('/resend/otp', controllers.resendOTP);
router.post('/login/social', controllers.socialLogin);
router.post('/callback/facebook', controllers.facebookCallback);
router.get('/delink/facebook', controllers.deLinkFacebook);
router.get('/logout', controllers.logout);
router.get('/token/refresh', controllers.refreshToken);
router.post('/verify/referral', controllers.verifyReferral);

module.exports = router;
