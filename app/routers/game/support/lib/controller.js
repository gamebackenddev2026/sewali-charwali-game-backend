/* eslint-disable no-console */
const { Support, User } = require('../../../../models');
const { mongodb, s3, email } = require('../../../../utils');

const controller = {};
controller.addTicket = async (req, res) => {
    const body = _.pick(req.body, ['iTableId', 'iTournamentId', 'sTitle', 'sDescription', 'oFile']);
    if (!body.sTitle || body.sTitle === '') return res.reply(message.required_field('sTitle', req.query?.eLocale || 'en'));
    if (!body.sDescription || body.sDescription === '') return res.reply(message.required_field('sDescription', req.query?.eLocale || 'en'));
    const ticket = {
        iUserId: req.user._id,
        sTitle: body.sTitle,
        sDescription: body.sDescription,
        aMedia: [],
    };
    if (Array.isArray(body.oFile)) {
        for (let data of body.oFile) {
            if (data) {
                try {
                    data = _.parse(data);
                    data.name = ['png', 'jpg', 'jpeg'].includes(data.name) ? data.name : 'png';
                } catch {
                    return res.reply(message.server_error('', req.query?.eLocale || 'en'));
                }
            }
            if (data && data.base64 && req.user.sUserName) {
                try {
                    const { buffer } = _.base64ToBuffer(data.base64);
                    const { Location } = await s3.upload({ buffer, name: data.name, type: data.base64.split(';')[0].split('/')[1] }, `${process.env.AWS_S3_FOLDER_PREFIX || ''}tickets/${req.user.sUserName}`);
                    if (Location) ticket.aMedia.push({ sUrl: Location, eType: 'image' });
                } catch (e) {
                    log.error(e);
                }
            }
        }
    } else {
        if (body.oFile) {
            try {
                body.oFile = _.parse(body.oFile);
                body.oFile.name = ['png', 'jpg', 'jpeg'].includes(body.oFile.name) ? body.oFile.name : 'png';
            } catch {
                return res.reply(message.server_error('', req.query?.eLocale || 'en'));
            }
        }
        if (body.oFile && body.oFile?.base64 && req.user.sUserName) {
            try {
                const { buffer } = _.base64ToBuffer(body.oFile.base64);
                const { Location } = await s3.upload({ buffer, name: body.oFile.name, type: body.oFile.base64.split(';')[0].split('/')[1] }, `${process.env.AWS_S3_FOLDER_PREFIX || ''}tickets/${req.user.sUserName}`);
                if (Location) ticket.aMedia.push({ sUrl: Location, eType: 'image' });
            } catch (e) {
                log.error(e);
            }
        }
    }

    if (body.iTournamentId) ticket.iTournamentId = body.iTournamentId;
    if (body.iTableId) ticket.iTableId = body.iTableId;

    Support.create(ticket, (error, support) => {
        if (error) return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        if (!support) return res.reply(message.not_found('support', req.query?.eLocale || 'en'));
        User.findOne({ _id: req.user._id }, { _id: false, sEmail: true, sUserName: true }, (err, user) => {
            if (err) console.error(`failed to get user with user_id ${req.user._id}`, err);
            email.send(email.ticketsCreate, { sEmail: user.sEmail, sUserName: user.sUserName });
        }).lean();
        res.reply(message.success('', req.query?.eLocale || 'en'), { ...support._doc });
        // sendgrid.send(sendgrid.sendSupport, { sEmail: req.user.sEmail, sUserName: req.user.sUserName, sTitle: ticket.sTitle, sDescription: ticket.sDescription }, _.errorCallback);
        // ses.send(ses.sendSupport, { sTicketId: data._doc._id, sEmail: req.user.sEmail, sUserName: req.user.sUserName, sTitle: ticket.eCategory, sDescription: ticket.sDescription, dDate: data._doc.dCreatedDate }, _.errorCallback);
        // if (process.env.NODE_ENV === 'prod') ses.send(ses.sendSupport, { sTicketId: data._doc._id, sEmail: req.user.sEmail, sUserName: req.user.sUserName, sTitle: ticket.eCategory, sDescription: ticket.sDescription, dDate: data._doc.dCreatedDate }, _.errorCallback);
    });
};

