const multer = require('multer');
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');

AWS.config.region = process.env.AWS_REGION;
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESSKEYID,
    secretAccessKey: process.env.AWS_SECRETKEY,
});

const s3 = new AWS.S3();
const services = {};

services.s3SupportMulterUpload = (name) => {
    const storage = multerS3({
        s3,
        bucket: process.env.AWS_S3_BUCKET,
        acl: 'public-read',
        key(req, file, cb) {
            const mimetypearray = file.mimetype.split('/');
            const mimetype = mimetypearray[1];
            cb(null, `${file.fieldname}-${_.sortid()}.${mimetype}`);
        },
    });
    return multer({ storage, limits: { fileSize: 4 * 1000 * 1000 } }).single(name);
};

module.exports = services;
