const http = require('http');
const redis = require('./redis');
// const IpFilters = require('./../../../models/IpFilters');

const services = {};
services.getLocationFromIP = (ip, callback = () => {}) => {
    let data = '';
    http.get(`http://ip-api.com/json/${ip}`, function (resp) {
        resp.on('data', function (chunk) {
            data += chunk;
        });

        resp.on('end', function () {
            data = JSON.parse(data);
            callback(null, data);
        });

        resp.on('error', function (error) {
            callback(error);
        });
    });
};

services.validateLocation = async (ip = '127.0.0.1', callback = () => {}) => {
    if (ip === '127.0.0.1') return callback();
    const splitted = ip.split('.');
    const segment1 = parseInt(splitted[0]);
    const segment2 = parseInt(splitted[1]);
    const segment3 = parseInt(splitted[2]);
    const segment4 = parseInt(splitted[3]);

    // reverse order calc
    // eg. 255.255.240.0 &lt;-- start at the end
    // 0 + (240*256) + (255*65536) + (255*16777216)
    const ipNumber = segment4 + segment3 * 256 + segment2 * 65536 + segment1 * 16777216;
    const iprange = await redis.zrangebyscoreAsync('ip', ipNumber, ipNumber);
    if (iprange.length) return callback();

    const query = {
        $and: [{ nFrom: { $lte: ipNumber } }, { nTo: { $gte: ipNumber } }],
    };
    // IpFilters.find(query, async (error, response) => {
    //     if (error) return callback(error.toString());
    //     if (response.length) return callback({ message: message.not_allowed('region'), data: response[0] });
    //     callback();
    //     await redis.zaddAsync('ip', ipNumber, ipNumber);
    //     const ttl = await redis.ttlAsync('ip');
    //     if (ttl === -2) await redis.expireAsync('ip', 604800);
    // });
};

module.exports = services;
