const router = require('express').Router();
const controllers = require('./lib/controllers');
const middleware = require('./lib/middleware');

router.use(middleware.isAuthenticated);

// Club Management Routes
router.post('/create', controllers.createClub);
router.post('/update/profile/:iClubId', middleware.isClubOwner, controllers.updateClubProfile);
// router.get('/my-club', controllers.getMyClub);
router.get('/list', controllers.listClubs);
router.get('/search', controllers.listClubs);
router.get('/:iClubId', controllers.getClub);
router.put('/update/:iClubId', middleware.isClubOwner, controllers.updateClub);
router.post('/delete/:iClubId', middleware.isClubOwner, controllers.deleteClub);
router.get('/join/:iClubId', controllers.joinClub);
router.get('/leave/:iClubId', controllers.leaveClub);
// Join request management
router.get('/join/requests/:iClubId', middleware.isClubOwner, controllers.listJoinRequests);
// Accept iRequestId and iClubId in request body (removed from params)
router.post('/join/request/action', middleware.isClubOwner, controllers.respondToJoinRequest);

// Member Management Routes
router.get('/members/:iClubId', middleware.isClubMember, controllers.getClubMembers);
router.get('/members/:iClubId/promote/:iUserId', middleware.isClubOwner, controllers.promoteMember);
router.get('/own-profile/:iClubId', middleware.isClubMember, controllers.getOwnClubProfile);

router.get('/members/:iClubId/demote/:iUserId', middleware.isClubOwner, controllers.demoteMember);
router.post('/remove/member/:iClubId/:iUserId', middleware.isClubOwnerOrAdmin, controllers.removeMember);

// Leaderboard Routes
router.get('/leaderboard/:iClubId', middleware.isClubMember, controllers.getClubLeaderboard);
// router.get('/:iClubId/my-ranking', middleware.isClubMember, controllers.getMemberContributionRanking);

// Chat Routes
// router.post('/:iClubId/chat/send', middleware.isClubMember, controllers.sendMessage);
router.get('/chat/history/:iClubId', middleware.isClubMember, controllers.getMessageHistory);
router.post('/chat/delete/:iClubId/:iMessageId', middleware.isClubOwnerOrAdmin, controllers.deleteMessage);

module.exports = router;
