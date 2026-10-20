const mongoose = require('mongoose');
const { Club, ClubMember, ClubChat, User, TableHistory, ClubJoinRequest } = require('../../../../models');
const { mongodb, s3 } = require('../../../../utils');

const controllers = {};

/**
 * Emit to all active club members so clients can refresh `GET /club/members/:iClubId`
 * @param {import('mongoose').Types.ObjectId} iClubIdObj
 * @param {import('mongoose').Types.ObjectId | string} [excludeUserId] - optional user to skip
 */
async function emitRefreshClubMembers(iClubIdObj, excludeUserId) {
    if (!iClubIdObj) return;
    const clubMembers = await ClubMember.find({ iClubId: iClubIdObj, eStatus: 'active' }).select('iUserId').lean();

    const emitData = { iClubId: iClubIdObj.toString() };
    const targets = excludeUserId == null ? clubMembers : clubMembers.filter((m) => m.iUserId.toString() !== excludeUserId.toString());
    await Promise.all(targets.map((m) => _.privateEmit(m.iUserId.toString(), 'resRefreshClubMembers', emitData)));
}

/**
 * Resolve club profile fields.
 * - Default icon: nClubProfile >= 0 (0-based index), sProfileImage = ''
 * - Custom upload: sProfileImage set, nClubProfile = -1
 */
function resolveClubProfile({ nClubProfile, sProfileImage } = {}) {
    const image = typeof sProfileImage === 'string' ? sProfileImage.trim() : '';
    if (image) {
        return { nClubProfile: -1, sProfileImage: image };
    }

    let index = 0;
    if (nClubProfile !== undefined && nClubProfile !== null && nClubProfile !== '') {
        index = parseInt(nClubProfile, 10);
    }
    if (Number.isNaN(index) || index < 0) index = 0;

    return { nClubProfile: index, sProfileImage: '' };
}

/** Club levels an owner can set, based on their eBadges. */
function getAllowedClubLevels(ownerBadge) {
    const badge = String(ownerBadge || 'beginner').toLowerCase();
    if (badge === 'expert') return ['beginner', 'intermediate', 'expert'];
    if (badge === 'intermediate') return ['beginner', 'intermediate'];
    return ['beginner'];
}

/**
 * Unity WWWForm sends oFile as a JSON string:
 * { "name": "clubprofilepic", "base64": "<raw png base64>" }
 */
