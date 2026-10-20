const router = require('express').Router();
const controllers = require('./lib/controllers');
const middleware = require('./lib/middleware');

router.post('/table/add', controllers.addTable);
router.get('/table/:eGameType', middleware.isAuthenticated, controllers.getTable);
router.post('/table/tip', middleware.isAuthenticated, controllers.tipAmount); // for offline mode only. use event reqTipToDealer event for online mode
router.post('/table/join', middleware.isAuthenticated, middleware.getTable, middleware.joinState, controllers.joinTable); // returns { iTableId: 'ghfhfhfhsddfhddhd5y' }
router.post('/table/private/create', middleware.isAuthenticated, middleware.getTable, middleware.createPrivateTable, controllers.joinPrivateTable); // returns { sCode: '123456', iTableId: 'ghfhfhfhsddfhddhd5y' }
router.post('/table/private/join', middleware.isAuthenticated, middleware.fetchPrivateTable, controllers.joinPrivateTable);

module.exports = router;
