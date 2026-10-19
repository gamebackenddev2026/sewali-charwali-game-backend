/* eslint-disable */

const chai = require('chai');
const chaiHttp = require('chai-http');
const router = require('../index');

const server = router.httpServer;
chai.use(chaiHttp);

const store = {};

describe('Auth', () => {
    describe('/POST register', () => {
        it('it should be a register user', (done) => {
            chai.request(server)
                .post('/api/v1/auth/register')
                .send({
                    sUserName: 'meera99',
                    sEmail: 'meera.g@yudiz.in',
                    sPassword: '1111',
                    sConfirmPassword: '1111',
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body.message).to.equals('Register successfully');
                    done();
                });
        });

        it('it should not be register', (done) => {
            chai.request(server)
                .post('/api/v1/auth/register')
                .send({
                    sUserName: 'user',
                    sPassword: 'user',
                    sConfirmPassword: 'user',
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(419);
                    chai.expect(res.body.message).to.equals('Email field required');
                    done();
                });
        });

        it('it should not be a register user', (done) => {
            chai.request(server)
                .post('/api/v1/auth/register')
                .send({
                    sUserName: 'user123',
                    sEmail: 'user@gmail.com',
                    sPassword: 'user123',
                    sConfirmPassword: 'user11123',
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(406);
                    chai.expect(res.body.message).to.equals('Password not matched');
                    done();
                });
        });

        it('it should be a exist user', (done) => {
            chai.request(server)
                .post('/api/v1/auth/register')
                .send({
                    sUserName: 'admin123',
                    sEmail: 'meera.g@yudiz.in',
                    sPassword: 'user123',
                    sConfirmPassword: 'user123',
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(409);
                    chai.expect(res.body.message).to.equals('Email already exists');
                    done();
                });
        });
    });

    describe('/POST login', () => {
        it('it should be a login user', (done) => {
            chai.request(server)
                .post('/api/v1/auth/login')
                .send({
                    sUserName: 'meera99',
                    sPassword: '1111',
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body.message).to.equals('Login successfully');
                    done();
                });
        });

        it('it should not be a login user', (done) => {
            chai.request(server)
                .post('/api/v1/auth/login')
                .send({
                    sUserName: 'meera99',
                    sPassword: 'user1234222',
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(406);
                    chai.expect(res.body.message).to.equals('UserName and password not matched');
                    done();
                });
        });
    });

    describe('/POST forgot password', () => {
        it('it should be forgot password', (done) => {
            chai.request(server)
                .post('/api/v1/auth/password/forgot')
                .send({
                    sEmail: 'meera.g@yudiz.in',
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body.message).to.equals('OTP sent successfully');
                    done();
                });
        });

        it('it should be forgot password', (done) => {
            chai.request(server)
                .post('/api/v1/auth/password/forgot')
                .send({
                    sEmail: 'meera.g@yudiz.com',
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(404);
                    chai.expect(res.body.message).to.equals('Email not found');
                    done();
                });
        });
    });

    describe('/GET verify email', () => {
        it('it should be verify email', (done) => {
            chai.request(server)
                .get('/api/v1/auth/verify/email/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1ZmJiYTAwNjlhNjIyYjBjYzBhM2FmZTAiLCJpYXQiOjE2MDYxMzI1NDR9.UAlkxObjMWL9VQRJLkRMa2tU567YIgiAjQ_lo6m3o8E')
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body.message).to.equals('Email verified successfully');
                    done();
                });
        });

        it('it should be token error', (done) => {
            chai.request(server)
                .get('/api/v1/auth/verify/email/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1ZmJiYTAwNjlhNjIyYjBjYzBhM2FmZTAiLCJpYXQiOjE2MDYxMzI1NDR9')
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(401);
                    chai.expect(res.body.message).to.equals('authentication Error, please try logging again');
                    done();
                });
        });
    });

    describe('/POST resend otp', () => {
        it('it should be resend otp', (done) => {
            chai.request(server)
                .post('/api/v1/auth/resend/otp')
                .send({
                    sEmail: 'meera.g@yudiz.in',
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body.message).to.equals('OTP sent successfully');
                    done();
                });
        });

        it('it should be email not found', (done) => {
            chai.request(server)
                .post('/api/v1/auth/resend/otp')
                .send({
                    sEmail: 'meera@yudiz.in',
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(404);
                    chai.expect(res.body.message).to.equals('Email not found');
                    done();
                });
        });

        it('it should be email required', (done) => {
            chai.request(server)
                .post('/api/v1/auth/resend/otp')
                .send({})
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(419);
                    chai.expect(res.body.message).to.equals('Email field required');
                    done();
                });
        });
    });

    describe('/POST social login', () => {
        it('it should be login with facebook', (done) => {
            chai.request(server)
                .post('/api/v1/auth/login/facebook')
                .set('accessToken', accessToken)
                .send({
                    sFacebookId: '100000686899395',
                    accessToken: process.env.FACEBOOK_TEST_ACCESS_TOKEN,
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body.message).to.equals('Login successfully');
                });
        });
    });
});

describe('After login', () => {
    before(() => {
        store.token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1ZmJiYTAwNjlhNjIyYjBjYzBhM2FmZTAiLCJpYXQiOjE2MDYxMzI1NDR9.UAlkxObjMWL9VQRJLkRMa2tU567YIgiAjQ_lo6m3o8E';

        store.verifyToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1ZmJiYTAwNjlhNjIyYjBjYzBhM2FmZTAiLCJuT1RQIjoxMjM0LCJpYXQiOjE2MDYxMzI2MjZ9.qVxBh_KBMfuRxvE6CebMJxMfG4tR1ftd8xy5P4WWZcg';
    });

    describe('/POST reset password', () => {
        it('it should be reset password', (done) => {
            chai.request(server)
                .post('/api/v1/auth/password/reset')
                .set('Verification', store.token)
                .send({
                    sPassword: '11111',
                    nOTP: '1234',
                })
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body.message).to.equals('Password changed successfully');
                    done();
                });
        });

        it('it should be require field', (done) => {
            chai.request(server)
                .post('/api/v1/auth/password/reset')
                .set('Verification', store.token)
                .send({})
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(419);
                    chai.expect(res.body.message).to.equals('password field required');
                    done();
                });
        });
    });

    describe('/GET verify OTP', () => {
        it('it should be verify otp', (done) => {
            chai.request(server)
                .get('/api/v1/auth/verify/otp/1234')
                .set('Verification', store.verifyToken)
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body.message).to.equals('Login successfully');
                    done();
                });
        });

        it('it should be wrong otp', (done) => {
            chai.request(server)
                .get('/api/v1/auth/verify/otp/1111')
                .set('Verification', store.verifyToken)
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(403);
                    chai.expect(res.body.message).to.equals('entered OTP is invalid');
                    done();
                });
        });

        it('it should be token error', (done) => {
            chai.request(server)
                .get('/api/v1/auth/verify/otp/1234')
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(401);
                    chai.expect(res.body.message).to.equals('authentication Error, please try logging again');
                    done();
                });
        });
    });

    describe('/GET logout', () => {
        it('it should be logged out', (done) => {
            chai.request(server)
                .get('/api/v1/auth/logout')
                .set('Authorization', store.token)
                .end((err, res) => {
                    if (err) return done(err);
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body.message).to.equals('Logout successfully');
                    done();
                });
        });
    });
});