function parseClubOFile(oFile) {
    if (!oFile) return null;
    let parsed = oFile;
    if (typeof oFile === 'string') {
        parsed = _.parse(oFile);
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const rawName = String(parsed.name || '').toLowerCase();
    let ext = 'png';
    if (['png', 'jpg', 'jpeg', 'webp'].includes(rawName)) ext = rawName;
    else if (rawName.includes('jpg') || rawName.includes('jpeg')) ext = 'jpg';
    else if (rawName.includes('webp')) ext = 'webp';
    else ext = 'png';

    const mimeMatch = String(parsed.base64 || '').match(/^data:image\/(\w+);base64,/i);
    const mimeExt = mimeMatch ? mimeMatch[1].toLowerCase().replace('jpg', 'jpeg') : '';
    const type = mimeExt ? `image/${mimeExt}` : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

    return { name: ext, base64: parsed.base64, type, rawName };
}

function logBase64Preview(base64) {
    const value = String(base64 || '');
    return {
        length: value.length,
        hasDataUri: value.startsWith('data:image/'),
        start: value.slice(0, 40),
        end: value.slice(-20),
    };
}

/**
 * Upload custom club profile from Unity WWWForm / JSON body.
 * body: { sProfileImage?, oFile?, nClubProfile? }
 */
async function resolveClubProfileInput(body, userId, locale = 'en', apiName = 'club') {
    const { nClubProfile, sProfileImage, oFile } = body;
    let parsedFile = null;

    log.yellow(`[${apiName}] club profile input`, {
        userId: String(userId),
        hasOFile: Boolean(oFile),
        oFileType: oFile == null ? null : typeof oFile,
        hasSProfileImage: Boolean(sProfileImage),
        sProfileImage: sProfileImage || '',
        nClubProfile: nClubProfile,
    });
    console.log(`[${apiName}] club profile input`, {
        userId: String(userId),
        hasOFile: Boolean(oFile),
        oFileType: oFile == null ? null : typeof oFile,
        oFileLength: oFile == null ? 0 : typeof oFile === 'string' ? oFile.length : JSON.stringify(oFile).length,
        hasSProfileImage: Boolean(sProfileImage),
        sProfileImage: sProfileImage || '',
        nClubProfile: nClubProfile,
    });

    if (oFile) {
        try {
            parsedFile = parseClubOFile(oFile);
            log.yellow(`[${apiName}] parsed oFile`, {
                rawName: parsedFile?.rawName,
                name: parsedFile?.name,
                type: parsedFile?.type,
                base64: logBase64Preview(parsedFile?.base64),
            });
            console.log(`[${apiName}] parsed oFile`, {
                rawName: parsedFile?.rawName,
                name: parsedFile?.name,
                type: parsedFile?.type,
                base64: logBase64Preview(parsedFile?.base64),
            });
        } catch (error) {
            log.error(`[${apiName}] parse club oFile error:`, error);
            return { error: message.server_error('', locale) };
        }
    }

    if (sProfileImage) {
        const profile = resolveClubProfile({ sProfileImage });
        log.yellow(`[${apiName}] using sProfileImage directly`, profile);
        return { profile };
    }

    if (parsedFile && parsedFile.base64) {
        try {
            const { buffer } = _.base64ToBuffer(parsedFile.base64);
            log.yellow(`[${apiName}] uploading base64 to S3`, {
                bufferBytes: buffer?.length,
                name: parsedFile.name,
                type: parsedFile.type,
                folder: `${process.env.AWS_S3_FOLDER_PREFIX || ''}clubs/${userId}`,
            });
            const { Location } = await s3.upload(
                {
                    buffer,
                    name: parsedFile.name,
                    type: parsedFile.type,
                },
                `${process.env.AWS_S3_FOLDER_PREFIX || ''}clubs/${userId}`
            );
            const profile = { nClubProfile: -1, sProfileImage: Location };
            log.green(`[${apiName}] S3 upload success`, profile);
            console.log(`[${apiName}] S3 upload success`, profile);
            return { profile };
        } catch (e) {
            log.error(`[${apiName}] club profile s3 upload error:`, e);
            return { error: message.server_error('', locale) };
        }
    }

    if (nClubProfile !== undefined || sProfileImage !== undefined) {
        const profile = resolveClubProfile({ nClubProfile, sProfileImage });
        log.yellow(`[${apiName}] using default nClubProfile`, profile);
        return { profile };
    }

    log.yellow(`[${apiName}] no profile image fields, using defaults`);
    return null;
}

// ==================== CLUB MANAGEMENT APIs ====================

// Create Club
controllers.createClub = async (req, res) => {
    let session;
    try {
        console.log('createClub raw body keys', Object.keys(req.body || {}));
        console.log('createClub oFile', {
            present: req.body?.oFile != null && req.body?.oFile !== '',
            type: typeof req.body?.oFile,
            length: req.body?.oFile == null ? 0 : typeof req.body.oFile === 'string' ? req.body.oFile.length : JSON.stringify(req.body.oFile).length,
            preview: typeof req.body?.oFile === 'string' ? req.body.oFile.slice(0, 80) : req.body?.oFile && Object.keys(req.body.oFile),
        });
        console.log('createClub sProfileImage', req.body?.sProfileImage || '');

        const body = _.pick(req.body, ['sClubName', 'sDescription', 'nMaxMembers', 'bIsPublic', 'nClubProfile', 'sProfileImage', 'oFile', 'sCountry', 'eMinimumPlayerLevel']);
        if (!body.oFile && req.body?.oFile) body.oFile = req.body.oFile;
        if (!body.sProfileImage && req.body?.sProfileImage) body.sProfileImage = req.body.sProfileImage;
        if (!body.sClubName || !body.sClubName.trim()) return res.reply(message.required_field('Club name', req.query?.eLocale || 'en'));
        if (globalThis.filter.isProfane(body.sClubName.trim())) return res.reply(message.inappropriate('Club name', req.query?.eLocale || 'en'));
        if (body.sDescription && globalThis.filter.isProfane(body.sDescription)) return res.reply(message.inappropriate('Club description', req.query?.eLocale || 'en'));

        if (body.nMaxMembers !== undefined && body.nMaxMembers !== '') body.nMaxMembers = parseInt(body.nMaxMembers, 10);
        if (body.nMaxMembers && body.nMaxMembers < 1) return res.reply(message.invalid_req('Maximum members cannot be less than 1', req.query?.eLocale || 'en'));
        if (body.nMaxMembers && body.nMaxMembers > 100) return res.reply(message.invalid_req('Maximum members cannot be greater than 100', req.query?.eLocale || 'en'));

        const owner = await User.findById(req.user._id).select('eBadges').lean();
        const allowedLevels = getAllowedClubLevels(owner?.eBadges);
        const requestedLevel = String(body.eMinimumPlayerLevel || 'beginner').trim().toLowerCase();
        if (!allowedLevels.includes(requestedLevel)) {
            return res.reply(message.club_level_not_allowed_for_badge('', req.query?.eLocale || 'en'));
        }

        const profileResult = await resolveClubProfileInput(body, req.user._id, req.query?.eLocale || 'en', 'createClub');
        if (profileResult?.error) return res.reply(profileResult.error);
        const profile = profileResult?.profile || resolveClubProfile(body);
        log.yellow('createClub resolved profile', profile);

        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            const existingMembership = await ClubMember.findOne({
                iUserId: req.user._id,
                eStatus: 'active',
            }).session(session);

            if (existingMembership) return res.reply(message.already_exists('You are already a member of a club', req.query?.eLocale || 'en'));

            const existingClub = await Club.findOne({ sClubName: body.sClubName.trim() }).session(session);

            if (existingClub) return res.reply(message.already_exists('Club name', req.query?.eLocale || 'en'));

            const clubData = {
                sClubName: body.sClubName.trim(),
                sDescription: body.sDescription || '',
                iOwnerId: req.user._id,
                nMaxMembers: body.nMaxMembers || 50,
                bIsPublic: String(body.bIsPublic) !== 'false',
                nClubProfile: profile.nClubProfile,
                sProfileImage: profile.sProfileImage,
                eMinimumPlayerLevel: requestedLevel,
            };
            if (body.sCountry) clubData.sCountry = body.sCountry.trim();

            const club = await Club.create([clubData], { session });

            await ClubMember.create(
                [
                    {
                        iClubId: club[0]._id,
                        iUserId: req.user._id,
                        eRole: 'owner',
                        nWeeklyContributionPoints: 0,
                    },
                ],
                { session }
            );

            return res.reply(message.successfully('Club created', req.query?.eLocale || 'en'), {
                iClubId: club[0]._id,
                nClubProfile: profile.nClubProfile,
                sProfileImage: profile.sProfileImage,
                sCountry: club[0].sCountry || '',
                eMinimumPlayerLevel: club[0].eMinimumPlayerLevel || 'beginner',
            });
        });
    } catch (error) {
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Update Club (name, description, icon)
controllers.updateClub = async (req, res) => {
    try {
        const { iClubId } = req.params;
        const body = _.pick(req.body, ['sClubName', 'sDescription', 'nMaxMembers', 'bIsPublic', 'nClubProfile', 'sProfileImage', 'oFile', 'sCountry', 'eMinimumPlayerLevel']);

        if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);

        const member = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eRole: 'owner',
            eStatus: 'active',
        }).lean();

        if (!member) return res.reply(message.only_owner_can_update_club('', req.query?.eLocale || 'en'));

        if (body.nMaxMembers !== undefined && body.nMaxMembers !== '') body.nMaxMembers = parseInt(body.nMaxMembers, 10);
        if (body.nMaxMembers) {
            const currentMemberCount = await ClubMember.countDocuments({
                iClubId: iClubIdObj,
                eStatus: 'active',
            });
            if (body.nMaxMembers < currentMemberCount) return res.reply(message.maximum_members_cannot_be_less_than_current_members('', req.query?.eLocale || 'en'));
        }

        const updateData = {};
        if (body.sClubName) {
            if (globalThis.filter.isProfane(body.sClubName.trim())) return res.reply(message.inappropriate('Club name', req.query?.eLocale || 'en'));
            updateData.sClubName = body.sClubName.trim();
        }
        if (body.sDescription !== undefined) {
            if (body.sDescription && globalThis.filter.isProfane(body.sDescription)) return res.reply(message.inappropriate('Club description', req.query?.eLocale || 'en'));
            updateData.sDescription = body.sDescription;
        }
        if (body.nMaxMembers) updateData.nMaxMembers = body.nMaxMembers;
        if (body.bIsPublic !== undefined) updateData.bIsPublic = body.bIsPublic;

        if (body.sCountry !== undefined) updateData.sCountry = body.sCountry.trim();
        if (body.eMinimumPlayerLevel !== undefined && body.eMinimumPlayerLevel !== '') {
            const owner = await User.findById(req.user._id).select('eBadges').lean();
            const allowedLevels = getAllowedClubLevels(owner?.eBadges);
            const requestedLevel = String(body.eMinimumPlayerLevel).trim().toLowerCase();
            if (!allowedLevels.includes(requestedLevel)) {
                return res.reply(message.club_level_not_allowed_for_badge('', req.query?.eLocale || 'en'));
            }
            updateData.eMinimumPlayerLevel = requestedLevel;
        }

        if (body.nClubProfile !== undefined || body.sProfileImage !== undefined || body.oFile) {
            const profileResult = await resolveClubProfileInput(body, req.user._id, req.query?.eLocale || 'en', 'updateClub');
            if (profileResult?.error) return res.reply(profileResult.error);
            if (profileResult?.profile) Object.assign(updateData, profileResult.profile);
        }

        await Club.findByIdAndUpdate(iClubIdObj, { $set: updateData }, { new: true }).lean();

        return res.reply(message.successfully('Club updated successfully', req.query?.eLocale || 'en'));
    } catch (error) {
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Update Club Profile (default icon or custom image upload — same pattern as profile/updateAvatar)
controllers.updateClubProfile = async (req, res) => {
    try {
        const { iClubId } = req.params;
        if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);

        const member = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eRole: 'owner',
            eStatus: 'active',
        }).lean();

        if (!member) return res.reply(message.only_owner_can_update_club('', req.query?.eLocale || 'en'));

        const body = _.pick(req.body, ['sProfileImage', 'oFile', 'nClubProfile']);
        const profileResult = await resolveClubProfileInput(body, req.user._id, req.query?.eLocale || 'en', 'updateClubProfile');
        if (profileResult?.error) return res.reply(profileResult.error);

        let profile;
        if (profileResult?.profile) {
            profile = profileResult.profile;
        } else if (body.nClubProfile !== undefined) {
            profile = resolveClubProfile(body);
        } else {
            return res.reply(message.server_error('', req.query?.eLocale || 'en'));
        }

        await Club.findByIdAndUpdate(iClubIdObj, { $set: profile });

        return res.reply(message.successfully('Profile updated', req.query?.eLocale || 'en'), {
            nClubProfile: profile.nClubProfile,
            sProfileImage: profile.sProfileImage,
        });
    } catch (error) {
        log.error('updateClubProfile error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Delete Club (owner only)
controllers.deleteClub = async (req, res) => {
    let session;
    try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            const { iClubId } = req.params;
            if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

            const iClubIdObj = mongodb.mongify(iClubId);

            // Check if user is owner
            const member = await ClubMember.findOne({
                iClubId: iClubIdObj,
                iUserId: req.user._id,
                eRole: 'owner',
                eStatus: 'active',
            }).session(session);

            if (!member) return res.reply(message.only_owner_can_delete_club('', req.query?.eLocale || 'en'));

            // Get club details before deletion for notification
            const club = await Club.findOne({ _id: iClubIdObj, eStatus: 'y' }).session(session);

            // Get all active club members before marking them as left
            const clubMembers = await ClubMember.find({ iClubId: iClubIdObj, eStatus: 'active' }).select('iUserId').session(session).lean();

            // Soft delete club
            await Club.findByIdAndUpdate(iClubIdObj, { $set: { eStatus: 'd' } }).session(session);

            // Mark all members as left
            await ClubMember.updateMany({ iClubId: iClubIdObj }, { $set: { eStatus: 'left' } }).session(session);

            // Emit club deletion notification to all members (exclude the owner who deleted the club)
            if (clubMembers && clubMembers.length) {
                const emitData = {
                    iClubId: iClubIdObj.toString(),
                    sClubName: club?.sClubName || '',
                    sMessage: 'Club deleted by owner',
                    dDeletedAt: new Date(),
                };
                const targets = clubMembers.filter((m) => m.iUserId.toString() !== req.user._id.toString());
                if (targets.length) {
                    await Promise.all(targets.map((m) => _.privateEmit(m.iUserId.toString(), 'resClubDeleted', emitData)));
                }
            }

            return res.reply(message.successfully('Club deleted successfully', req.query?.eLocale || 'en'));
        });
    } catch (error) {
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    } finally {
        if (session) {
            await session.endSession();
        }
    }
};

