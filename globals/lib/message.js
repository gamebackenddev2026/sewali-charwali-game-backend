/**
 * Push notification message
 */
const notifications = {};

const builder = {
    noLocale: (msg, code) => builder.prepare(code, '', msg),
    //
    custom: (prefix, locale = 'en') => builder.prepare(200, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: '', locale })),
    invalid_req: (prefix, locale = 'en') => builder.prepare(403, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'invalid_req', locale })),
    wrong_otp: (prefix, locale = 'en') => builder.prepare(403, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'wrong_otp', locale })),
    incorrect_email_pass: (prefix, locale = 'en') => builder.prepare(403, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'incorrect_email_pass', locale })),
    otp_sent: (prefix, locale = 'en') => builder.prepare(200, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'otp_sent', locale })),
    server_error: (prefix, locale = 'en') => builder.prepare(500, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'server_error', locale })),
    server_maintenance: (prefix, locale = 'en') => builder.prepare(500, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'server_maintenance', locale })),
    unauthorized: (prefix, locale = 'en') => builder.prepare(401, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'unauthorized', locale })),
    account_banned_fairplay: (prefix, locale = 'en') =>
        builder.prepare(401, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'account_banned_fairplay', locale })),
    account_temp_restriction_fairplay: (prefix, locale = 'en', seconds, code = 401) => {
        const body =
            seconds != null
                ? globalThis.i18n.__({ phrase: 'account_temp_restriction_fairplay', locale }, { seconds })
                : globalThis.i18n.__({ phrase: 'account_temp_restriction_fairplay_no_timer', locale });
        return builder.prepare(code, globalThis.i18n.__({ phrase: prefix, locale }), body);
    },
    inactive: (prefix, locale = 'en') => builder.prepare(403, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'inactive', locale })),
    inappropriate: (prefix, locale = 'en') => builder.prepare(403, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'inappropriate', locale })),
    need_to_claim_first: (prefix, locale = 'en') => builder.prepare(400, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'need_to_claim_first', locale })),
    already_completed: (prefix, locale = 'en') => builder.prepare(400, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'already_completed', locale })),
    not_eligible_to_claim: (prefix, locale = 'en') => builder.prepare(400, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'not_eligible_to_claim', locale })),
    insufficient: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'insufficient', locale })),
    insufficient_balance: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'insufficient_balance', locale })),
    invalid: (prefix, locale = 'en') => builder.prepare(400, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'invalid', locale })),
    invalid_hand_length: (prefix, locale = 'en') => builder.prepare(400, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'invalid_hand_length', locale })),
    not_found: (prefix, locale = 'en') => builder.prepare(404, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'not_found', locale })),
    not_matched: (prefix, locale = 'en') => builder.prepare(403, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'not_matched', locale })),
    not_completed: (prefix, locale = 'en') => builder.prepare(400, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'not_completed', locale })),
    incorrect: (prefix, locale = 'en') => builder.prepare(403, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'incorrect', locale })),
    not_allowed: (prefix, locale = 'en') => builder.prepare(405, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'not_allowed', locale })),
    not_verified: (prefix, locale = 'en') => builder.prepare(405, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'not_verified', locale })),
    verify_email: (prefix, locale = 'en') => builder.prepare(200, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'verify_email', locale })),
    no_vacant: (prefix, locale = 'en') => builder.prepare(409, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'no_vacant', locale })),
    already_registered: (prefix, locale = 'en') => builder.prepare(409, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'already_registered', locale })),
    registration_closed: (prefix, locale = 'en') => builder.prepare(409, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'registration_closed', locale })),
    already_exists: (prefix, locale = 'en') => builder.prepare(409, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'already_exists', locale })),
    already_claimed: (prefix, locale = 'en') => builder.prepare(400, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'already_claimed', locale })),
    user_deleted: (prefix, locale = 'en') => builder.prepare(406, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'user_deleted', locale })),
    user_blocked: (prefix, locale = 'en') => builder.prepare(406, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'user_blocked', locale })),
    required_field: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'required_field', locale })),
    too_many_request: (prefix, locale = 'en') => builder.prepare(429, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'too_many_request', locale })),
    expired: (prefix, locale = 'en') => builder.prepare(417, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'expired', locale })),
    canceled: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'canceled', locale })),
    created: (prefix, locale = 'en') => builder.prepare(200, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'created', locale })),
    updated: (prefix, locale = 'en') => builder.prepare(200, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'updated', locale })),
    deleted: (prefix, locale = 'en') => builder.prepare(417, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'deleted', locale })),
    blocked: (prefix, locale = 'en') => builder.prepare(401, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'blocked', locale })),
    success: (prefix, locale = 'en') => builder.prepare(200, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'success', locale })),
    successfully: (prefix, locale = 'en') => builder.prepare(200, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'successfully', locale })),
    tip_sent: (prefix, locale = 'en') => builder.prepare(200, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'TipSent', locale })),
    error: (prefix, locale = 'en') => builder.prepare(500, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'error', locale })),
    no_prefix: (prefix, locale = 'en') => builder.prepare(200, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'no_prefix', locale })),
    notifications,
    grab_card_error_table: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'can not grab Card while table - ', locale })),
    grab_card_error_player: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'can not grab Card while player - ', locale })),
    discard_card_error_table: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'can not discard card while table -', locale })),
    group_card_error_table: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'can not group hand while table - ', locale })),
    group_card_error_player: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'can not group hand while player ', locale })),
    club_created_private: (prefix, locale = 'en') => builder.prepare(200, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'club_created_private', locale })),
    only_owner_or_admin_remove_member: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner or admin can remove members', locale })),
    only_owner_or_admin_perform_action: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner or admin can perform this action', locale })),
    only_owner_perform_action: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner can perform this action', locale })),
    only_owner_can_update_club: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner can update club', locale })),
    only_owner_can_delete_club: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner can delete club', locale })),
    only_owner_can_view_join_requests: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner can view join requests', locale })),
    only_owner_can_act_on_join_requests: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner can act on join requests', locale })),
    only_owner_or_admin_promote_members: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner or admin can promote members', locale })),
    only_owner_can_promote_members_to_admin: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner can promote members to admin', locale })),
    only_owner_can_demote_members: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner can demote members', locale })),
    only_owner_or_admin_delete_messages: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner or admin can delete messages', locale })),
    only_owner_can_remove_admins: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Only club owner can remove admins', locale })),
    maximum_members_cannot_be_less_than_current_members: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'Maximum members cannot be less than current members', locale })),
    the_user_joined_another_club: (prefix, locale = 'en') => builder.prepare(419, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'The User joined another club', locale })),
    club_level_not_allowed_for_badge: (prefix, locale = 'en') =>
        builder.prepare(403, globalThis.i18n.__({ phrase: prefix, locale }), globalThis.i18n.__({ phrase: 'You cannot set this club level with your current badge', locale })),
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
