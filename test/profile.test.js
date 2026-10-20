/* eslint-disable */
const chai = require('chai');
const chaiHttp = require('chai-http');
const router = require('../index');

const server = router.httpServer;
chai.use(chaiHttp);

const store = {}

describe('Profile', () => {
    before(() => {
        store.token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1ZmI2MzRlZTUzNjUxYTJjODRmNDkwNjAiLCJpYXQiOjE2MDY5Nzg5NTN9.bFHMVJqGlD_k6wdJo5LLiyp_ioaVtXkEW7w0-Lg_iAM';
    });

    describe('/GET profile', () => {
        it('it should be get user profile', (done) => {
            chai.request(server)
                .get('/api/v1/profile/')
                .set('Authorization', store.token)
                .end((err, res) => {
                    if (err) return done(err)
                    chai.expect(res).to.have.status(200)
                    chai.expect(res.body.message).to.equals('successfully')
                    chai.expect(res.body.data).to.be.an('object').that.has.all.keys(["_id", "sUserName", "sEmail", "bIsEmailVerified", "sAvatar", "nWon", "nLost", "nTotalCoins"])
                    done()
                })
        })

        it('it should be get authorization error', (done) => {
            chai.request(server)
                .get('/api/v1/profile/')
                .end((err, res) => {
                    if (err) return done(err)
                    chai.expect(res).to.have.status(401)
                    chai.expect(res.body.message).to.equals('authentication Error, please try logging again')
                    done()
                })
        })
    })

    describe('/POST update email', () => {
        it('it should be update user email', (done) => {
            chai.request(server)
                .post('/api/v1/profile/update/email')
                .set('Authorization', store.token)
                .send({
                    sEmail: 'meera.v@yudiz.in'
                })
                .end((err, res) => {
                    if (err) return done(err)
                    chai.expect(res).to.have.status(200)
                    chai.expect(res.body.message).to.equals('Please verify your new email, Updated successfully')
                    done()
                })
        })

        it('it should be exists email address', (done) => {
            chai.request(server)
                .post('/api/v1/profile/update/email')
                .set('Authorization', store.token)
                .send({
                    sEmail: 'meera.g@yudiz.in'
                })
                .end((err, res) => {
                    if (err) return done(err)
                    chai.expect(res).to.have.status(409)
                    chai.expect(res.body.message).to.equals('Email already exists')
                    done()
                })
        })

        it('it should be authorization error', (done) => {
            chai.request(server)
                .post('/api/v1/profile/update/email')
                .send({
                    sEmail: 'meera.v@yudiz.in'
                })
                .end((err, res) => {
                    if (err) return done(err)
                    chai.expect(res).to.have.status(401)
                    chai.expect(res.body.message).to.equals('authentication Error, please try logging again')
                    done()
                })
        })
    })

    describe('/POST update username', () => {
        it('it should be update user username', (done) => {
            chai.request(server)
                .post('/api/v1/profile/update/username')
                .set('Authorization', store.token)
                .send({
                    sUserName: 'meera'
                })
                .end((err, res) => {
                    if (err) return done(err)
                    chai.expect(res).to.have.status(200)
                    chai.expect(res.body.message).to.equals('Updated successfully')
                    done()
                })
        })

        it('it should be exists username', (done) => {
            chai.request(server)
                .post('/api/v1/profile/update/username')
                .set('Authorization', store.token)
                .send({
                    sUserName: 'meera99' 
                })
                .end((err, res) => {
                    if (err) return done(err)
                    chai.expect(res).to.have.status(409)
                    chai.expect(res.body.message).to.equals('UserName already exists')
                    done()
                })
        })

        it('it should be authorization error', (done) => {
            chai.request(server)
                .post('/api/v1/profile/update/username')
                .send({
                    sUserName: 'meera990' 
                })
                .end((err, res) => {
                    if (err) return done(err)
                    chai.expect(res).to.have.status(401)
                    chai.expect(res.body.message).to.equals('authentication Error, please try logging again')
                    done()
                })
        })
    })
})
