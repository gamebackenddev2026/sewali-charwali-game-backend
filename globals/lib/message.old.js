const customMessages = {
    custom_message: { code: 200, message: 'custom message' },
    insufficient_balance: { code: 419, message: 'Sorry, You have insufficient balance' },
    wait_for_turn: { code: 419, message: 'Please wait for your turn.' },
    invalid_hand_length: { code: 419, message: 'Invalid hand length' },
    user_blocked: { code: 419, message: 'Your account is blocked please contact to the support' },
    user_deleted: { code: 419, message: 'Your account is deleted please contact to the support' },
};
/**
 * Push notification message
 */
const notifications = {};

const builder = {
    invalid_req: (prefix) => builder.prepare(406, prefix, 'invalid Request'),
    wrong_otp: (prefix) => builder.prepare(403, prefix, 'entered OTP is invalid'),
    server_error: (prefix) => builder.prepare(500, prefix, 'server error'),
    server_maintenance: (prefix) => builder.prepare(500, prefix, 'maintenance mode is active'),
    unauthorized: (prefix) => builder.prepare(401, prefix, 'authentication Error, please try logging again'),
    inactive: (prefix) => builder.prepare(403, prefix, 'inactive'),
    need_to_claim_first: (prefix) => builder.prepare(400, prefix, 'needs to be claimed first'),
    already_completed: (prefix) => builder.prepare(400, prefix, 'already completed'),
    not_eligible_to_claim: (prefix) => builder.prepare(400, prefix, 'not eligible to be claimed'),
    insufficient: (prefix) => builder.prepare(419, prefix, 'insufficient'),
    invalid: (prefix) => builder.prepare(400, prefix, 'invalid'),
    not_found: (prefix) => builder.prepare(404, prefix, 'not found'),
    not_matched: (prefix) => builder.prepare(406, prefix, 'not matched'),
    incorrect: (prefix) => builder.prepare(406, prefix, 'incorrect'),
    not_verified: (prefix) => builder.prepare(406, prefix, 'not verified'),
    verify_email: (prefix) => builder.prepare(200, prefix, 'verify your email'),
    already_registered: (prefix) => builder.prepare(409, prefix, 'already registered'),
    already_exists: (prefix) => builder.prepare(409, prefix, 'already exists'),
    already_claimed: (prefix) => builder.prepare(400, prefix, 'already claimed'),
    user_deleted: (prefix) => builder.prepare(406, prefix, 'deleted by admin'),
    user_blocked: (prefix) => builder.prepare(406, prefix, 'blocked by admin'),
    required_field: (prefix) => builder.prepare(419, prefix, 'field required'),
    too_many_request: (prefix) => builder.prepare(429, prefix, 'too many request'),
    expired: (prefix) => builder.prepare(417, prefix, 'expired'),
    canceled: (prefix) => builder.prepare(419, prefix, 'canceled'),
    created: (prefix) => builder.prepare(200, prefix, 'created'),
    updated: (prefix) => builder.prepare(200, prefix, 'updated'),
    deleted: (prefix) => builder.prepare(417, prefix, 'deleted'),
    blocked: (prefix) => builder.prepare(401, prefix, 'blocked'),
    success: (prefix) => builder.prepare(200, prefix, 'success'),
    successfully: (prefix) => builder.prepare(200, prefix, 'successfully'),
    error: (prefix) => builder.prepare(500, prefix, 'error'),
    no_prefix: (prefix) => builder.prepare(200, prefix, ''),
    custom: { ...customMessages },
    getString: (key) => (customMessages ? customMessages[key].message : ''),
    // custom: (key) => builder.prepare(...customMessages[key], ''),
    notifications,
    grab_card_error_table: (prefix) => builder.prepare(419, prefix, 'can not grab Card while table - '),
    grab_card_error_player: (prefix) => builder.prepare(419, prefix, 'can not grab Card while player - '),
    discard_card_error_table: (prefix) => builder.prepare(419, prefix, 'can not discard card while table -'),
    group_card_error_table: (prefix) => builder.prepare(419, prefix, 'can not group hand while table - '),
    group_card_error_player: (prefix) => builder.prepare(419, prefix, 'can not group hand while player '),
};

Object.defineProperty(builder, 'prepare', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: (code, prefix, message) => ({
        code,
        message: `${prefix ? `${prefix} ${message}` : message}`,
    }),
});

module.exports = builder;
