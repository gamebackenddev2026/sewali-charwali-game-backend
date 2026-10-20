/* eslint-disable prettier/prettier */
const { Message, Friends, User, Table, SewaliPrivateTable } = require('../../../../models');
const { mongodb } = require('../../../../utils');
const tableManager = require('../../../../TableManager');

const controllers = {};

// Send a message to a friend
controllers.sendMessage = async (req, res) => {
    try {
        console.log('req userrr', req.user._id);
        const body = _.pick(req.body, ['iReceiverId', 'sMessage']);

        if (!body.iReceiverId) return res.reply(message.required_field('Receiver ID', req.query?.eLocale || 'en'));
        if (!body.sMessage || !body.sMessage.trim()) return res.reply(message.required_field('Message', req.query?.eLocale || 'en'));

        const iReceiverId = mongodb.mongify(body.iReceiverId);

        // Check if users are friends
        const friendship = await Friends.findOne({
            $or: [
                { iUserId: req.user._id, iFriendId: iReceiverId },
                { iUserId: iReceiverId, iFriendId: req.user._id },
            ],
        });

        if (!friendship) return res.reply(message.not_found('Friendship', req.query?.eLocale || 'en'));

        // Check if receiver exists and is active
        const receiver = await User.findOne({ _id: iReceiverId, eStatus: 'y' });
        if (!receiver) return res.reply(message.not_found('Receiver', req.query?.eLocale || 'en'));

        // Clean the message
        const cleanedMessage = globalThis.filter.clean(body.sMessage.trim());

        // Create message
        const newMessage = await Message.create({
            iSenderId: req.user._id,
            iReceiverId,
            sMessage: cleanedMessage,
            eStatus: 'sent',
        });

        // Emit real-time message to receiver via socket
        await _.privateEmit(iReceiverId.toString(), 'resNewMessage', {
            iMessageId: newMessage._id.toString(),
            iSenderId: req.user._id.toString(),
            sSenderUserName: req.user.sUserName,
            sSenderAvatar: req.user.sAvatar,
            sMessage: cleanedMessage,
            dCreatedDate: newMessage.dCreatedDate,
        });

        return res.reply(message.successfully('Message sent', req.query?.eLocale || 'en'), {
            iMessageId: newMessage._id,
            iSenderId: newMessage.iSenderId,
            iReceiverId: newMessage.iReceiverId,
            sMessage: newMessage.sMessage,
            eStatus: newMessage.eStatus,
            dCreatedDate: newMessage.dCreatedDate,
        });
    } catch (error) {
        log.error('sendMessage error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Get conversation between current user and a friend
controllers.getConversation = async (req, res) => {
    try {
        const { iFriendId } = req.params;

        if (!iFriendId) return res.reply(message.required_field('Friend ID', req.query?.eLocale || 'en'));

        const iFriendIdObj = mongodb.mongify(iFriendId);

        // Check if users are friends
        const friendship = await Friends.findOne({
            $or: [
                { iUserId: req.user._id, iFriendId: iFriendIdObj },
                { iUserId: iFriendIdObj, iFriendId: req.user._id },
            ],
        });

        if (!friendship) return res.reply(message.not_found('Friendship', req.query?.eLocale || 'en'));

        // Calculate date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const facetArray = [
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
                    iSenderId: 1,
                    iReceiverId: 1,
                    sMessage: 1,
                    eStatus: 1,
                    dCreatedDate: 1,
                    sSenderUserName: { $ifNull: ['$sender.sUserName', ''] },
                    sSenderAvatar: { $ifNull: ['$sender.sAvatar', ''] },
                },
            },
            {
                $sort: { dCreatedDate: -1 }, // Sort descending to get latest messages first
            },
            {
                $limit: 30, // Limit to 30 messages
            },
            // {
            //     $sort: { dCreatedDate: 1 }, // Sort ascending to show oldest first in result
            // },
        ];
        const query = [
            {
                $match: {
                    $or: [
                        { iSenderId: req.user._id, iReceiverId: iFriendIdObj },
                        { iSenderId: iFriendIdObj, iReceiverId: req.user._id },
                    ],
                    bIsDeleted: false,
                    dCreatedDate: { $gte: thirtyDaysAgo },
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

        const [result] = await Message.aggregate(query);

        // Mark messages as read if they were sent to current user
        await Message.updateMany(
            {
                iSenderId: iFriendIdObj,
                iReceiverId: req.user._id,
                eStatus: { $ne: 'read' },
            },
            { $set: { eStatus: 'read' } }
        );

        // Update eStatus in result to reflect read status
        if (result && result.messages) {
            result.messages = result.messages.map((message) => {
                if (message.iSenderId.toString() === iFriendIdObj.toString() && message.iReceiverId.toString() === req.user._id.toString()) {
                    return { ...message, eStatus: 'read' };
                }
                return message;
            });
        }

        return res.reply(message.successfully('', req.query?.eLocale || 'en'), result);
    } catch (error) {
        log.error('getConversation error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};

// Get all conversations (list of friends with last message)
controllers.getConversations = async (req, res) => {
    try {
        // Get all friends
        const friends = await Friends.find({ iUserId: req.user._id }).lean();

        // Calculate date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Get last message and unread count for each friend
        const conversations = await Promise.all(
            friends.map(async (friend) => {
                const { iFriendId } = friend;

                // Get friend user details
                const friendUser = await User.findOne({ _id: iFriendId }, { sUserName: 1, sAvatar: 1, eStatus: 1 }).lean();

                if (!friendUser) return null;

                // Get unread count
                const unreadCount = await Message.countDocuments({
                    iSenderId: iFriendId,
                    iReceiverId: req.user._id,
                    eStatus: { $ne: 'read' },
                    bIsDeleted: false,
                    dCreatedDate: { $gte: thirtyDaysAgo },
                });

                return {
                    iFriendId: iFriendId.toString(),
                    sFriendUserName: friendUser.sUserName,
                    //  sFriendAvatar: friendUser.sAvatar,
                    eFriendStatus: friendUser.eStatus,
                    nUnreadCount: unreadCount,
                };
            })
        );

        // Filter out null values and sort by last message date
        const filteredConversations = conversations
            .filter((conv) => conv !== null)
            .sort((a, b) => {
                if (!a.lastMessage && !b.lastMessage) return 0;
                if (!a.lastMessage) return 1;
                if (!b.lastMessage) return -1;
                return new Date(b.lastMessage.dCreatedDate) - new Date(a.lastMessage.dCreatedDate);
            });

        return res.reply(message.successfully('', req.query?.eLocale || 'en'), {
            conversations: filteredConversations,
        });
    } catch (error) {
        log.error('getConversations error:', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
    }
};


// Get total unread message count
// controllers.getUnreadCount = async (req, res) => {
//     try {
//         // Calculate date 30 days ago
//         const thirtyDaysAgo = new Date();
//         thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

//         const unreadCount = await Message.countDocuments({
//             iReceiverId: req.user._id,
//             eStatus: { $ne: 'read' },
//             bIsDeleted: false,
//             dCreatedDate: { $gte: thirtyDaysAgo },
//         });

//         return res.reply(message.successfully('', req.query?.eLocale || 'en'), {
//             nUnreadCount: unreadCount,
//         });
//     } catch (error) {
//         log.error('getUnreadCount error:', error);
//         return res.reply(message.server_error('', req.query?.eLocale || 'en'), error);
//     }
// };

module.exports = controllers;
