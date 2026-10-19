const router = require('express').Router();

const controllers = require('./lib/controllers');
const middlewares = require('./lib/middlewares');

router.post('/register', middlewares.isAuthenticated, controllers.register);
router.post('/list', middlewares.isAuthenticated, controllers.list);
router.get('/view/:iTournamentId', middlewares.isAuthenticated, controllers.view);
// [internal server communication]
router.post('/schedular/initiate', controllers.initiateScheduler);

module.exports = router;
