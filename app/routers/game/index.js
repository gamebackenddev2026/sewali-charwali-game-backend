const router = require('express').Router();

const authRoute = require('./auth');
const profileRoute = require('./profile');
const sewaliRoute = require('./sewali');
const supportRoute = require('./support');
const tournament = require('./tournament');
const dailyChallenge = require('./daily-challange');
const friendRoute = require('./friend');
const messageRoute = require('./message');
const clubRoute = require('./club');
const vipRoute = require('./vip');

router.use('/auth', authRoute);
router.use('/profile', profileRoute);
router.use('/sewali', sewaliRoute);
router.use('/support', supportRoute);
router.use('/tournament', tournament);
router.use('/daily-challenge', dailyChallenge);
router.use('/friend', friendRoute);
router.use('/message', messageRoute);
router.use('/club', clubRoute);
router.use('/vip', vipRoute);

module.exports = router;
