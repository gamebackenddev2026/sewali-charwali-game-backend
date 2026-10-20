const mongoose = require('mongoose');
const { User, FriendRequest, Friends, Settings } = require('../../../../models');
const { mongodb } = require('../../../../utils');

const controllers = {};

controllers.sendRequest = async (req, res) => {
    try {
        const body = _.pick(req.body, ['iReceiverId']);
        if (!body.iReceiverId) return res.reply(message.required_field('Receiver ID', req.query?.eLocale || 'en'));

        const checkUser = await User.findOne({ _id: mongodb.mongify(body.iReceiverId), eStatus: 'y' });
        if (!checkUser) return res.reply(message.not_found('User', req.query?.eLocale || 'en'));
        const checkExistingRequest = await FriendRequest.findOne({
            iSenderId: req.user._id,
            iReceiverId: mongodb.mongify(body.iReceiverId),
            eStatus: { $ne: 'R' },
        });
        if (checkExistingRequest) return res.reply(message.already_exists('You have already sent a request to this user', req.query?.eLocale || 'en'));

        const checkForExistingFriend = await Friends.findOne({
            iUserId: req.user._id,
            iFriendId: mongodb.mongify(body.iReceiverId),
        });
        if (checkForExistingFriend) return res.reply(message.already_exists('You guys are already friends!!', req.query?.eLocale || 'en'));

        //  Check if receiver has already sent a pending request to sender
        const checkFriendRequest = await FriendRequest.findOne({
            iSenderId: mongodb.mongify(body.iReceiverId),
            iReceiverId: req.user._id,
            eStatus: 'P',
        });
        if (checkFriendRequest) {
            // Don't auto-accept, just inform that there's already a pending request from this user
            return res.reply(message.already_exists('This user has already sent you a friend request. Please accept or reject it first.', req.query?.eLocale || 'en'));
        }

        const friendRequest = await FriendRequest.create({
            iSenderId: req.user._id,
            iReceiverId: mongodb.mongify(body.iReceiverId),
        });

        // Emit friend request received event to receiver
        _.privateEmit(mongodb.mongify(body.iReceiverId).toString(), 'resFriendRequestReceived', {
            iSenderId: req.user._id.toString(),
            sSenderUserName: req.user.sUserName || '',
            sSenderAvatar: req.user.sAvatar || '',
            iRequestId: friendRequest._id.toString(),
        });

        return res.reply(message.successfully('Friend request sent', req.query?.eLocale || 'en'));
    } catch (error) {
        log.error('sendRequest error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

controllers.actionRequest = async (req, res) => {
    let session;
    try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            const body = _.pick(req.body, ['iSenderId', 'acknowledge']);

            if (!body.iSenderId) return res.reply(message.required_field('Sender ID', req.query?.eLocale || 'en'));

            const checkUser = await User.findOne({ _id: mongodb.mongify(body.iSenderId), eStatus: 'y' }).session(session);
            if (!checkUser) return res.reply(message.not_found('User', req.query?.eLocale || 'en'));

            const checkExistingRequest = await FriendRequest.findOne({
                iSenderId: mongodb.mongify(body.iSenderId),
                iReceiverId: req.user._id,
                eStatus: 'P',
            }).session(session);
            if (!checkExistingRequest) return res.reply(message.not_found('Friend request', req.query?.eLocale || 'en'));

            const checkForExistingFriend = await Friends.findOne({
                $or: [
                    { iUserId: req.user._id, iFriendId: mongodb.mongify(body.iSenderId) },
                    { iUserId: mongodb.mongify(body.iSenderId), iFriendId: req.user._id },
                ],
            }).session(session);

            if (checkForExistingFriend && checkExistingRequest.eStatus === 'P') {
                await FriendRequest.updateOne({ iSenderId: mongodb.mongify(body.iSenderId), iReceiverId: req.user._id }, { $set: { eStatus: 'A' } }).session(session);
                return res.reply(message.already_exists('You guys are already friends!!', req.query?.eLocale || 'en'));
            }

            if (body.acknowledge === 'R') {
                await FriendRequest.updateOne({ iSenderId: mongodb.mongify(body.iSenderId), iReceiverId: req.user._id }, { $set: { eStatus: 'R' } }).session(session);

                // Emit friend request rejected event to sender
                _.privateEmit(mongodb.mongify(body.iSenderId).toString(), 'resFriendRequestRejected', {
                    iReceiverId: req.user._id.toString(),
                    sReceiverUserName: req.user.sUserName,
                });

                return res.reply(message.successfully('Friend request rejected', req.query?.eLocale || 'en'));
            }

            await Friends.insertMany(
                [
                    { iUserId: req.user._id, iFriendId: mongodb.mongify(body.iSenderId) },
                    { iUserId: mongodb.mongify(body.iSenderId), iFriendId: req.user._id },
                ],
                { session }
            );
            await FriendRequest.updateOne({ iSenderId: mongodb.mongify(body.iSenderId), iReceiverId: req.user._id }, { $set: { eStatus: 'A' } }).session(session);

            // Emit friend request accepted event to sender
            _.privateEmit(mongodb.mongify(body.iSenderId).toString(), 'resFriendRequestAccepted', {
                iFriendId: req.user._id.toString(),
                sFriendUserName: req.user.sUserName,
                sFriendAvatar: req.user.sAvatar,
            });

            return res.reply(message.successfully('Friend request accepted', req.query?.eLocale || 'en'));
        });
    } catch (error) {
        log.error('acceptRequest error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    } finally {
        if (session) {
            await session.endSession();
        }
    }
};

controllers.requestList = async (req, res) => {
    try {
        const body = _.pick(req.query, ['sort', 'orderBy', 'dStartDate', 'dEndDate', 'size', 'pageNumber', 'search', 'nProfit']);

        const sort = {};
        if (!body.sort) sort.dCreatedDate = -1;
        if (body.sort) sort[body.sort] = body.orderBy === 'DESC' ? -1 : 1;
        body.pageNumber = body.pageNumber ? body.pageNumber : 0;

        body.size = body.size ? body.size : 10;
        const startIndex = body.pageNumber * body.size;
        const endIndex = parseInt(body.size);

        const facetArray = [
            {
                $sort: sort,
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
                    iReceiverId: req.user._id,
                    eStatus: 'P',
                },
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'iSenderId',
                    foreignField: '_id',
                    as: 'user',
                },
            },
            {
                $unwind: '$user',
            },
            {
                $project: {
                    _id: '$iSenderId',
                    sUserName: '$user.sUserName',
                    sAvatar: { $ifNull: ['$user.sAvatar', ''] },
                    eStatus: '$user.eStatus',
                },
            },
            {
                $facet: {
                    requests: facetArray,
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
        const [requests] = await FriendRequest.aggregate(query);
        return res.reply(message.successfully('', req.query?.eLocale || 'en'), requests);
    } catch (error) {
        log.error('requestList error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

controllers.friendList = async (req, res) => {
    try {
        const body = _.pick(req.query, ['sort', 'orderBy', 'dStartDate', 'dEndDate', 'size', 'pageNumber', 'search', 'nProfit']);

        const sort = {};
        if (!body.sort) sort.dCreatedDate = -1;
        if (body.sort) sort[body.sort] = body.orderBy === 'DESC' ? -1 : 1;
        body.pageNumber = body.pageNumber ? body.pageNumber : 0;

        body.size = body.size ? body.size : 10;
        const startIndex = body.pageNumber * body.size;
        const endIndex = parseInt(body.size);

        const facetArray = [
            {
                $sort: sort,
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
                    iUserId: req.user._id,
                },
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'iFriendId',
                    foreignField: '_id',
                    as: 'user',
                },
            },
            {
                $unwind: '$user',
            },
            {
                $project: {
                    _id: 0,
                    iUserId: '$iUserId',
                    iFriendId: '$iFriendId',
                    sUserName: '$user.sUserName',
                    sAvatar: { $ifNull: ['$user.sAvatar', ''] },
                    sEmail: '$user.sEmail',
                    ePlayerStatus: '$user.eStatus',
                    nWon: { $ifNull: ['$user.nWon', 0] },
                    nLost: { $ifNull: ['$user.nLost', 0] },
                    nTotalCoins: { $ifNull: ['$user.nTotalCoins', 0] },
                },
            },
            {
                $facet: {
                    friends: facetArray,
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
        const [friends] = await Friends.aggregate(query);
        return res.reply(message.successfully('', req.query?.eLocale || 'en'), friends);
    } catch (error) {
        log.error('friendList error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

controllers.searchUsers = async (req, res) => {
    try {
        const body = _.pick(req.query, ['sort', 'orderBy', 'dStartDate', 'dEndDate', 'size', 'pageNumber', 'search', 'nProfit']);
        if (!body.search) return res.reply(message.successfully('', req.query?.eLocale || 'en'), []);

        const sort = {};
        if (!body.sort) sort.dCreatedDate = -1;
        if (body.sort) sort[body.sort] = body.orderBy === 'DESC' ? -1 : 1;
        body.pageNumber = body.pageNumber ? body.pageNumber : 0;

        body.size = body.size ? body.size : 10;
        const startIndex = body.pageNumber * body.size;
        const endIndex = parseInt(body.size);

        const facetArray = [
            {
                $sort: sort,
            },
            {
                $skip: startIndex,
            },
            {
                $limit: endIndex,
            },
        ];

        const search = _.searchRegex(body.search);

        const query = [
            {
                $lookup: {
                    from: 'friends',
                    let: { userId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [{ $eq: ['$iFriendId', req.user._id] }, { $eq: ['$iUserId', '$$userId'] }],
                                },
                            },
                        },
                        {
                            $project: {
                                _id: 1,
                            },
                        },
                    ],
                    as: 'friendStatus',
                },
            },
            {
                $lookup: {
                    from: 'friendrequests',
                    let: { userId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $or: [
                                        {
                                            $and: [{ $eq: ['$iSenderId', req.user._id] }, { $eq: ['$iReceiverId', '$$userId'] }],
                                        },
                                        {
                                            $and: [{ $eq: ['$iSenderId', '$$userId'] }, { $eq: ['$iReceiverId', req.user._id] }],
                                        },
                                    ],
                                },
                                eStatus: 'P',
                            },
                        },
                        {
                            $project: {
                                _id: 1,
                                iSenderId: 1,
                                iReceiverId: 1,
                            },
                        },
                    ],
                    as: 'friendRequestStatus',
                },
            },
            {
                $match: {
                    _id: { $ne: req.user._id },
                    eUserType: 'user',
                    $or: [{ sUserName: { $regex: new RegExp(`^.*${search}.*`, 'i') } }, { sEmail: { $regex: new RegExp(`^.*${search}.*`, 'i') } }],
                },
            },
            {
                $addFields: {
                    eRelationshipStatus: {
                        $cond: {
                            if: { $gt: [{ $size: '$friendStatus' }, 0] },
                            then: 'friend',
                            else: {
                                $cond: {
                                    if: { $gt: [{ $size: '$friendRequestStatus' }, 0] },
                                    then: {
                                        $cond: {
                                            if: {
                                                $eq: [
                                                    {
                                                        $arrayElemAt: ['$friendRequestStatus.iSenderId', 0],
                                                    },
                                                    req.user._id,
                                                ],
                                            },
                                            then: 'request_sent',
                                            else: 'request_received',
                                        },
                                    },
                                    else: 'none',
                                },
                            },
                        },
                    },
                },
            },
            {
                $project: {
                    _id: 1,
                    sUserName: 1,
                    nMobile: 1,
                    nTotalCoins: 1,
                    sAvatar: 1,
                    eRelationshipStatus: 1,
                },
            },
            {
                $facet: {
                    users: facetArray,
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

        const [users] = await User.aggregate(query);
        return res.reply(message.successfully('', req.query?.eLocale || 'en'), users);
    } catch (error) {
        log.error('searchUserList error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

module.exports = controllers;