// Join Club
controllers.joinClub = async (req, res) => {
    let session;
    try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            const { iClubId } = req.params;
            if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

            const iClubIdObj = mongodb.mongify(iClubId);

            // Check if user is already in a club
            const existingMembership = await ClubMember.findOne({
                iUserId: req.user._id,
                eStatus: 'active',
            }).session(session);
            if (existingMembership) return res.reply(message.already_exists('You are already a member of a club', req.query?.eLocale || 'en'));

            // Get club details
            const club = await Club.findOne({ _id: iClubIdObj, eStatus: 'y' }).session(session);
            if (!club) return res.reply(message.not_found('Club', req.query?.eLocale || 'en'));

            // Check if club is public or requires approval
            if (!club.bIsPublic) {
                // create a join request instead of direct join
                const existingRequest = await ClubJoinRequest.findOne({
                    iClubId: iClubIdObj,
                    iUserId: req.user._id,
                    eStatus: 'pending',
                }).session(session);

                if (existingRequest) return res.reply(message.already_exists('Join request already sent', req.query?.eLocale || 'en'));

                await ClubJoinRequest.create(
                    [
                        {
                            iClubId: iClubIdObj,
                            iUserId: req.user._id,
                            // sMessage: req.body?.message || '',
                        },
                    ],
                    { session }
                );

                // Notify club owner(s) in real time about the new join request
                try {
                    const owner = await ClubMember.findOne({
                        iClubId: iClubIdObj,
                        eRole: 'owner',
                        eStatus: 'active',
                    })
                        .select('iUserId')
                        .session(session)
                        .lean();

                    if (owner) {
                        const payload = {
                            iClubId: iClubIdObj.toString(),
                            iUserId: req.user._id.toString(),
                            sUserName: req.user.sUserName || '',
                            sAvatar: req.user.sAvatar || '',
                            nTotalCoins: req.user.nTotalCoins || 0,
                            dCreatedDate: new Date(),
                        };

                        await _.privateEmit(owner.iUserId.toString(), 'resNewClubJoinRequest', payload);
                    }
                } catch (e) {
                    log.error('joinClub: failed to emit resNewClubJoinRequest', e);
                }

                return res.reply(message.successfully('Join request sent. Waiting for approval', req.query?.eLocale || 'en'));
            }

            // Check if club has space
            const currentMemberCount = await ClubMember.countDocuments({
                iClubId: iClubIdObj,
                eStatus: 'active',
            }).session(session);

            if (currentMemberCount >= club.nMaxMembers) return res.reply(message.no_vacant('Club is full', req.query?.eLocale || 'en'));

            // Check if join approval is required
            // if (club.bJoinApprovalRequired) {
            //     // Create a join request (we'll use ClubMember with pending status)
            //     // For now, we'll create it as active but you might want a separate JoinRequest model
            //     return res.reply(message.successfully('Join request sent. Waiting for approval', req.query?.eLocale || 'en'));
            // }

            // Add member directly
            await ClubMember.create(
                [
                    {
                        iClubId: iClubIdObj,
                        iUserId: req.user._id,
                        eRole: 'member',
                        nWeeklyContributionPoints: 0,
                    },
                ],
                { session }
            );

            // Notify all club members to refresh member list (exclude the user who joined)
            await emitRefreshClubMembers(iClubIdObj, req.user._id);

            return res.reply(message.successfully('Joined club', req.query?.eLocale || 'en'));
        });
    } catch (error) {
        log.error('joinClub error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    } finally {
        if (session) {
            await session.endSession();
        }
    }
};

// Leave Club
controllers.leaveClub = async (req, res) => {
    let session;
    try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            const { iClubId } = req.params;
            if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

            const iClubIdObj = mongodb.mongify(iClubId);

            // Check if user is a member
            const member = await ClubMember.findOne({
                iClubId: iClubIdObj,
                iUserId: req.user._id,
                eStatus: 'active',
            }).session(session);

            if (!member) return res.reply(message.not_found('Club membership', req.query?.eLocale || 'en'));

            // Owner cannot leave, must delete club or transfer ownership
            if (member.eRole === 'owner') return res.reply(message.invalid_req('Club owner cannot leave. Please delete the club or transfer ownership', req.query?.eLocale || 'en'));

            // Mark member as left
            await ClubMember.findByIdAndUpdate(member._id, { $set: { eStatus: 'left' } }).session(session);

            // Notify remaining club members to refresh member list (exclude the user who left)
            await emitRefreshClubMembers(iClubIdObj, req.user._id);

            return res.reply(message.successfully('Left club successfully', req.query?.eLocale || 'en'));
        });
    } catch (error) {
        log.error('leaveClub error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    } finally {
        if (session) {
            await session.endSession();
        }
    }
};

