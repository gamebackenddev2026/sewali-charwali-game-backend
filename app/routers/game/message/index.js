const router = require('express').Router();
const controllers = require('./lib/controllers');
const middleware = require('./lib/middleware');

router.use(middleware.isAuthenticated);

router.post('/send', controllers.sendMessage);
router.get('/conversation/:iFriendId', controllers.getConversation);
router.get('/conversations', controllers.getConversations);
// router.get('/unread-count', controllers.getUnreadCount);

module.exports = router;
