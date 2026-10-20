/* eslint-disable no-nested-ternary */
/* eslint-disable import/no-unresolved, global-require */
const axios = require('axios');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { VipSubscription, VipSubscriptionUser, User, InAppPurchaseUser } = require('../../../../models');
const { mongodb } = require('../../../../utils');

const controllers = {};

const getGoogleAuth = () => {
    const scopes = ['https://www.googleapis.com/auth/androidpublisher'];
    const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    const keyFile = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_FILE;
    if (raw) {
        let credentials;
        try {
            credentials = JSON.parse(raw);
        } catch (e) {
            throw new Error('Invalid GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
        }
        return new google.auth.GoogleAuth({ credentials, scopes });
    }
    // Preferred: key file path from env; otherwise fallback to repo-root firebase.json (as used in other projects).
    const keyFilePath = keyFile || path.resolve(__dirname, '../../../../../firebase.json');
    if (keyFilePath && fs.existsSync(keyFilePath)) {
        return new google.auth.GoogleAuth({ keyFile: keyFilePath, scopes });
    }
    throw new Error('Google Play credentials not configured (set GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)');
};

const getAndroidPublisher = () => google.androidpublisher({ version: 'v3', auth: getGoogleAuth() });

// Simple add subscription (admin panel)
// controllers.add = async (req, res) => {
//     try {
//         const body = _.pick(req.body, ['sPackageName', 'sku', 'sTitle', 'sDescription', 'sCurrency', 'sPrice', 'nDuration']);
//         if (!body.sPackageName) return res.reply(message.required_field('sPackageName'));
//         if (!body.sku) return res.reply(message.required_field('sku'));
//         if (!body.sTitle) return res.reply(message.required_field('sTitle'));
//         if (!body.sDescription) return res.reply(message.required_field('sDescription'));
//         if (!body.sCurrency) return res.reply(message.required_field('sCurrency'));
//         if (!body.sPrice) return res.reply(message.required_field('sPrice'));
//         if (!body.nDuration) return res.reply(message.required_field('nDuration'));

//         const vipSubscriptionData = await VipSubscription.create(body);
//         return res.reply(message.successfully('VIP Subscription Added'), { vipSubscriptionData });
//     } catch (error) {
//         log.error('vip.add error', error);
//         return res.reply(message.server_error(), error);
//     }
// };

controllers.list = async (req, res) => {
    try {
        const now = Date.now();
        const [vipData, userPurchases] = await Promise.all([
            VipSubscription.find({}).sort({ dCreatedDate: -1 }).lean().select('-dCreatedDate -dUpdatedDate -__v'),
            VipSubscriptionUser.find({
                iUserId: mongodb.mongify(req.user._id),
                eStatus: 'ACTIVE',
                nExpiryTimeMillis: { $gt: now },
            })
                .sort({ dCreatedDate: -1, _id: -1 })
                .lean()
                .select('iVipSubscriptionId sProductId nExpiryTimeMillis'),
        ]);
        const latestActive = userPurchases[0] || null;
        const planIsLatestPurchase = (plan) => {
            if (!latestActive) return false;
            const pid = latestActive.iVipSubscriptionId ? String(latestActive.iVipSubscriptionId) : '';
            if (pid && String(plan._id) === pid) return true;
            const storeId = latestActive.sProductId || '';
            if (!storeId) return false;
            return (plan.sku && plan.sku === storeId) || (plan.sPackageName && plan.sPackageName === storeId);
        };

        const vipDataWithPurchase = vipData.map((plan) => {
            const isPurchased = planIsLatestPurchase(plan);
            // find the matching purchase for this plan
            let matchedUserPurchase = null;
            let timeToExpire;
            if (isPurchased && latestActive) {
                // Direct id match
                if (latestActive.iVipSubscriptionId && String(plan._id) === String(latestActive.iVipSubscriptionId)) {
                    matchedUserPurchase = latestActive;
                } else if ((plan.sku && plan.sku === latestActive.sProductId) || (plan.sPackageName && plan.sPackageName === latestActive.sProductId)) {
                    matchedUserPurchase = latestActive;
                }
                if (matchedUserPurchase && typeof matchedUserPurchase.nExpiryTimeMillis === 'number') {
                    timeToExpire = Math.max(matchedUserPurchase.nExpiryTimeMillis - now, 0); // in ms
                }
            }
            return {
                ...plan,
                isPurchased,
                nExpiryTimeMillis: matchedUserPurchase ? matchedUserPurchase.nExpiryTimeMillis : undefined,
                timeToExpire: typeof timeToExpire === 'number' ? timeToExpire : undefined, // ms until it expires
            };
        });

        return res.reply(message.successfully('Vip Subscriptions fetched'), { vipData: vipDataWithPurchase });
    } catch (error) {
        log.error('vip.list error', error);
        return res.reply(message.server_error(), error);
    }
};

// Simple purchase endpoint (fallback / test) — upgrades user to vip
controllers.iosPurchase = async (req, res) => {
    try {
        const body = _.pick(req.body, ['receiptData']);

        if (body.receiptData) {
            const rawReceipt = body.receiptData;
            let parsedWrapper = null;
            try {
                parsedWrapper = JSON.parse(rawReceipt);
            } catch (e) {
                parsedWrapper = null;
            }

            const receiptPayload = parsedWrapper?.Payload || rawReceipt;
            const clientTransactionId = parsedWrapper?.TransactionID || null;

            const sharedSecret = process.env.APPLE_SHARED_SECRET || '';
            if (!sharedSecret) {
                return res.reply(message.server_error('Server not configured for iOS verification', req.query?.eLocale || 'en'));
            }

            const verifyEndpointProd = 'https://buy.itunes.apple.com/verifyReceipt';
            const verifyEndpointSandbox = 'https://sandbox.itunes.apple.com/verifyReceipt';
            const payload = {
                'receipt-data': typeof receiptPayload === 'string' ? receiptPayload.trim() : '',
                password: sharedSecret,
                'exclude-old-transactions': true,
            };

            const callApple = async (url) => {
                const resp = await axios.post(url, payload, { timeout: 10000 });
                return resp.data;
            };

            let appleResp;
            try {
                appleResp = await callApple(verifyEndpointProd);
                if (appleResp && appleResp.status === 21007) {
                    appleResp = await callApple(verifyEndpointSandbox);
                }
            } catch (err) {
                return res.reply(message.server_error('Failed to verify receipt with Apple', req.query?.eLocale || 'en'));
            }

            if (!appleResp || appleResp.status !== 0) {
                return res.reply(message.server_error('Receipt verification failed', req.query?.eLocale || 'en'), { appleStatus: appleResp?.status, raw: appleResp });
            }

            // Find in_app record
            const inApp = appleResp?.latest_receipt_info || appleResp?.receipt?.in_app || [];
            let matched = null;
            if (Array.isArray(inApp) && inApp.length > 0) {
                if (clientTransactionId) {
                    matched = inApp.find((t) => t.transaction_id === clientTransactionId || t.original_transaction_id === clientTransactionId) || null;
                }
                if (!matched) {
                    // pick latest
                    matched = inApp[inApp.length - 1];
                }
            }

            const expiryMs = matched?.expires_date_ms ? Number(matched.expires_date_ms) : matched?.expires_date ? Date.parse(matched.expires_date) : 0;
            const productId = matched?.product_id || body.productId || '';
            const transactionId = matched?.transaction_id || matched?.original_transaction_id || body.transactionId || '';

            // Resolve VIP plan from Apple product id so list API can mark purchased plans by iVipSubscriptionId.
            let vipPlan = null;
            if (productId) {
                vipPlan = await VipSubscription.findOne({ $or: [{ sku: productId }, { sPackageName: productId }] })
                    .select('_id')
                    .lean();
            }

            const subData = {
                iUserId: req.user._id,
                iVipSubscriptionId: vipPlan?._id || null,
                sProductId: productId,
                sPurchaseToken: matched?.transaction_id,
                sOrderId: matched?.original_transaction_id,
                nExpiryTimeMillis: expiryMs,
                isAutoRenewing: true,
                eStatus: expiryMs > Date.now() ? 'ACTIVE' : 'EXPIRED',
            };

            // Always insert a new purchase entry.
            await VipSubscriptionUser.create(subData);

            // Update user vip expiry
            const userUpdate = { dVipExpiresAt: new Date(expiryMs) };
            if (expiryMs > Date.now()) userUpdate.eUserType = 'vip';
            await User.updateOne({ _id: req.user._id }, { $set: userUpdate });

            return res.reply(message.successfully('VIP Subscription Purchased'), {
                productId,
                transactionId,
                expiryTimeMillis: expiryMs,
                isVip: expiryMs > Date.now(),
            });
        }

        // If no iOS receipt provided, reject - this controller is iOS-only
        return res.reply(message.required_field('receiptData', req.query?.eLocale || 'en'));
    } catch (error) {
        log.error('vip.purchase error', error);
        return res.reply(message.server_error(), error);
    }
};

/**
 * Android VIP subscription purchase verification (Google Play).
 * Body:
 * - sProductId: subscriptionId in Play Console (required)
 * - sPurchaseToken: purchaseToken from the device (required)
 * - sPackageName: app package name (optional; otherwise env GOOGLE_PLAY_PACKAGE_NAME or VIP plan sPackageName)
 */
controllers.androidPurchase = async (req, res) => {
    try {
        const locale = req.query?.eLocale || 'en';

        // Accept both legacy flat body fields and `receiptData` wrapper (object or JSON string)
        const rawReceiptData = req.body?.receiptData;
        let parsedReceiptData = null;
        if (rawReceiptData && typeof rawReceiptData === 'object') {
            parsedReceiptData = rawReceiptData;
        } else if (typeof rawReceiptData === 'string') {
            try {
                parsedReceiptData = JSON.parse(rawReceiptData);
            } catch (e) {
                parsedReceiptData = null;
            }
        }

        // Some clients wrap it like { receiptData: { ... } } or { receiptData: { data: { ... } } }
        const receiptObj = parsedReceiptData?.data && typeof parsedReceiptData.data === 'object' ? parsedReceiptData.data : parsedReceiptData;

        // receiptData (android) is typically wrapped like:
        // { Payload: "{\"json\":\"{...purchaseToken...}\", ...}", Store: "GooglePlay", TransactionID: "..." }
        // so we need to parse both `Payload` and its inner `json`.
        let payloadObj = null;
        const payloadRaw = receiptObj?.Payload || receiptObj?.payload || null;
        if (payloadRaw && typeof payloadRaw === 'object') {
            payloadObj = payloadRaw;
        } else if (typeof payloadRaw === 'string') {
            try {
                payloadObj = JSON.parse(payloadRaw);
            } catch (e) {
                payloadObj = null;
            }
        }

        let payloadJsonObj = null;
        const payloadJsonRaw = payloadObj?.json || payloadObj?.payload || null;
        if (payloadJsonRaw && typeof payloadJsonRaw === 'object') {
            payloadJsonObj = payloadJsonRaw;
        } else if (typeof payloadJsonRaw === 'string') {
            try {
                payloadJsonObj = JSON.parse(payloadJsonRaw);
            } catch (e) {
                payloadJsonObj = null;
            }
        }

        const body = {
            ..._.pick(req.body || {}, ['sProductId', 'sPurchaseToken', 'sPackageName']),
            sProductId: (req.body && (req.body.sProductId || req.body.productId || req.body.subscriptionId || req.body.sku)) || payloadJsonObj?.productId || (receiptObj && (receiptObj.sProductId || receiptObj.productId || receiptObj.subscriptionId || receiptObj.sku)) || '',
            sPurchaseToken: (req.body && (req.body.sPurchaseToken || req.body.purchaseToken || req.body.token)) || payloadJsonObj?.purchaseToken || receiptObj?.TransactionID || receiptObj?.transactionId || (receiptObj && (receiptObj.sPurchaseToken || receiptObj.purchaseToken || receiptObj.token)) || '',
            sPackageName: (req.body && (req.body.sPackageName || req.body.packageName || req.body.package)) || payloadJsonObj?.packageName || (receiptObj && (receiptObj.sPackageName || receiptObj.packageName || receiptObj.package)) || '',
        };

        if (!body.sProductId) return res.reply(message.required_field('sProductId', locale));
        if (!body.sPurchaseToken) return res.reply(message.required_field('sPurchaseToken', locale));

        const vipPlan = await VipSubscription.findOne({
            $or: [{ sku: body.sProductId }, { sPackageName: body.sProductId }],
        })
            .select('_id sPackageName sku')
            .lean();

        const packageName = body.sPackageName || process.env.GOOGLE_PLAY_PACKAGE_NAME || vipPlan?.sPackageName || '';
        if (!packageName) return res.reply(message.required_field('sPackageName', locale));

        let googleResp;
        try {
            const androidpublisher = getAndroidPublisher();
            const resp = await androidpublisher.purchases.subscriptions.get({
                packageName,
                subscriptionId: body.sProductId,
                token: body.sPurchaseToken,
            });
            googleResp = resp?.data;
        } catch (err) {
            const apiErr = err?.response?.data || err?.errors || err?.message || err;
            log.error('vip.androidPurchase google verify error', apiErr);
            return res.reply(message.server_error('Failed to verify purchase with Google', locale), { error: apiErr });
        }

        const expiryMs = googleResp?.expiryTimeMillis ? Number(googleResp.expiryTimeMillis) : 0;
        const orderId = googleResp?.orderId || null;
        const isAutoRenewing = Boolean(googleResp?.autoRenewing);
        // paymentState: 0 pending, 1 received, 2 free trial, 3 pending deferred
        const paymentState = googleResp?.paymentState;
        const now = Date.now();
        const isActive = expiryMs > now;

        await VipSubscriptionUser.create({
            iUserId: req.user._id,
            iVipSubscriptionId: vipPlan?._id || null,
            sProductId: body.sProductId,
            sPurchaseToken: body.sPurchaseToken,
            sOrderId: orderId,
            nExpiryTimeMillis: expiryMs,
            isAutoRenewing,
            eStatus: isActive ? 'ACTIVE' : 'EXPIRED',
        });

        const userUpdate = { dVipExpiresAt: expiryMs ? new Date(expiryMs) : null };
        if (isActive) userUpdate.eUserType = 'vip';
        await User.updateOne({ _id: req.user._id }, { $set: userUpdate });

        return res.reply(message.successfully('VIP Subscription Purchased', locale), {
            platform: 'android',
            packageName,
            productId: body.sProductId,
            orderId,
            purchaseToken: body.sPurchaseToken,
            expiryTimeMillis: expiryMs,
            isAutoRenewing,
            paymentState,
            isVip: isActive,
        });
    } catch (error) {
        log.error('vip.androidPurchase error', error);
        return res.reply(message.server_error(), error);
    }
};

/**
 * Android in-app purchase log (coins + remove ads).
 * Body:
 * - sProductId: in-app product id (required)
 * - sPurchaseToken: purchase token (required)
 * - sPackageName: package name (optional; defaults env GOOGLE_PLAY_PACKAGE_NAME)
 * - nAmount / nCoins / ePurchaseType: same as iOS endpoint
 */
controllers.manageAndroidInAppPurchase = async (req, res) => {
    try {
        const locale = req.query?.eLocale || 'en';
        // Keep request body compatible with iOS (`receiptData` + optional fields),
        // while also supporting legacy Android flat fields.
        const picked = _.pick(req.body, ['receiptData', 'sProductId', 'nAmount', 'ePurchaseType', 'nCoins']);

        if (!picked.receiptData) {
            return res.reply(message.required_field('receiptData', locale));
        }

        // Accept `receiptData` as object or JSON string, similar to `androidPurchase`.
        const rawReceiptData = req.body?.receiptData;
        let parsedReceiptData = null;
        if (rawReceiptData && typeof rawReceiptData === 'object') {
            parsedReceiptData = rawReceiptData;
        } else if (typeof rawReceiptData === 'string') {
            try {
                parsedReceiptData = JSON.parse(rawReceiptData);
            } catch (e) {
                parsedReceiptData = null;
            }
        }
        const receiptObj = parsedReceiptData?.data && typeof parsedReceiptData.data === 'object' ? parsedReceiptData.data : parsedReceiptData;

        // receiptData (android) is typically wrapped like:
        // { Payload: "{\"json\":\"{...purchaseToken...}\", ...}", Store: "GooglePlay", TransactionID: "..." }
        // so we need to parse both `Payload` and its inner `json`.
        let payloadObj = null;
        const payloadRaw = receiptObj?.Payload || receiptObj?.payload || null;
        if (payloadRaw && typeof payloadRaw === 'object') {
            payloadObj = payloadRaw;
        } else if (typeof payloadRaw === 'string') {
            try {
                payloadObj = JSON.parse(payloadRaw);
            } catch (e) {
                payloadObj = null;
            }
        }

        let payloadJsonObj = null;
        const payloadJsonRaw = payloadObj?.json || payloadObj?.payload || null;
        if (payloadJsonRaw && typeof payloadJsonRaw === 'object') {
            payloadJsonObj = payloadJsonRaw;
        } else if (typeof payloadJsonRaw === 'string') {
            try {
                payloadJsonObj = JSON.parse(payloadJsonRaw);
            } catch (e) {
                payloadJsonObj = null;
            }
        }

        const sProductId = picked.sProductId || req.body?.productId || req.body?.sku || payloadJsonObj?.productId || receiptObj?.sProductId || receiptObj?.productId || receiptObj?.sku || '';
        const purchaseToken = req.body?.purchaseToken || req.body?.token || payloadJsonObj?.purchaseToken || receiptObj?.TransactionID || receiptObj?.transactionId || receiptObj?.token || '';
        const sPackageName = req.body?.packageName || req.body?.package || payloadJsonObj?.packageName || receiptObj?.sPackageName || receiptObj?.packageName || receiptObj?.package || '';

        const body = {
            ...picked,
            sProductId,
            sPackageName,
        };

        const purchaseType = String(body.ePurchaseType || 'COIN').toUpperCase();
        if (!body.sProductId) return res.reply(message.required_field('sProductId', locale));
        if (!purchaseToken) return res.reply(message.required_field('sPurchaseToken', locale));
        if (!['COIN', 'REMOVE_ADS'].includes(purchaseType)) {
            return res.reply(message.invalid('ePurchaseType must be COIN or REMOVE_ADS', locale));
        }

        const packageName = body.sPackageName || process.env.GOOGLE_PLAY_PACKAGE_NAME || '';
        if (!packageName) return res.reply(message.required_field('sPackageName', locale));

        let googleResp;
        try {
            const androidpublisher = getAndroidPublisher();
            const resp = await androidpublisher.purchases.products.get({
                packageName,
                productId: body.sProductId,
                token: purchaseToken,
            });
            googleResp = resp?.data;
        } catch (err) {
            const apiErr = err?.response?.data || err?.errors || err?.message || err;
            log.error('vip.manageAndroidInAppPurchase google verify error', apiErr);
            return res.reply(message.server_error('Failed to verify purchase with Google', locale), { error: apiErr });
        }

        // purchaseState: 0 Purchased, 1 Canceled, 2 Pending
        const purchaseState = googleResp?.purchaseState;
        const isPurchased = purchaseState === 0;
        const orderId = googleResp?.orderId || null;
        await InAppPurchaseUser.create({
            iUserId: req.user._id,
            sProductId: body.sProductId,
            sPurchaseToken: purchaseToken,
            sOrderId: orderId,
            sPlatform: 'android',
            nAmount: body.nAmount,
            eStatus: isPurchased ? 'SUCCESS' : purchaseState === 2 ? 'PENDING' : 'FAILED',
            nCoins: purchaseType === 'COIN' ? body.nCoins : 0,
            isVerified: isPurchased,
            ePurchaseType: purchaseType,
        });

        if (!isPurchased) {
            return res.reply(message.invalid('Purchase not completed', locale), {
                purchaseState,
                orderId,
                productId: body.sProductId,
            });
        }

        if (purchaseType === 'REMOVE_ADS') {
            return res.reply(message.successfully('Remove ads purchase logged', locale), {
                ePurchaseType: 'REMOVE_ADS',
                productId: body.sProductId,
                orderId,
            });
        }

        return res.reply(message.successfully('Coins Purchased', locale), {
            ePurchaseType: 'COIN',
            productId: body.sProductId,
            orderId,
            coins: body.nAmount,
        });
    } catch (error) {
        log.error('vip.manageAndroidInAppPurchase error', error);
        return res.reply(message.server_error(), error);
    }
};

/**
 * Apple subscription webhook (public endpoint)
 * Supports App Store Server Notifications v2 (signedPayload) or a simplified JSON payload.
 * IMPORTANT: This endpoint should be protected with a shared secret header at minimum.
 */

controllers.appleWebhook = async (req, res) => {
    try {
        const payload = req.body || {};
        log.info('appleWebhook', {
            phase: 'received',
            bodyKeys: Object.keys(payload),
            signedPayloadLen: (payload?.signedPayload || payload?.data?.signedPayload || '').length || 0,
        });

        const signedPayload = payload?.signedPayload || payload?.data?.signedPayload;
        if (!signedPayload) {
            log.error('appleWebhook', { phase: 'missing_signed_payload', bodyKeys: Object.keys(payload) });
            return res.status(200).json({ message: 'ok' });
        }

        const decodedNotification = _.decodeJwtPayload(signedPayload);
        const notificationType = decodedNotification?.notificationType || payload?.notificationType || '';
        const subtype = decodedNotification?.subtype || payload?.subtype || '';
        const environment = decodedNotification?.data?.environment || 'UNKNOWN';
        const notificationUUID = decodedNotification?.notificationUUID || decodedNotification?.data?.notificationUUID || null;
        const bundleId = decodedNotification?.data?.bundleId || decodedNotification?.bundleId || null;
        const appAppleId = decodedNotification?.data?.appAppleId || null;

        log.info('appleWebhook', {
            phase: 'notification_decoded',
            notificationUUID: notificationUUID || undefined,
            notificationType: notificationType || undefined,
            subtype: subtype || undefined,
            environment,
            bundleId: bundleId || undefined,
            appAppleId: appAppleId || undefined,
            version: decodedNotification?.version || undefined,
        });

        const signedTransactionInfo = decodedNotification?.data?.signedTransactionInfo || payload?.signedTransactionInfo;
        const signedRenewalInfo = decodedNotification?.data?.signedRenewalInfo || payload?.signedRenewalInfo;

        const decodedTxn = signedTransactionInfo ? _.decodeJwtPayload(signedTransactionInfo) : null;
        const decodedRenewal = signedRenewalInfo ? _.decodeJwtPayload(signedRenewalInfo) : null;

        log.info('appleWebhook', {
            phase: 'jwts_decoded',
            hasTransactionJws: Boolean(signedTransactionInfo),
            hasRenewalJws: Boolean(signedRenewalInfo),
            renewalAutoRenewStatus: decodedRenewal?.autoRenewStatus ?? undefined,
        });

        const productId = decodedTxn?.productId || payload?.productId || payload?.sProductId || '';
        const transactionId = decodedTxn?.transactionId || payload?.transactionId || payload?.sPurchaseToken || '';
        const originalTransactionId = decodedTxn?.originalTransactionId || payload?.originalTransactionId || payload?.sOrderId || '';
        const expiresMsRaw = decodedTxn?.expiresDate || payload?.expiresDateMs || payload?.expires_date_ms || payload?.nExpiryTimeMillis || 0;
        const expiryMs = expiresMsRaw ? Number(expiresMsRaw) : 0;

        const appleTxnType = decodedTxn?.type || null;
        const appleTxnReason = decodedTxn?.transactionReason || null;
        const appleOwnership = decodedTxn?.inAppOwnershipType || null;
        const revocationReason = decodedTxn?.revocationReason != null ? Number(decodedTxn.revocationReason) : null;
        const revocationMs = decodedTxn?.revocationDate ? Number(decodedTxn.revocationDate) : 0;
        const dAppleRevocationAt = revocationMs > 0 ? new Date(revocationMs) : null;

        log.info('appleWebhook', {
            phase: 'parsed',
            notificationType: notificationType || undefined,
            subtype: subtype || undefined,
            environment,
            productId: productId || undefined,
            transactionId: transactionId || undefined,
            originalTransactionId: originalTransactionId || undefined,
            expiryMs: expiryMs || undefined,
            appleTxnType: appleTxnType || undefined,
            appleTxnReason: appleTxnReason || undefined,
            appleOwnership: appleOwnership || undefined,
            revocationReason: revocationReason ?? undefined,
        });

        const now = Date.now();

        const forceExpiredTypes = new Set(['EXPIRED', 'DID_FAIL_TO_RENEW', 'GRACE_PERIOD_EXPIRED', 'REVOKE', 'REFUND']);

        const forceExpired = forceExpiredTypes.has(notificationType);
        const isExpiredByDate = expiryMs > 0 && expiryMs <= now;
        const isExpired = forceExpired || isExpiredByDate;

        const isActive = !isExpired && (expiryMs > now || ['SUBSCRIBED', 'DID_RENEW', 'DID_RECOVER', 'RENEWAL_EXTENDED'].includes(notificationType));

        const isAutoRenewing = ['1', 1, true].includes(decodedRenewal?.autoRenewStatus) || payload?.isAutoRenewing;

        log.info('appleWebhook', {
            phase: 'lifecycle',
            forceExpired,
            isExpiredByDate,
            isExpired,
            isActive,
            isAutoRenewing,
            now,
            expiryMs: expiryMs || undefined,
        });

        if (!transactionId && !originalTransactionId && !productId) {
            log.error('appleWebhook', { phase: 'missing_identifiers', notificationType, subtype, environment });
            return res.status(200).json({ message: 'ok' });
        }

        const orMatch = [];
        if (originalTransactionId) {
            orMatch.push({ sOrderId: originalTransactionId });
        }
        if (transactionId) {
            orMatch.push({ sOrderId: transactionId }, { sPurchaseToken: transactionId });
        }
        if (!orMatch.length) {
            log.error('appleWebhook', { phase: 'no_transaction_match_keys', notificationType, subtype, productId: productId || undefined });
            return res.status(200).json({ message: 'ok' });
        }
        const match = { $or: orMatch };
        if (productId) match.sProductId = productId;

        // 🔹 Update object
        const update = {
            ...(productId ? { sProductId: productId } : {}),
            ...(transactionId ? { sPurchaseToken: transactionId } : {}),
            ...(originalTransactionId ? { sOrderId: originalTransactionId } : {}),
            ...(expiryMs ? { nExpiryTimeMillis: expiryMs } : {}),
            sLastWebhookNotificationType: notificationType || null,
            sLastWebhookSubtype: subtype || null,
            sAppleTransactionType: appleTxnType || null,
            sAppleTransactionReason: appleTxnReason || null,
            sAppleInAppOwnershipType: appleOwnership || null,
            nAppleRevocationReason: revocationReason,
            dAppleRevocationAt,
            isAutoRenewing,
            eStatus: isActive ? 'ACTIVE' : 'EXPIRED',
        };

        const subUser = await VipSubscriptionUser.findOneAndUpdate(match, { $set: update }, { new: true, sort: { dCreatedDate: -1 } }).lean();

        if (!subUser?.iUserId) {
            log.error('appleWebhook', {
                phase: 'subscription_not_found',
                notificationType,
                subtype,
                environment,
                productId: productId || undefined,
                transactionId: transactionId || undefined,
                originalTransactionId: originalTransactionId || undefined,
            });
            return res.status(200).json({ message: 'ok' });
        }

        const userUpdate = {
            eUserType: isActive ? 'vip' : 'user',
        };

        if (expiryMs) {
            userUpdate.dVipExpiresAt = new Date(expiryMs);
        }

        const userUpdateResult = await User.updateOne({ _id: subUser.iUserId }, { $set: userUpdate });
        log.info('appleWebhook', {
            phase: 'user_vip_updated',
            iUserId: String(subUser.iUserId),
            nMatched: userUpdateResult.n,
            nModified: userUpdateResult.nModified,
            userUpdate,
        });

        await _.privateEmit(subUser.iUserId.toString(), 'resVipStatusUpdate', {
            eStatus: update.eStatus,
            isVip: isActive,
            isExpired,
            nExpiryTimeMillis: expiryMs,
            sProductId: productId || subUser.sProductId || '',
            notificationType,
            subtype,
            environment,
            appleTxnType: appleTxnType || undefined,
            appleTxnReason: appleTxnReason || undefined,
        });

        log.info('appleWebhook', {
            phase: 'complete',
            notificationUUID: notificationUUID || undefined,
            iUserId: String(subUser.iUserId),
            subscriptionId: subUser?._id ? String(subUser._id) : undefined,
            notificationType,
            subtype,
            environment,
            eStatus: update.eStatus,
            isVip: isActive,
            productId: productId || undefined,
            transactionId: transactionId || undefined,
            originalTransactionId: originalTransactionId || undefined,
            nExpiryTimeMillis: expiryMs || undefined,
            appleTxnType: appleTxnType || undefined,
            appleTxnReason: appleTxnReason || undefined,
        });

        return res.status(200).json({ message: 'ok' });
    } catch (error) {
        log.error('appleWebhook', {
            phase: 'error',
            err: error?.message || String(error),
            stack: error?.stack,
        });
        return res.status(200).json({ message: 'ok' });
    }
};

// iOS in-app purchase log (coins + remove ads). Body: ePurchaseType COIN | REMOVE_ADS (default COIN).
controllers.manageIosInAppPurchase = async (req, res) => {
    try {
        const body = _.pick(req.body, ['receiptData', 'sProductId', 'nAmount', 'ePurchaseType', 'nCoins']);
        const purchaseType = String(body.ePurchaseType || 'COIN').toUpperCase();

        if (!body.receiptData) {
            return res.reply(message.required_field('receiptData', req.query?.eLocale || 'en'));
        }
        if (!['COIN', 'REMOVE_ADS'].includes(purchaseType)) {
            return res.reply(message.invalid('ePurchaseType must be COIN or REMOVE_ADS', req.query?.eLocale || 'en'));
        }

        const rawReceipt = body.receiptData;
        let parsedWrapper = null;
        try {
            parsedWrapper = JSON.parse(rawReceipt);
        } catch (e) {
            parsedWrapper = null;
        }

        const receiptPayload = parsedWrapper?.Payload || rawReceipt;
        const clientTransactionId = parsedWrapper?.TransactionID || null;

        const sharedSecret = process.env.APPLE_SHARED_SECRET || '';
        if (!sharedSecret) {
            return res.reply(message.server_error('Server not configured for iOS verification', req.query?.eLocale || 'en'));
        }

        const verifyEndpointProd = 'https://buy.itunes.apple.com/verifyReceipt';
        const verifyEndpointSandbox = 'https://sandbox.itunes.apple.com/verifyReceipt';
        const payload = {
            'receipt-data': typeof receiptPayload === 'string' ? receiptPayload.trim() : '',
            password: sharedSecret,
            'exclude-old-transactions': true,
        };

        const callApple = async (url) => {
            const resp = await axios.post(url, payload, { timeout: 10000 });
            return resp.data;
        };

        let appleResp;
        try {
            appleResp = await callApple(verifyEndpointProd);
            if (appleResp && appleResp.status === 21007) {
                appleResp = await callApple(verifyEndpointSandbox);
            }
        } catch (err) {
            return res.reply(message.server_error('Failed to verify receipt with Apple', req.query?.eLocale || 'en'));
        }

        if (!appleResp || appleResp.status !== 0) {
            return res.reply(message.server_error('Receipt verification failed', req.query?.eLocale || 'en'), { appleStatus: appleResp?.status, raw: appleResp });
        }

        const inApp = appleResp?.latest_receipt_info || appleResp?.receipt?.in_app || [];
        let matched = null;
        if (Array.isArray(inApp) && inApp.length > 0) {
            if (clientTransactionId) {
                matched = inApp.find((t) => t.transaction_id === clientTransactionId || t.original_transaction_id === clientTransactionId) || null;
            }
            if (!matched) {
                matched = inApp[inApp.length - 1];
            }
        }

        if (!matched) {
            return res.reply(message.invalid('No matching transaction in receipt', req.query?.eLocale || 'en'));
        }

        const transactionId = matched.transaction_id || clientTransactionId;
        const originalTransactionId = matched.original_transaction_id || transactionId;
        if (!transactionId) {
            return res.reply(message.invalid('Missing transaction id', req.query?.eLocale || 'en'));
        }

        const storeProductId = matched.product_id || body.sProductId;
        if (!storeProductId) {
            return res.reply(message.invalid('Missing product id', req.query?.eLocale || 'en'));
        }

        await InAppPurchaseUser.create({
            iUserId: req.user._id,
            sProductId: storeProductId,
            sPurchaseToken: transactionId,
            sOrderId: originalTransactionId,
            sPlatform: 'ios',
            nAmount: body.nAmount,
            eStatus: 'SUCCESS',
            nCoins: purchaseType === 'COIN' ? body.nCoins : 0,
            isVerified: true,
            ePurchaseType: purchaseType,
        });

        if (purchaseType === 'REMOVE_ADS') {
            return res.reply(message.successfully('Remove ads purchase logged', req.query?.eLocale || 'en'), {
                ePurchaseType: 'REMOVE_ADS',
                productId: storeProductId,
                clientTransactionId: transactionId,
            });
        }

        return res.reply(message.successfully('Coins Purchased', req.query?.eLocale || 'en'), {
            ePurchaseType: 'COIN',
            productId: storeProductId,
            clientTransactionId: transactionId,
            coins: body.nAmount,
        });
    } catch (error) {
        log.error('vip.manageIosInAppPurchase error', error);
        return res.reply(message.server_error(), error);
    }
};
module.exports = controllers;
