const router = require('express').Router();
const middleware = require('./lib/middleware');
const controller = require('./lib/controller');
const { multer } = require('../../../utils');

router.use(middleware.isAuthenticated);
router.post('/addTicket', controller.addTicket);
router.put('/addMessage/:iSupportId', controller.addMessage);
router.put('/addMedia/:iSupportId', multer.s3SupportMulterUpload('aMedia'), controller.addMedia);
router.get('/listTickets', controller.listTickets);
router.get('/getTicket/:iSupportId', controller.getTicket);
router.delete('/remove/:iSupportId', controller.deleteTicket);
module.exports = router;
