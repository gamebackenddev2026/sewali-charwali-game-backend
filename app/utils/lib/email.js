const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');

AWS.config.update({
    accessKeyId: process.env.AWS_ACCESSKEYID,
    secretAccessKey: process.env.AWS_SECRETKEY,
    region: process.env.AWS_REGION,
});

const ses = new AWS.SES();

const templates = (file, body) => {
    const emailTemplate = path.join(__dirname, 'dir/email_templates', file);
    const template = fs.readFileSync(emailTemplate, { encoding: 'utf-8' });
    return ejs.render(template, body);
};

const category = {
    verification: (body) => ({
        Subject: { Data: 'Welcome' },
        Body: { Html: { Data: templates('account_activation.html', body) } }, // {sEmail: 'anuj.jha.ind@gmail.com', link: '' }
    }),
    forgotPassword: (body) => ({
        Subject: { Data: 'Forgot Password' },
        Body: { Html: { Data: templates('forgot_password.html', body) } },
    }),
    verify: (body) => ({
        Subject: { Data: 'Email verification' },
        Body: { Html: { Data: templates('account_verification.html', body) } },
    }),
    ticketsCreate: (body) => ({
        Subject: { Data: 'Ticket Created' },
        Body: { Html: { Data: templates('ticket_create.html', body) } }, // body -> { sEmail: user.sEmail, sUserName: user.sUserName }
    }),
    ticketsClose: (body) => ({
        Subject: { Data: 'Ticket Closed' },
        Body: { Html: { Data: templates('ticket_close.html', body) } }, // body -> { sEmail: user.sEmail, sUserName: user.sUserName }
    }),

    ticketsReject: (body) => ({
        Subject: { Data: 'Ticket Rejected' },
        Body: { Html: { Data: templates('ticket_reject.html', body) } }, // body -> { sEmail: user.sEmail, sUserName: user.sUserName }
    }),
    // not given by client
    ticketsUpdate: (body) => ({
        Subject: { Data: 'Ticket Status' },
        Body: { Html: { Data: templates('ticket_update.html', body) } }, // body -> { iTicketId: '', sEmail: user.sEmail, sPrevStatus: report.eState, sCurrStatus: body.eState, sUserName: user.sUserName }
    }),
};

const service = {};

service.send = (type, body) => {
    const email = {
        Source: process.env.EMAIL,
        Destination: {
            ToAddresses: [body.sEmail],
        },
        Message: type(body),
    };

    ses.sendEmail(email, (err, data) => {
        if (err) log.red(err, err.stack);
        // log.console(data);
    });
};

module.exports = { ...service, ...category };
