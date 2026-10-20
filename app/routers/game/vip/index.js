const router = require('express').Router();
const controllers = require('./lib/controllers');
const middleware = require('./lib/middleware');

// Admin: add new vip plan (keep commented if not needed)
// router.post('/add', controllers.add);

// RTDN endpoint for Google (keep commented until you expose a public endpoint)
// router.post('/rtdn/google', controllers.handleRTDN);
router.post('/webhook/apple', controllers.appleWebhook); // public

router.use(middleware.isAuthenticated);
// router.use(middleware.vipCheck);

// iOS purchase verification route (accepts receiptData in body; no VIP id in params)
router.post('/purchase/ios', controllers.iosPurchase);

router.post('/purchase/ios/in-app', controllers.manageIosInAppPurchase);

// Android purchase verification routes
router.post('/purchase/android', controllers.androidPurchase);
router.post('/purchase/android/in-app', controllers.manageAndroidInAppPurchase);

// legacy/generic route (Android purchaseToken flow / fallback)
// router.post('/purchase/:iVipSubscriptionId', controllers.purchase);
router.get('/list', controllers.list);

module.exports = router;
