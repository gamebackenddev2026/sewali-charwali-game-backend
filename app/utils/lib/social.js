const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const social = {};

social.facebookLogin = ({ sFacebookId, accessToken }, callback = () => { }) => {
    const option = {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        url: `https://graph.facebook.com/v9.0/${sFacebookId}?fields=email,name&access_token=${accessToken}`,
    };

    _.axios(option, (err, data) => {
        if (err) return callback(err);
        const details = {
            sUserName: data.name,
            sEmail: data.email,
            sFacebookId: data.id,
        };
        callback(null, details);
    });
};

const client = jwksClient({
    jwksUri: 'https://appleid.apple.com/auth/keys',
});

function verifyJWT(json, publicKey) {
    log.console(json, publicKey);
    return jwt.verify(json, publicKey);
}

social.appleLogin = async ({ idToken }, callback = () => { }) => {
    try {
        const json = jwt.decode(idToken, { complete: true });
        const { kid } = json.header;
        const key = await client.getSigningKey(kid);
        if (!key) return;
        const publicKey = key.getPublicKey();
        if (!publicKey) return;

        const payload = jwt.decode(idToken, publicKey);
        if (!payload) return;

        const userData = {
            sEmail: payload.email,
            sAppleUserId: payload.sub,
        };
        callback(null, userData);
    } catch (error) {
        callback(error);
    }
};

module.exports = social;
