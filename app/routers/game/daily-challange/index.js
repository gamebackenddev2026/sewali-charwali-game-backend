const router = require('express').Router();
const controllers = require('./lib/controllers');
const middleware = require('./lib/middleware');

router.use(middleware.isAuthenticated);

router.get('/all/list', controllers.allDailyChallengeList);
router.get('/list', controllers.dailyChallengeList);
router.get('/claim/:iDailyChallengerId', controllers.claimChallenge);

module.exports = router;
