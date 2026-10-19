const nodemailer = require('nodemailer');
const fs = require('fs');
const ejs = require('ejs');
const path = require('path');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    port: 465,
    host: process.env.SMTP_HOST,
    secure: false,
    secureConnection: false,
    auth: {
        user: process.env.NODEMAILER_USER,
        pass: process.env.NODEMAILER_PASSWORD,
    },
});

const getTemplate = (filename, body) => {
    body.dDate = _.formatedDate();
    const emailTemplatePath = path.join(__dirname, 'dir/email_templates', filename);
    const template = fs.readFileSync(emailTemplatePath, { encoding: 'utf-8' });
    return ejs.render(template, body);
};

const collection = {
    verification: (body) => ({
        subject: 'Welcome',
        html: getTemplate('account_activation.html', body),
    }),
    forgotPassword: (body) => ({
        subject: 'Forgot Password',
        html: getTemplate('forgot_password.html', body),
    }),
    verify: (body) => ({
        subject: 'Email verification',
        html: getTemplate('account_verification.html', body),
    }),
    ticketsCreate: (body) => ({
        subject: 'Ticket Created',
        html: getTemplate('ticket_create.html', body),
    }),
    ticketsClose: (body) => ({
        subject: 'Ticket Closed',
        html: getTemplate('ticket_close.html', body),
    }),
    ticketsReject: (body) => ({
        subject: 'Ticket Rejected',
        html: getTemplate('ticket_reject.html', body),
    }),
    ticketsUpdate: (body) => ({
        subject: 'Ticket Status',
        html: getTemplate('ticket_update.html', body),
    }),
    adminForgotPassword: (body) => ({
        subject: 'Forgot Password',
        html: getTemplate('admin_forgot_password.html', body),
    }),
};

const services = {};

services.send = function (type, body, callback) {
    // if (process.env.NODE_ENV !== 'prod') return callback();
    transporter.sendMail(
        {
            from: process.env.SMTP_EMAIL,
            to: body.sEmail,
            subject: type(body).subject,
            html: type(body).html,
        },
        (error) => {
            if (error) return callback(error);
            callback();
        }
    );
};

module.exports = { ...services, ...collection };
