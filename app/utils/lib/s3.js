const AWS = require('aws-sdk');

function S3() {
    this.configure();
    this.s3 = new AWS.S3();
}

S3.prototype.configure = function () {
    AWS.config.region = process.env.AWS_REGION;
    AWS.config.update({
        accessKeyId: process.env.AWS_ACCESSKEYID,
        secretAccessKey: process.env.AWS_SECRETKEY,
    });
};

S3.prototype.upload = function (file, path = '') {
    const aFileName = file.name.split('.');
    const ext = aFileName[aFileName.length - 1] || 'octet-stream';
    const params = {
        Body: file.buffer,
        Bucket: process.env.AWS_S3_BUCKET,
        ACL: 'public-read',
        Key: `${path}/${Date.now()}-${_.shortid()}.${ext}`,
        ContentType: file.type || `application/octet-stream`,
        ContentEncoding: 'base64',
    };

    return this.s3.upload(params).promise();
};

S3.prototype.delete = function (url = '') {
    const [, , , ...filenameSplitted] = url.split('/');
    const params = {
        Bucket: process.env.S3_BUCKET,
        Key: filenameSplitted.join('/'),
    };

    this.s3.deleteObject(params, function (err, data) {
        if (data) {
            log.red('File deleted successfully');
        } else {
            log.green(`Check if you have sufficient permissions : ${err}`);
        }
    });
};

module.exports = new S3();
