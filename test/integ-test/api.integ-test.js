"use strict"

const EventEmitter = require("events").EventEmitter
const should = require("should")

const credentials = require("../../secrets/reddit-credentials")
const Snooper = require("../../reddit-snooper")
const snooper = Snooper(credentials)

describe("Api Basic Operations", function () {
    it("Retrieves token", (done)=> {
        snooper.api.get_token((err, token) => {
            console.log(token)
            should(err).not.be.ok()
            token.should.be.ok()
            done()
        })
    })

    describe("GET Requests", function() {
        it("/subreddits/mine/subscriber", function (done) {
            snooper.api.get("subreddits/mine/subscriber", {
                limit: 2

            }, function (err, responseCode, data) {
                responseCode.should.be.equal(200)
                should(err).not.be.ok()
                data.data.children.length.should.be.equal(2)
                done()
            })

        }).timeout(10000)
        it("/api/info", function (done) {
            snooper.api.get("/api/info", {
                "id": "t1_dhcay8f"
            }, function (err, statusCode, data) {
                should(err).not.be.ok()
                data.kind.should.be.equal("Listing")
                statusCode.should.be.equal(200)
                done()
            })
        }).timeout(10000)

    })
    describe("POST Requests", function() {
        it("/api/hide", function (done) {
            snooper.api.post("/api/hide", {
                "id": "t3_6arf2r"
            }, function (err, statusCode, data) {
                should(err).not.be.ok()
                statusCode.should.be.equal(200)
                done()
            })
        }).timeout(10000)

    })
    describe("PUT Requests", function() {
        it("/api/v1/me/friends/juicypasta", function (done) {
            snooper.api.put("/api/v1/me/friends/juicypasta", {
                "name": "juicypasta",
            }, function (err, statusCode, data) {
                should(err).not.be.ok()
                statusCode.should.be.equal(200)
                data.name.should.be.equal("juicypasta")
                done()
            })
        }).timeout(10000)


    })
    describe("PATCH Requests", function() {
        it("/api/v1/me/prefs", function (done) {
            snooper.api.patch("/api/v1/me/prefs/", {
                "over_18": false
            }, function (err, statusCode, data) {
                should(err).not.be.ok()
                data.over_18.should.be.equal(false)
                statusCode.should.be.equal(200)
                done()
            })
        }).timeout(10000)


    })
    describe("DELETE Requests", function() {


    })
})