/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const url = require('url');

const configPath = path.join(__dirname, '../../../firebase.json');
if (fs.existsSync(configPath)) {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const config = require(configPath);
    admin.initializeApp({
        credential: admin.credential.cert(config),
    });
} else {
    console.warn('firebase.json not found; Firebase Admin is disabled');
}

const operations = {};

operations.generateLink = (id, code) => {
    const image = 'https://yudiz-rummyround-avatars.s3.ap-south-1.amazonaws.com/Icon(1024).png';
    const title = 'My referral Link';
    const description = `Register with my referral code ${code} and get instant bonus`;
    const _base = 'https://threecardsrumble.page.link';
    // const referral = `https://play.google.com/store/apps/details?id=com.steven.threecardsrumble?iReferredBy=${id}`;
    const referral = `https://play.google.com/store/apps/details?id=com.threecardrumble`;
    const ibi = 'com.threecardrumble';
    const isi = '';
    const URL = `${_base}?link=${referral}&ibi=${ibi}&ipbi=${ibi}&isi=${isi}&st=${title}&sd=${description}&si=${image}`;
    return url.format(URL);
};

operations.deepLink = (id, code, callback) => {
    // const body = {
    //     longDynamicLink: operations.generateLink(id, code),
    //     suffix: {
    //         option: 'UNGUESSABLE',
    //     },
    // };
    const body = {
        dynamicLinkInfo: {
            domainUriPrefix: 'https://threecardsrumble.page.link',
            link: 'https://3cardrumble.com/',
            androidInfo: {
                androidPackageName: 'com.threecardrumble',
            },
            iosInfo: {
                iosBundleId: 'com.steven.threecardsrumble',
                iosIpadBundleId: 'com.steven.threecardsrumble',
                iosFallbackLink: 'https://apps.apple.com/us/app/3-card-rumble/id6447604261',
                iosIpadFallbackLink: 'https://apps.apple.com/us/app/3-card-rumble/id6447604261',
                iosAppStoreId: '6447604261',
            },
        },
    };
    const options = {
        method: 'POST',
        hostname: 'firebasedynamiclinks.googleapis.com',
        path: `/v1/shortLinks?key=${process.env.FIREBASE_API_KEY}`,
        headers: {
            'content-type': 'application/json',
        },
        isSecure: true,
    };
    _.request(body, options, (error, success) => {
        if (error) {
            console.error(error);
            return callback(error);
        }
        // console.log('firebase response: ', success);
        callback(null, success);
    });
};

module.exports = operations;