// Get Club Details
controllers.getClub = async (req, res) => {
    try {
        const { iClubId } = req.params;
        if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);

        const club = await Club.findOne(
            { _id: iClubIdObj, eStatus: 'y' },
            {
                sClubName: 1,
                sDescription: 1,
                iOwnerId: 1,
                nMaxMembers: 1,
                bIsPublic: 1,
                nClubProfile: 1,
                sProfileImage: 1,
                sCountry: 1,
                eMinimumPlayerLevel: 1,
            }
        ).lean();
        if (!club) return res.reply(message.not_found('Club', req.query?.eLocale || 'en'));

        // Get member count
        const memberCount = await ClubMember.countDocuments({
            iClubId: iClubIdObj,
            eStatus: 'active',
        });
        // Check if user is a member
        const userMembership = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
        }).lean();
        // Fetch club owner username and avatar
        const owner = await User.findOne({ _id: club.iOwnerId }, { sUserName: 1, sAvatar: 1, nTotalCoins: 1 }).lean();
        const payload = {
            ...club,
            nClubProfile: club.nClubProfile ?? 0,
            sProfileImage: club.sProfileImage || '',
            sCountry: club.sCountry || '',
            eMinimumPlayerLevel: club.eMinimumPlayerLevel || 'beginner',
            nMemberCount: memberCount,
            bIsMember: !!userMembership,
            eUserRole: userMembership?.eRole || null,
            sOwnerUserName: owner?.sUserName || '',
            sOwnerAvatar: owner?.sAvatar || '',
            nOwnerTotalCoins: owner?.nTotalCoins || 0,
        };
        if (userMembership?.eRole === 'owner') {
            payload.nUnreadJoinRequests = await ClubJoinRequest.countDocuments({
                iClubId: iClubIdObj,
                eStatus: 'pending',
                $or: [{ isRead: false }, { isRead: { $exists: false } }],
            });
        }
        return res.reply(message.successfully('', req.query?.eLocale || 'en'), payload);
    } catch (error) {
        log.error('getClub error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Get My Club
// controllers.getMyClub = async (req, res) => {
//     try {
//         const membership = await ClubMember.findOne({
//             iUserId: req.user._id,
//             eStatus: 'active',
//         })
//             .populate('iClubId')
//             .lean();

//         if (!membership) return res.reply(message.not_found('Club membership', req.query?.eLocale || 'en'));

//         const club = membership.iClubId;
//         if (club.eStatus !== 'y') return res.reply(message.not_found('Club', req.query?.eLocale || 'en'));

//         // Get member count
//         const memberCount = await ClubMember.countDocuments({
//             iClubId: club._id,
//             eStatus: 'active',
//         });

//         return res.reply(message.successfully('', req.query?.eLocale || 'en'), {
//             ...club,
//             nMemberCount: memberCount,
//             eUserRole: membership.eRole,
//             dJoinedAt: membership.dJoinedAt,
//         });
//     } catch (error) {
//         log.error('getMyClub error:', error);
//         return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
//     }
// };

// List Clubs (public clubs)
controllers.listClubs = async (req, res) => {
    try {
        const body = _.pick(req.query, ['sort', 'orderBy', 'size', 'pageNumber', 'search', 'filter', 'availableSlots']);

        body.pageNumber = body.pageNumber ? parseInt(body.pageNumber) : 0;
        body.size = body.size ? parseInt(body.size) : 10;

        const startIndex = body.pageNumber * body.size;
        const endIndex = parseInt(body.size);

        const matchQuery = {
            eStatus: 'y',
        };

        const filter = String(body.filter || '').toLowerCase();
        if (filter === 'public') matchQuery.bIsPublic = true;
        else if (filter === 'private') matchQuery.bIsPublic = false;

        if (body.search) {
            matchQuery.sClubName = { $regex: new RegExp(`^.*${body.search}.*`, 'i') };
        }

        // Sorting: recently_created (default) | most_members | alphabetically
        const sortKey = String(body.sort || 'recently_created').toLowerCase();
        let sort = { dCreatedDate: -1 };
        let appliedSort = 'recently_created';
        if (sortKey === 'most_members') {
            sort = { memberCount: -1, dCreatedDate: -1 };
            appliedSort = 'most_members';
        } else if (sortKey === 'alphabetically') {
            sort = { sClubName: 1 };
            appliedSort = 'alphabetically';
        } else if (sortKey === 'recently_created') {
            sort = { dCreatedDate: -1 };
            appliedSort = 'recently_created';
        } else if (body.sort) {
            sort = { [body.sort]: body.orderBy === 'DESC' ? -1 : 1 };
            appliedSort = body.sort;
        }

        const facetArray = [{ $sort: sort }, { $skip: startIndex }, { $limit: endIndex }];

        // Available slots: memberCount < nMaxMembers
        const hasAvailableSlots = filter === 'available_slots' || body.availableSlots === 'true' || body.availableSlots === '1' || body.availableSlots === true;

        const appliedFilter = [];
        if (filter === 'public' || filter === 'private') appliedFilter.push(filter);
        else if (filter === 'available_slots') appliedFilter.push('available_slots');
        if (hasAvailableSlots && filter !== 'available_slots') appliedFilter.push('available_slots');

        const listMeta = {
            sort: appliedSort,
            orderBy: ['recently_created', 'most_members'].includes(appliedSort) ? 'DESC' : appliedSort === 'alphabetically' ? 'ASC' : body.orderBy === 'DESC' ? 'DESC' : 'ASC',
            filter: appliedFilter.length ? appliedFilter : ['none'],
            search: body.search || '',
            pageNumber: body.pageNumber,
            size: body.size,
        };
        log.yellow('listClubs applied sort/filter:', listMeta);

        const query = [
            {
                $match: matchQuery,
            },
            {
                $lookup: {
                    from: 'clubmembers',
                    let: { clubId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [{ $eq: ['$iClubId', '$$clubId'] }, { $eq: ['$eStatus', 'active'] }],
                                },
                            },
                        },
                        { $count: 'count' },
                    ],
                    as: 'memberCount',
                },
            },
            {
                $addFields: {
                    nMemberCount: { $ifNull: [{ $arrayElemAt: ['$memberCount.count', 0] }, 0] },
                },
            },
            ...(hasAvailableSlots
                ? [
                    {
                        $match: {
                            $expr: { $lt: ['$nMemberCount', '$nMaxMembers'] },
                        },
                    },
                ]
                : []),
            // Lookup owner information and include owner basic fields
            {
                $lookup: {
                    from: 'User',
                    localField: 'iOwnerId',
                    foreignField: '_id',
                    as: 'owner',
                },
            },
            { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
            {
                $addFields: {
                    sOwnerUserName: { $ifNull: ['$owner.sUserName', ''] },
                    sOwnerAvatar: { $ifNull: ['$owner.sAvatar', ''] },
                    nOwnerTotalCoins: { $ifNull: ['$owner.nTotalCoins', 0] },
                },
            },
            {
                $project: {
                    sClubName: '$sClubName',
                    sDescription: '$sDescription',
                    nMaxMembers: '$nMaxMembers',
                    bIsPublic: '$bIsPublic',
                    nClubProfile: { $ifNull: ['$nClubProfile', 0] },
                    sProfileImage: { $ifNull: ['$sProfileImage', ''] },
                    sCountry: { $ifNull: ['$sCountry', ''] },
                    eMinimumPlayerLevel: { $ifNull: ['$eMinimumPlayerLevel', 'beginner'] },
                    memberCount: '$nMemberCount',
                    sOwnerUserName: '$sOwnerUserName',
                    sOwnerAvatar: '$sOwnerAvatar',
                    nOwnerTotalCoins: '$nOwnerTotalCoins',
                    dCreatedDate: '$dCreatedDate',
                    dUpdatedDate: '$dUpdatedDate',
                    eStatus: '$eStatus',
                },
            },
            {
                $facet: {
                    clubs: facetArray,
                    count: [
                        {
                            $count: 'totalData',
                        },
                    ],
                },
            },
            {
                $unwind: '$count',
            },
        ];

        const [result] = await Club.aggregate(query);
        const payload = result || { clubs: [], count: { totalData: 0 } };
        payload.meta = listMeta;

        return res.reply(message.successfully('', req.query?.eLocale || 'en'), payload);
    } catch (error) {
        log.error('listClubs error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// ==================== MEMBER MANAGEMENT APIs ====================

// View Club Members
controllers.getClubMembers = async (req, res) => {
    try {
        // accept iClubId from params or query for flexibility
        const rawClubId = req.params.iClubId || req.query.iClubId;
        if (!rawClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(rawClubId);

        // Check if user is a member
        const userMembership = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
        }).lean();

        if (!userMembership) return res.reply(message.not_found('Club membership', req.query?.eLocale || 'en'));

        // Pagination / sorting / search options
        const body = _.pick(req.query, ['sort', 'orderBy', 'size', 'pageNumber', 'search']);
        const sort = {};
        if (!body.sort) sort.dCreatedDate = -1;
        if (body.sort) sort[body.sort] = body.orderBy === 'DESC' ? -1 : 1;
        body.pageNumber = body.pageNumber ? parseInt(body.pageNumber, 10) : 0;
        body.size = body.size ? parseInt(body.size, 10) : 10;
        const startIndex = body.pageNumber * body.size;
        const endIndex = parseInt(body.size, 10);

        // Build pipeline: match -> lookup user -> unwind -> optional search -> project -> facet (members + count)
        const preFacetPipeline = [
            {
                $match: {
                    iClubId: iClubIdObj,
                    eStatus: 'active',
                },
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'iUserId',
                    foreignField: '_id',
                    as: 'user',
                },
            },
            { $unwind: '$user' },
        ];

        if (body.search) {
            const searchRegex = new RegExp(`^.*${_.searchRegex(body.search)}.*`, 'i');
            // match on username or other user fields if needed
            preFacetPipeline.push({
                $match: {
                    $or: [{ 'user.sUserName': { $regex: searchRegex } }, { 'user.sEmail': { $regex: searchRegex } }],
                },
            });
        }

        // projection
        preFacetPipeline.push({
            $project: {
                _id: 0,
                iUserId: '$iUserId',
                iClubId: '$iClubId',
                eRole: '$eRole',
                nWeeklyContributionPoints: '$nWeeklyContributionPoints',
                dCreatedDate: '$dCreatedDate',
                sUserName: '$user.sUserName',
                sAvatar: { $ifNull: ['$user.sAvatar', ''] },
                nWon: { $ifNull: ['$user.nWon', 0] },
                nLost: { $ifNull: ['$user.nLost', 0] },
                nTotalCoins: { $ifNull: ['$user.nTotalCoins', 0] },
            },
        });

        // Add numeric sort order for roles so that owner > admin > member
        preFacetPipeline.push({
            $addFields: {
                nRoleOrder: {
                    $switch: {
                        branches: [
                            { case: { $eq: ['$eRole', 'owner'] }, then: 0 },
                            { case: { $eq: ['$eRole', 'admin'] }, then: 1 },
                        ],
                        default: 2,
                    },
                },
            },
        });

        // facet for pagination + count
        // Sort by role (owner, admin, member), then by dCreatedDate descending
        const finalSort = { nRoleOrder: 1, dCreatedDate: -1 };
        const facetArray = [{ $sort: finalSort }, { $skip: startIndex }, { $limit: endIndex }];

        const pipeline = [
            ...preFacetPipeline,
            {
                $facet: {
                    members: facetArray,
                    count: [{ $count: 'totalData' }],
                },
            },
            { $unwind: { path: '$count', preserveNullAndEmptyArrays: true } },
        ];

        const [result, club] = await Promise.all([
            ClubMember.aggregate(pipeline),
            Club.findOne({ _id: iClubIdObj, eStatus: 'y' }, { nClubProfile: 1, sProfileImage: 1 }).lean(),
        ]);

        const eLocale = req.query?.eLocale || 'en';

        const response = {
            nClubProfile: club?.nClubProfile ?? 0,
            sProfileImage: club?.sProfileImage || '',
            members:
                eLocale === 'hi'
                    ? (result?.[0]?.members || []).map((m) => ({
                          ...m,
                          eRole: _.getClubRoleLabel(m.eRole, eLocale),
                      }))
                    : result?.[0]?.members || [],
            count: { totalData: result?.[0]?.count?.totalData || (result?.[0]?.members ? result[0].members.length : 0) },
        };
        return res.reply(message.successfully('', eLocale), response);
    } catch (error) {
        log.error('getClubMembers error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// List join requests for a club (owner only)
controllers.listJoinRequests = async (req, res) => {
    try {
        const { iClubId } = req.params;
        if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);

        // Check if requester is owner
        const ownerMember = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eRole: 'owner',
            eStatus: 'active',
        }).lean();

        if (!ownerMember) return res.reply(message.only_owner_can_view_join_requests('', req.query?.eLocale || 'en'));

        const body = _.pick(req.query, ['size', 'pageNumber']);
        body.pageNumber = body.pageNumber ? parseInt(body.pageNumber, 10) : 0;
        body.size = body.size ? parseInt(body.size, 10) : 50;
        const skip = body.pageNumber * body.size;

        // Mark all pending join requests as read when owner opens the list
        await ClubJoinRequest.updateMany({ iClubId: iClubIdObj, eStatus: 'pending', isRead: false }, { $set: { isRead: true } });

        const requests = await ClubJoinRequest.find({ iClubId: iClubIdObj, eStatus: 'pending' }).sort({ dCreatedDate: -1 }).skip(skip).limit(body.size).populate('iUserId', 'sUserName sAvatar nTotalCoins eBadges').lean();
        const count = await ClubJoinRequest.countDocuments({ iClubId: iClubIdObj });

        return res.reply(message.successfully('', req.query?.eLocale || 'en'), {
            requests,
            count: { totalData: count },
            nUnreadJoinRequests: 0,
        });
    } catch (error) {
        log.error('listJoinRequests error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Approve or reject a join request (owner only)
controllers.respondToJoinRequest = async (req, res) => {
    let session;
    try {
        // Accept iRequestId and iClubId in request body (fall back to params for backward compatibility)
        const body = _.pick(req.body, ['iRequestId', 'iClubId', 'action']); // action: 'approve' | 'reject'
        const iRequestId = body.iRequestId || req.params?.iRequestId;
        const suppliedClubId = body.iClubId || req.params?.iClubId;

        if (!iRequestId) return res.reply(message.required_field('Request ID', req.query?.eLocale || 'en'));
        if (!body.action || !['approve', 'reject'].includes(body.action)) return res.reply(message.required_field('action (approve|reject)', req.query?.eLocale || 'en'));

        const iRequestIdObj = mongodb.mongify(iRequestId);
        const joinRequest = await ClubJoinRequest.findById(iRequestIdObj).lean();
        if (!joinRequest) return res.reply(message.not_found('Join request', req.query?.eLocale || 'en'));

        // Prefer supplied club id, otherwise use the one from the join request
        const iClubIdObj = suppliedClubId ? mongodb.mongify(suppliedClubId) : joinRequest.iClubId;

        // Check if requester is owner of the club
        const ownerMember = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eRole: 'owner',
            eStatus: 'active',
        }).lean();
        if (!ownerMember) return res.reply(message.only_owner_can_act_on_join_requests('', req.query?.eLocale || 'en'));

        const alreadyJoined = await ClubMember.findOne({ iUserId: joinRequest.iUserId, eStatus: 'active' }).session(session);
        if (alreadyJoined) return res.reply(message.the_user_joined_another_club('', req.query?.eLocale || 'en'));
        if (joinRequest.eStatus !== 'pending') return res.reply(message.invalid_req('Request already handled', req.query?.eLocale || 'en'));

        if (body.action === 'reject') {
            await ClubJoinRequest.findByIdAndUpdate(iRequestIdObj, { $set: { eStatus: 'rejected', iHandledBy: req.user._id, dHandledAt: new Date() } });
            return res.reply(message.successfully('Join request rejected', req.query?.eLocale || 'en'));
        }

        // Approve flow: add member if space and not already member
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            const club = await Club.findOne({ _id: iClubIdObj, eStatus: 'y' }).session(session);
            if (!club) throw new Error('Club not found');

            const currentMemberCount = await ClubMember.countDocuments({ iClubId: iClubIdObj, eStatus: 'active' }).session(session);
            if (currentMemberCount >= club.nMaxMembers) return res.reply(message.no_vacant('Club is full', req.query?.eLocale || 'en'));

            const existingMembership = await ClubMember.findOne({ iClubId: iClubIdObj, iUserId: joinRequest.iUserId, eStatus: 'active' }).session(session);
            if (existingMembership) return res.reply(message.already_exists('User is already a member', req.query?.eLocale || 'en'));

            await ClubMember.create(
                [
                    {
                        iClubId: iClubIdObj,
                        iUserId: joinRequest.iUserId,
                        eRole: 'member',
                        nWeeklyContributionPoints: 0,
                    },
                ],
                { session }
            );

            await ClubJoinRequest.findByIdAndUpdate(iRequestIdObj, { $set: { eStatus: 'approved', iHandledBy: req.user._id, dHandledAt: new Date() } }).session(session);
        });

        // Emit socket event to notify user that their join request was accepted
        const clubInfo = await Club.findOne({ _id: iClubIdObj, eStatus: 'y' }).lean();
        console.log('clubInfo:', clubInfo);
        if (clubInfo) {
            await _.privateEmit(joinRequest.iUserId.toString(), 'resJoinRequestAccepted', {
                iRequestId: iRequestIdObj.toString(),
                iUserId: joinRequest.iUserId.toString(),
                iClubId: iClubIdObj.toString(),
                sClubName: clubInfo.sClubName,
                sDescription: clubInfo.sDescription || '',
                dHandledAt: new Date(),
            });
        }

        // Notify all club members to refresh member list (exclude the owner who approved)
        await emitRefreshClubMembers(iClubIdObj, req.user._id);

        return res.reply(message.successfully('User added to club', req.query?.eLocale || 'en'));
    } catch (error) {
        log.error('respondToJoinRequest error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    } finally {
        if (session) await session.endSession();
    }
};
// Promote Member (Owner → Admin)
controllers.promoteMember = async (req, res) => {
    try {
        const { iClubId, iUserId } = req.params;
        if (!iClubId || !iUserId) return res.reply(message.required_field('Club ID and User ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);
        const iUserIdObj = mongodb.mongify(iUserId);

        // Check if requester is owner or admin
        const requesterMember = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
            eRole: { $in: ['owner', 'admin'] },
        }).lean();

        if (!requesterMember) return res.reply(message.only_owner_or_admin_promote_members('', req.query?.eLocale || 'en'));

        // Find target member
        const targetMember = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: iUserIdObj,
            eStatus: 'active',
        }).lean();

        if (!targetMember) return res.reply(message.not_found('Member', req.query?.eLocale || 'en'));

        if (targetMember.eRole === 'owner') return res.reply(message.invalid_req('Cannot promote owner', req.query?.eLocale || 'en'));

        if (targetMember.eRole === 'admin') return res.reply(message.already_exists('Member is already an admin', req.query?.eLocale || 'en'));

        // Only owner can promote to admin
        if (requesterMember.eRole !== 'owner') return res.reply(message.only_owner_can_promote_members_to_admin('', req.query?.eLocale || 'en'));

        // Promote to admin
        await ClubMember.findByIdAndUpdate(targetMember._id, { $set: { eRole: 'admin' } });

        // Notify all club members to refresh member list (role changed, exclude the user who performed the action)
        await emitRefreshClubMembers(iClubIdObj);

        return res.reply(message.successfully('Member promoted to admin', req.query?.eLocale || 'en'));
    } catch (error) {
        log.error('promoteMember error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Demote Member (Admin → Member)
controllers.demoteMember = async (req, res) => {
    try {
        const { iClubId, iUserId } = req.params;
        if (!iClubId || !iUserId) return res.reply(message.required_field('Club ID and User ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);
        const iUserIdObj = mongodb.mongify(iUserId);

        // Check if requester is owner
        const requesterMember = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
            eRole: 'owner',
        }).lean();

        if (!requesterMember) return res.reply(message.only_owner_can_demote_members('', req.query?.eLocale || 'en'));

        // Find target member
        const targetMember = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: iUserIdObj,
            eStatus: 'active',
        }).lean();

        if (!targetMember) return res.reply(message.not_found('Member', req.query?.eLocale || 'en'));

        if (targetMember.eRole === 'owner') return res.reply(message.invalid_req('Cannot demote owner', req.query?.eLocale || 'en'));

        if (targetMember.eRole === 'member') return res.reply(message.already_exists('Member is already a regular member', req.query?.eLocale || 'en'));

        // Demote to member
        await ClubMember.findByIdAndUpdate(targetMember._id, { $set: { eRole: 'member' } });

        // Notify all club members to refresh member list (role changed, exclude the user who performed the action)
        await emitRefreshClubMembers(iClubIdObj);

        return res.reply(message.successfully('Member demoted to regular member', req.query?.eLocale || 'en'));
    } catch (error) {
        log.error('demoteMember error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Remove Member
controllers.removeMember = async (req, res) => {
    try {
        const { iClubId, iUserId } = req.params;
        if (!iClubId || !iUserId) return res.reply(message.required_field('Club ID and User ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);
        const iUserIdObj = mongodb.mongify(iUserId);

        // Check if requester is owner or admin
        const requesterMember = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
            eRole: { $in: ['owner', 'admin'] },
        }).lean();

        if (!requesterMember) return res.reply(message.only_owner_or_admin_remove_member('', req.query?.eLocale || 'en'));

        // Find target member
        const targetMember = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: iUserIdObj,
            eStatus: 'active',
        }).lean();

        if (!targetMember) return res.reply(message.not_found('Member', req.query?.eLocale || 'en'));

        if (targetMember.eRole === 'owner') return res.reply(message.invalid_req('Cannot remove owner', req.query?.eLocale || 'en'));

        // Admin cannot remove other admins (only owner can)
        if (targetMember.eRole === 'admin' && requesterMember.eRole !== 'owner') return res.reply(message.only_owner_can_remove_admins('', req.query?.eLocale || 'en'));

        // Remove member
        await ClubMember.findByIdAndUpdate(targetMember._id, { $set: { eStatus: 'removed' } });

        // Notify all club members to refresh member list (exclude the user who performed the removal)
        await emitRefreshClubMembers(iClubIdObj);

        return res.reply(message.successfully('Member removed from club', req.query?.eLocale || 'en'));
    } catch (error) {
        log.error('removeMember error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// ==================== LEADERBOARD APIs ====================

// Get Club Leaderboard (based on points)
controllers.getClubLeaderboard = async (req, res) => {
    try {
        const { iClubId } = req.params;
        if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);

        // Check membership
        const userMembership = await ClubMember.findOne({ iClubId: iClubIdObj, iUserId: req.user._id, eStatus: 'active' }).lean();
        if (!userMembership) return res.reply(message.not_found('Club membership', req.query?.eLocale || 'en'));

        // Range: monthly (default) or lifetime
        const range = (req.query.range || 'monthly').toString().toLowerCase();
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Pagination & sorting
        const body = _.pick(req.query, ['sort', 'orderBy', 'size', 'pageNumber']);
        const sort = {};
        // default sort by coins earned desc
        if (!body.sort) sort.nTotalCoinsEarned = -1;
        if (body.sort) sort[body.sort] = body.orderBy === 'DESC' ? -1 : 1;
        body.pageNumber = body.pageNumber ? parseInt(body.pageNumber, 10) : 0;
        body.size = body.size ? parseInt(body.size, 10) : 25;
        const startIndex = body.pageNumber * body.size;
        const limit = parseInt(body.size, 10);

        // Build base aggregation from ClubMember, lookup stats with conditional date filter
        const statsPipeline = [];
        if (range === 'monthly') statsPipeline.push({ $match: { dCreatedDate: { $gte: thirtyDaysAgo } } });
        statsPipeline.push({ $unwind: '$aPlayer' });
        // Fallback score calculation (some histories may not have aPlayer.nTotalScore populated)
        statsPipeline.push({
            $addFields: {
                nScoreFromRounds: {
                    $sum: {
                        $map: {
                            input: { $ifNull: ['$aRoundInfo', []] },
                            as: 'r',
                            in: {
                                $sum: {
                                    $map: {
                                        input: {
                                            $filter: {
                                                input: { $ifNull: ['$$r.aDeclaredHand', []] },
                                                as: 'h',
                                                cond: { $eq: ['$$h.iUserId', '$aPlayer.iUserId'] },
                                            },
                                        },
                                        as: 'h2',
                                        in: { $ifNull: ['$$h2.nScore', { $ifNull: ['$$h2.oStatistics.nScore', 0] }] },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        statsPipeline.push({ $match: { $expr: { $eq: ['$aPlayer.iUserId', '$$uId'] } } });
        statsPipeline.push({
            $group: {
                _id: '$aPlayer.iUserId',
                nTotalCoinsEarned: { $sum: { $cond: [{ $gt: ['$aPlayer.nBalance', 0] }, '$aPlayer.nBalance', 0] } },
                nTotalScore: {
                    $sum: {
                        $cond: [{ $gt: [{ $ifNull: ['$aPlayer.nTotalScore', 0] }, 0] }, { $ifNull: ['$aPlayer.nTotalScore', 0] }, { $ifNull: ['$nScoreFromRounds', 0] }],
                    },
                },
                nGamesPlayed: { $sum: 1 },
                nWins: { $sum: { $cond: [{ $eq: ['$iWinnerId', '$aPlayer.iUserId'] }, 1, 0] } },
            },
        });

        const pipeline = [
            { $match: { iClubId: iClubIdObj, eStatus: 'active' } },
            {
                $lookup: {
                    from: 'User',
                    localField: 'iUserId',
                    foreignField: '_id',
                    as: 'userDetails',
                },
            },
            { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'tableHistory',
                    let: { uId: '$iUserId' },
                    pipeline: statsPipeline,
                    as: 'stats',
                },
            },
            { $unwind: { path: '$stats', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: '$iUserId',
                    sUserName: { $ifNull: ['$userDetails.sUserName', ''] },
                    eRole: '$eRole',
                    sAvatar: { $ifNull: ['$userDetails.sAvatar', ''] },
                    eBadges: '$userDetails.eBadges',
                    nTotalCoinsEarned: { $ifNull: ['$stats.nTotalCoinsEarned', 0] },
                    nTotalScore: { $ifNull: ['$stats.nTotalScore', 0] },
                    nGamesPlayed: { $ifNull: ['$stats.nGamesPlayed', 0] },
                    nWins: { $ifNull: ['$stats.nWins', 0] },
                },
            },
            {
                $facet: {
                    total: [{ $sort: sort }, { $skip: startIndex }, { $limit: limit }],
                    count: [{ $count: 'totalData' }],
                },
            },
            { $unwind: { path: '$count', preserveNullAndEmptyArrays: true } },
        ];

        const [aggResult] = await ClubMember.aggregate(pipeline);
        const members = aggResult?.total || [];
        const totalCount = aggResult?.count?.totalData || members.length;

        // assign ranks relative to pagination
        const leaderboardWithRank = members.map((p, idx) => ({ ...p, nRank: startIndex + idx + 1 }));

        // current user stats & rank (calculate across all members matching range)
        let userDetail = null;
        const currentUserId = req.user?._id?.toString();
        if (currentUserId) {
            // compute user's coins in range
            const userStatsMatch = [];
            if (range === 'monthly') userStatsMatch.push({ $match: { dCreatedDate: { $gte: thirtyDaysAgo } } });
            const userStats = await TableHistory.aggregate([
                ...userStatsMatch,
                { $unwind: '$aPlayer' },
                { $match: { 'aPlayer.iUserId': mongodb.mongify(currentUserId) } },
                {
                    $addFields: {
                        nScoreFromRounds: {
                            $sum: {
                                $map: {
                                    input: { $ifNull: ['$aRoundInfo', []] },
                                    as: 'r',
                                    in: {
                                        $sum: {
                                            $map: {
                                                input: {
                                                    $filter: {
                                                        input: { $ifNull: ['$$r.aDeclaredHand', []] },
                                                        as: 'h',
                                                        cond: { $eq: ['$$h.iUserId', '$aPlayer.iUserId'] },
                                                    },
                                                },
                                                as: 'h2',
                                                in: { $ifNull: ['$$h2.nScore', { $ifNull: ['$$h2.oStatistics.nScore', 0] }] },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                {
                    $group: {
                        _id: '$aPlayer.iUserId',
                        nTotalCoinsEarned: { $sum: { $cond: [{ $gt: ['$aPlayer.nBalance', 0] }, '$aPlayer.nBalance', 0] } },
                        nTotalScore: {
                            $sum: {
                                $cond: [{ $gt: [{ $ifNull: ['$aPlayer.nTotalScore', 0] }, 0] }, { $ifNull: ['$aPlayer.nTotalScore', 0] }, { $ifNull: ['$nScoreFromRounds', 0] }],
                            },
                        },
                        nGamesPlayed: { $sum: 1 },
                        nWins: { $sum: { $cond: [{ $eq: ['$iWinnerId', '$aPlayer.iUserId'] }, 1, 0] } },
                    },
                },
            ]);

            if (userStats.length > 0) {
                const userStat = userStats[0];
                const user = await User.findOne({ _id: currentUserId }, { sUserName: 1, sAvatar: 1, eBadges: 1 }).lean();

                // count how many club members have higher coins in range
                const higherPipeline = [
                    { $match: { iClubId: iClubIdObj, eStatus: 'active' } },
                    {
                        $lookup: {
                            from: 'tableHistory',
                            let: { uId: '$iUserId' },
                            pipeline: statsPipeline,
                            as: 'stats',
                        },
                    },
                    { $unwind: { path: '$stats', preserveNullAndEmptyArrays: true } },
                    { $match: { 'stats.nTotalCoinsEarned': { $gt: userStat.nTotalCoinsEarned } } },
                    { $count: 'count' },
                ];

                const higherRes = await ClubMember.aggregate(higherPipeline);
                const rank = (higherRes[0]?.count || 0) + 1;

                userDetail = {
                    _id: currentUserId,
                    sUserName: user?.sUserName,
                    sAvatar: user?.sAvatar || '',
                    eBadges: user?.eBadges,
                    nTotalCoinsEarned: userStat.nTotalCoinsEarned,
                    nTotalScore: userStat.nTotalScore,
                    nGamesPlayed: userStat.nGamesPlayed,
                    nWins: userStat.nWins,
                    nRank: rank,
                };
            } else {
                // user has no activity in range -> compute rank as 1 + count of members with >0 coins
                const positivePipeline = [
                    { $match: { iClubId: iClubIdObj, eStatus: 'active' } },
                    {
                        $lookup: {
                            from: 'tableHistory',
                            let: { uId: '$iUserId' },
                            pipeline: statsPipeline,
                            as: 'stats',
                        },
                    },
                    { $unwind: { path: '$stats', preserveNullAndEmptyArrays: true } },
                    { $match: { 'stats.nTotalCoinsEarned': { $gt: 0 } } },
                    { $count: 'count' },
                ];
                const posRes = await ClubMember.aggregate(positivePipeline);
                const rank = (posRes[0]?.count || 0) + 1;
                const user = await User.findOne({ _id: currentUserId }, { sUserName: 1, sAvatar: 1, eBadges: 1 }).lean();
                userDetail = {
                    _id: currentUserId,
                    sUserName: user?.sUserName,
                    sAvatar: user?.sAvatar,
                    eBadges: user?.eBadges,
                    nTotalCoinsEarned: 0,
                    nTotalScore: 0,
                    nGamesPlayed: 0,
                    nWins: 0,
                    nRank: rank,
                };
            }
        }

        const finalResponse = {
            total: leaderboardWithRank,
            count: totalCount,
            userDetail,
        };
        return res.reply(message.successfully('', req.query?.eLocale || 'en'), finalResponse);
    } catch (error) {
        log.error('getClubLeaderboard error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// ==================== CHAT APIs ====================

// Send Message
controllers.sendMessage = async (req, res) => {
    try {
        const { iClubId } = req.params;
        const body = _.pick(req.body, ['sMessage']);

        if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));
        if (!body.sMessage || !body.sMessage.trim()) return res.reply(message.required_field('Message', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);

        // Check if user is a member
        const membership = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
        }).lean();

        if (!membership) return res.reply(message.not_found('Club membership', req.query?.eLocale || 'en'));

        const trimmedMessage = body.sMessage.trim();
        if (globalThis.filter.isProfane(trimmedMessage)) return res.reply(message.inappropriate('Message', req.query?.eLocale || 'en'));

        // Create message
        const newMessage = await ClubChat.create({
            iClubId: iClubIdObj,
            iSenderId: req.user._id,
            sMessage: trimmedMessage,
        });

        // Emit real-time message to all club members via socket
        const clubMembers = await ClubMember.find({
            iClubId: iClubIdObj,
            eStatus: 'active',
        })
            .select('iUserId')
            .lean();

        const emitData = {
            iMessageId: newMessage._id.toString(),
            iClubId: iClubIdObj.toString(),
            iSenderId: req.user._id.toString(),
            sSenderUserName: req.user.sUserName,
            sSenderAvatar: req.user.sAvatar || '',
            sMessage: trimmedMessage,
            dTimestamp: newMessage.dTimestamp,
        };

        // Emit to all members (you might want to use a room-based socket approach)
        await Promise.all(clubMembers.filter((member) => member.iUserId.toString() !== req.user._id.toString()).map((member) => _.privateEmit(member.iUserId.toString(), 'resNewClubMessage', emitData)));

        return res.reply(message.successfully('Message sent', req.query?.eLocale || 'en'), {
            iMessageId: newMessage._id,
            iClubId: newMessage.iClubId,
            iSenderId: newMessage.iSenderId,
            sMessage: newMessage.sMessage,
            dTimestamp: newMessage.dTimestamp,
        });
    } catch (error) {
        log.error('sendMessage error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Get Message History (paginated)
controllers.getMessageHistory = async (req, res) => {
    try {
        const { iClubId } = req.params;
        const body = _.pick(req.query, ['size', 'pageNumber']);

        if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);

        // Check if user is a member
        const membership = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
        }).lean();

        if (!membership) return res.reply(message.not_found('Club membership', req.query?.eLocale || 'en'));

        body.pageNumber = body.pageNumber ? parseInt(body.pageNumber) : 0;
        body.size = body.size ? parseInt(body.size) : 50;

        const startIndex = body.pageNumber * body.size;
        const endIndex = parseInt(body.size);

        const facetArray = [
            {
                $sort: { dCreatedDate: 1 },
            },
            {
                $skip: startIndex,
            },
            {
                $limit: endIndex,
            },
        ];

        const query = [
            {
                $match: {
                    iClubId: iClubIdObj,
                    bIsDeleted: false,
                },
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'iSenderId',
                    foreignField: '_id',
                    as: 'sender',
                },
            },
            {
                $unwind: {
                    path: '$sender',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $project: {
                    _id: 1,
                    iMessageId: '$_id',
                    iClubId: '$iClubId',
                    iSenderId: '$iSenderId',
                    sMessage: '$sMessage',
                    dCreatedDate: '$dCreatedDate',
                    sSenderUserName: { $ifNull: ['$sender.sUserName', ''] },
                    sSenderAvatar: { $ifNull: ['$sender.sAvatar', ''] },
                },
            },
            {
                $facet: {
                    messages: facetArray,
                    count: [
                        {
                            $count: 'totalData',
                        },
                    ],
                },
            },
            {
                $unwind: '$count',
            },
        ];

        const [result] = await ClubChat.aggregate(query);

        return res.reply(message.successfully('', req.query?.eLocale || 'en'), result || { messages: [], count: { totalData: 0 } });
    } catch (error) {
        log.error('getMessageHistory error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Delete Message (admin/moderation)
controllers.deleteMessage = async (req, res) => {
    try {
        const { iClubId, iMessageId } = req.params;
        if (!iClubId || !iMessageId) return res.reply(message.required_field('Club ID and Message ID', req.query?.eLocale || 'en'));

        const iClubIdObj = mongodb.mongify(iClubId);
        const iMessageIdObj = mongodb.mongify(iMessageId);

        // Check if user is owner or admin
        const membership = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
            eRole: { $in: ['owner', 'admin'] },
        }).lean();

        if (!membership) return res.reply(message.only_owner_or_admin_delete_messages('', req.query?.eLocale || 'en'));

        // Find and soft delete message
        const clubMessage = await ClubChat.findOne({
            _id: iMessageIdObj,
            iClubId: iClubIdObj,
            bIsDeleted: false,
        });

        if (!clubMessage) return res.reply(message.not_found('Message', req.query?.eLocale || 'en'));

        await ClubChat.findByIdAndUpdate(iMessageIdObj, { $set: { bIsDeleted: true } });

        // Emit socket event to notify all club members to refresh chat history
        const clubMembers = await ClubMember.find({
            iClubId: iClubIdObj,
            eStatus: 'active',
        })
            .select('iUserId')
            .lean();

        const emitData = {
            iClubId: iClubIdObj.toString(),
            iMessageId: iMessageIdObj.toString(),
        };

        // Emit to all active club members to trigger fetch of chat history
        await Promise.all(clubMembers.map((member) => _.privateEmit(member.iUserId.toString(), 'resRefreshClubChat', emitData)));

        return res.reply(message.successfully('Message deleted', req.query?.eLocale || 'en'));
    } catch (error) {
        log.error('deleteMessage error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Get Own Club Profile
controllers.getOwnClubProfile = async (req, res) => {
    try {
        const { iClubId } = req.params;
        if (!iClubId) return res.reply(message.required_field('Club ID', req.query?.eLocale || 'en'));
        const iClubIdObj = mongodb.mongify(iClubId);
        const membership = await ClubMember.findOne({
            iClubId: iClubIdObj,
            iUserId: req.user._id,
            eStatus: 'active',
        })
            .populate('iClubId')
            .lean();
        if (!membership) return res.reply(message.not_found('Club membership', req.query?.eLocale || 'en'));
        return res.reply(message.successfully('', req.query?.eLocale || 'en'), membership);
    } catch (error) {
        log.error('getOwnClubProfile error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};
module.exports = controllers;
