const router = require('express').Router();
const controllers = require('./lib/controllers');
const middleware = require('./lib/middleware');

router.use(middleware.isAuthenticated);

router.get('/', controllers.getProfile);
router.get('/settings', controllers.getSettings);
// router.get('/leaderboard', controllers.getLeaderBoard);
router.get('/leaderboard', controllers.getLeaderBoard);
router.get('/achievements', controllers.getAchievements);
router.post('/achievement/progress', controllers.updateAchievementProgress);
router.post('/achievement/claim', controllers.achievementClaim);
router.post('/update/email', controllers.updateEmail);
router.post('/update/username', controllers.updateName);
router.post('/update/avatar', controllers.updateAvatar);
router.post('/update/password', controllers.updatePassword);
router.post('/update/coins', controllers.updateCoins);
router.post('/update/settings', controllers.updateSettings);
router.post('/update/pushtoken', controllers.updatePushToken);
router.post('/update/theame', controllers.updateTheame);
router.post('/send/gift', controllers.sendGift);
router.post('/delete', controllers.deleteAccount);
router.post('/daily/gift/claim', controllers.dailyGiftClaim);
//

router.post('/daillyChallange/progress', controllers.updateDailyChallange);

router.post('/timely/bonus/claim', controllers.timelyBonusClaim);
router.post('/spin/bonus/claim', controllers.spinBonusClaim);
//
router.get('/login-streak/rewards', controllers.getLoginStreakRewards);
router.post('/login-streak/claim', controllers.claimLoginStreakReward);

module.exports = router;
