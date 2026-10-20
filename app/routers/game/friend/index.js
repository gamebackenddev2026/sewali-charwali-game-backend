const router = require('express').Router();
const controllers = require('./lib/controllers');
const middleware = require('./lib/middleware');

router.use(middleware.isAuthenticated);

router.post('/send-request', controllers.sendRequest);
router.post('/action-request', controllers.actionRequest);
router.get('/request-list', controllers.requestList);
router.get('/friend-list', controllers.friendList);
router.get('/search-users', controllers.searchUsers);

module.exports = router;
