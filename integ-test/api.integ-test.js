'use strict'

const EventEmitter = require('events').EventEmitter;
const should = require('should');

const credentials = require('../secrets/reddit-credentials')
const Snooper = require('../reddit-snooper')
const snooper = Snooper(credentials)

describe("Api Basic Operations", function() {
    it("makes a get request", function(done) {
        this.skip()
        snooper.api.get('subreddits/mine/subscriber', {
            limit: 2,

        }, function(err, responseCode, data) {
            responseCode.should.be.equal(200)
            should(err).not.be.ok()
            data.data.children.length.should.be.equal(2)
            done()
        })

    })

    it("makes a post request", function(done) {
        this.skip()

        snooper.api.post('api/friend', {
            api_type: 'json',
            name: 'juicypasta',
            note: 'hi frriendd',
            type: 'friend',
            duration: 500

        }, function(err, responseCode, data) {
            responseCode.should.be.equal(200)
            done()

        })

    }).timeout(10000)

    it ("replies to a comment", function(done) {
        this.skip()

        snooper.api.post('api/comment', {
            api_type:'json',
            text: 'another_test',
            thing_id: 't1_dhavp8p',
        }, function(err, statusCode, data) {
            statusCode.should.be.equal(200)
            should(err).not.be.ok()
            data.json.errors.should.be.equal([])
            console.log(data.json.data.things)
            done()
        })
    }).timeout(2000)

    it("makes a put request", function(done) {
        this.skip()
        snooper.api.put('api/v1/me/friends', {
            name: 'juicypasta',
            note: 'hi frriendd',

        }, function(err, responseCode, data) {
            console.log("err " + err)
            console.log(data)
            console.log(resposneCode)
            //responseCode.should.be.equal(200)
            done()

        })

    })

    it("makes a patch request", function(done) {
        this.skip()
        snooper.api.patch('/api/v1/me/prefs/', {
            'over_18': false
        }, function(err, statusCode, data) {
            should(err).not.be.ok()
            data.over_18.should.be.equal(false)
            statusCode.should.be.equal(200)
            done()
        })
    }).timeout(5000)

    it("ratelimits", function(done) {
        for (let i = 0; i < 600; i++) {

            snooper.api.get('subreddits/mine/subscriber', {
                limit: 2,
            }, function(err, responseCode, data) {
                console.log(data)
                responseCode.should.be.equal(200)
                should(err).not.be.ok()
                data.data.children.length.should.be.equal(2)
            })
        }

    }).timeout(110000)
})