controller.addMessage = (req, res) => {
    const body = _.pick(req.body, ['sMessage']);
    const params = _.pick(req.params, ['iSupportId']);
    const query = { _id: params.iSupportId };
    const updateQuery = {
        $push: { aDiscussion: { sMessage: body.sMessage } },
    };
    Support.updateOne(query, updateQuery, (error, data) => {
        if (error) return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        if (!data) return res.reply(message.not_found('support', req.query?.eLocale || 'en'));
        return res.reply(message.success('', req.query?.eLocale || 'en'));
    });
};

controller.addMedia = (req, res) => {
    const params = _.pick(req.params, ['iSupportId']);
    const query = { _id: params.iSupportId };
    if (!req.files) {
        return res.reply(message.required_field('files', req.query?.eLocale || 'en'));
    }

    const updateQuery = {
        $push: {
            aMedia: req.files.map(function (e) {
                return {
                    sUrl: e.location,
                    eType: e.mimetype.split('/')[0],
                };
            }),
        },
    };
    Support.updateOne(query, updateQuery, (error, support) => {
        if (error) {
            log.red('error :: ', error);
            return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        }
        if (!support) return res.reply(message.not_found('support', req.query?.eLocale || 'en'));
        return res.reply(message.success('', req.query?.eLocale || 'en'));
    });
};

controller.listTickets = (req, res) => {
    const body = _.pick(req.query, ['size', 'search', 'sort', 'orderBy', 'pageNumber', 'dStartDate', 'dEndDate', 'eState']);
    const sort = {};
    if (!body.sort) sort.dCreatedDate = -1;
    if (body.sort) sort[body.sort] = body.orderBy === 'DESC' ? -1 : 1;
    const skip = parseInt(body.pageNumber || 0) * parseInt(body.size || 0);
    const limit = parseInt(body.size ? body.size : 10);
    const match = {};
    const facetArray = [
        {
            $sort: sort,
        },
        {
            $skip: skip,
        },
        {
            $limit: limit,
        },
    ];
    if (body.eState) match.eState = body.eState;
    if (body.dStartDate && body.dEndDate) {
        const dStartDate = body.dStartDate ? new Date(body.dStartDate) : undefined;
        const dEndDate = body.dEndDate ? new Date(body.dEndDate) : undefined;
        match.$and = dStartDate && dEndDate ? [{ dCreatedDate: { $gte: dStartDate } }, { dCreatedDate: { $lt: dEndDate } }] : [];
    }
    const query = [
        {
            $match: { iUserId: mongodb.mongify(req.user._id), ...match },
        },
        {
            $project: {
                aDiscussion: 0,
                // _id: 0,
            },
        },
        {
            $facet: {
                tickets: facetArray,
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
    Support.aggregate(query, (error, data) => {
        if (error) return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        return res.reply(message.success('', req.query?.eLocale || 'en'), data);
    });
};

controller.getTicket = (req, res) => {
    const params = _.pick(req.params, ['iSupportId']);
    const query = { _id: params.iSupportId };
    Support.findOne(query, (error, support) => {
        if (error) return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        if (!support) return res.reply(message.not_found('support', req.query?.eLocale || 'en'));
        return res.reply(message.success('', req.query?.eLocale || 'en'), support);
    });
};

controller.deleteTicket = (req, res) => {
    const params = _.pick(req.params, ['iSupportId']);
    const query = { _id: params.iSupportId, iUserId: req.user._id, eState: 'inReview' };
    Support.findOneAndRemove(query, (error) => {
        if (error) return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        return res.reply(message.delete_success('Ticket', req.query?.eLocale || 'en'));
    });
};

module.exports = controller;
