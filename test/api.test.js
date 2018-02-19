"use strict"

const should = require("should")
const Api = require("../api")
const Snooper = require("../reddit-snooper")
const {mock_reddit, no_throttle} = require("./support/mock-reddit")

const token_reply = {status: 200, body: {access_token: "abc123", token_type: "bearer", expires_in: 3600, scope: "*"}}

function creds(reddit, extra) {
    return Object.assign({
        username:   "bot_account",
        password:   "fake_password",
        app_id:     "my_app_id",
        api_secret: "my_secret",
        user_agent: "node:snooper-tests:v1.0.0 (by /u/juicypasta)",
        endpoints:  reddit.endpoints
    }, extra)
}

describe("Api", function () {
    this.timeout(10000)

    describe("setup", function () {
        it("has a default user agent in the format reddit asks for", () => {
            Api.DEFAULT_USER_AGENT.should.match(/^node:reddit-snooper:v\d+\.\d+\.\d+ \(by \/u\/\w+\)$/)
            Snooper().api.user_agent.should.equal(Api.DEFAULT_USER_AGENT)
        })

        it("keeps a custom user agent", () => {
            Snooper({user_agent: "node:my-bot:v2 (by /u/someone)"}).api.user_agent.should.equal("node:my-bot:v2 (by /u/someone)")
        })

        it("sends authed calls to oauth.reddit.com", () => {
            let api = Api({app_id: "a", api_secret: "b"})
            api.construct_url("/api/v1/me/karma").should.equal("https://oauth.reddit.com/api/v1/me/karma")
            api.construct_url("r/pics/new", "GET").should.equal("https://oauth.reddit.com/r/pics/new")
        })

        it("falls back to the public .json pages for GETs without credentials", () => {
            let api = Api({})
            api.construct_url("r/pics/new", "GET").should.equal("https://www.reddit.com/r/pics/new.json")
            api.construct_url("/r/pics/about/", "GET").should.equal("https://www.reddit.com/r/pics/about.json")
            api.construct_url("/api/comment", "POST").should.equal("https://oauth.reddit.com/api/comment")
        })

        it("honors api_requests_per_minute", () => {
            Api({api_requests_per_minute: 30}).limiter.ms_between_requests.should.equal(2000)
            Api({}).limiter.ms_between_requests.should.equal(1000)
        })
    })

    describe("tokens", function () {
        let reddit
        afterEach((done) => reddit.close(done))

        it("logs in with the password grant and reuses the token", (done) => {
            mock_reddit(() => token_reply, () => ({status: 200, body: {karma: []}}), (r) => {
                reddit = r
                let api = no_throttle(Api(creds(reddit)))

                api.get("/api/v1/me/karma", {}, (err, status, data) => {
                    should(err).not.be.ok()
                    status.should.equal(200)

                    let token_req = reddit.www.requests[0]
                    token_req.method.should.equal("POST")
                    token_req.url.pathname.should.equal("/api/v1/access_token")
                    token_req.headers.authorization.should.equal("Basic " + Buffer.from("my_app_id:my_secret").toString("base64"))
                    token_req.headers["user-agent"].should.equal("node:snooper-tests:v1.0.0 (by /u/juicypasta)")
                    let form = new URLSearchParams(token_req.body)
                    form.get("grant_type").should.equal("password")
                    form.get("username").should.equal("bot_account")
                    form.get("password").should.equal("fake_password")

                    let call = reddit.oauth.requests[0]
                    call.headers.authorization.should.equal("bearer abc123")
                    call.headers["user-agent"].should.equal("node:snooper-tests:v1.0.0 (by /u/juicypasta)")

                    api.get("/api/v1/me/karma", {}, (err) => {
                        should(err).not.be.ok()
                        reddit.www.requests.length.should.equal(1) // no second token request
                        reddit.oauth.requests.length.should.equal(2)
                        done()
                    })
                })
            })
        })

        it("uses app only oauth when there is no username/password", (done) => {
            mock_reddit(() => token_reply, () => ({status: 200, body: {kind: "Listing", data: {children: []}}}), (r) => {
                reddit = r
                let api = no_throttle(Api(creds(reddit, {username: undefined, password: undefined})))

                api.get_token((err, token) => {
                    should(err).not.be.ok()
                    token.should.equal("bearer abc123")
                    new URLSearchParams(reddit.www.requests[0].body).get("grant_type").should.equal("client_credentials")
                    done()
                })
            })
        })

        it("asks for one token when a bunch of calls go out at once", (done) => {
            mock_reddit(() => token_reply, () => ({status: 200, body: {}}), (r) => {
                reddit = r
                let api = no_throttle(Api(creds(reddit)))
                let finished = 0

                for (let i = 0; i < 3; i++) {
                    api.get("/api/v1/me", {}, (err) => {
                        should(err).not.be.ok()
                        if (++finished === 3) {
                            reddit.www.requests.length.should.equal(1)
                            done()
                        }
                    })
                }
            })
        })

        it("returns an error on a bad password instead of a broken token", (done) => {
            mock_reddit(() => ({status: 200, body: {error: "invalid_grant"}}), null, (r) => {
                reddit = r
                let api = no_throttle(Api(creds(reddit)))

                api.get("/api/v1/me", {}, (err) => {
                    err.should.match(/invalid_grant/)
                    reddit.oauth.requests.length.should.equal(0)
                    done()
                })
            })
        })

        it("needs credentials to post", (done) => {
            mock_reddit(() => null, null, (r) => {
                reddit = r
                let api = no_throttle(Api({endpoints: reddit.endpoints}))

                api.post("/api/comment", {text: "hi"}, (err) => {
                    err.should.match(/app_id and api_secret/)
                    reddit.www.requests.length.should.equal(0)
                    reddit.oauth.requests.length.should.equal(0)
                    done()
                })
            })
        })

        it("gets a new token after a 401", (done) => {
            mock_reddit(() => token_reply, (req, n) => n === 1 ? {status: 401, body: {message: "Unauthorized", error: 401}} : {status: 200, body: {ok: true}}, (r) => {
                reddit = r
                let api = no_throttle(Api(creds(reddit)))

                api.get("/api/v1/me", {}, (err, status, data) => {
                    should(err).not.be.ok()
                    status.should.equal(200)
                    reddit.www.requests.length.should.equal(2)
                    done()
                })
            })
        })
    })

    describe("requests", function () {
        let reddit
        afterEach((done) => reddit.close(done))

        it("sends GET data as a query string, POST as a form and PATCH/PUT/DELETE as json", (done) => {
            mock_reddit(() => token_reply, () => ({status: 200, body: {}}), (r) => {
                reddit = r
                let api = no_throttle(Api(creds(reddit)))

                api.get("/api/info", {id: "t1_abc"}, () => {
                    api.post("/api/comment", {api_type: "json", text: "hello world", thing_id: "t1_abc"}, () => {
                        api.patch("/api/v1/me/prefs", {over_18: false}, () => {
                            api.delete("/api/v1/me/friends/juicypasta", {id: "juicypasta"}, () => {
                                let [get, post, patch, del] = reddit.oauth.requests

                                get.method.should.equal("GET")
                                get.url.searchParams.get("id").should.equal("t1_abc")

                                post.method.should.equal("POST")
                                post.headers["content-type"].should.equal("application/x-www-form-urlencoded")
                                new URLSearchParams(post.body).get("text").should.equal("hello world")

                                patch.method.should.equal("PATCH")
                                JSON.parse(patch.body).should.eql({over_18: false})

                                del.method.should.equal("DELETE")
                                del.url.pathname.should.equal("/api/v1/me/friends/juicypasta")
                                done()
                            })
                        })
                    })
                })
            })
        })

        it("waits out a 429 and tries again", (done) => {
            mock_reddit(() => token_reply, (req, n) => n === 1 ?
                {status: 429, headers: {"retry-after": "1"}, body: {message: "Too Many Requests", error: 429}} :
                {status: 200, body: {ok: true}}, (r) => {
                reddit = r
                let api = no_throttle(Api(creds(reddit)))
                let started = Date.now()

                api.get("/api/v1/me", {}, (err, status, data) => {
                    should(err).not.be.ok()
                    status.should.equal(200)
                    data.ok.should.be.true()
                    reddit.oauth.requests.length.should.equal(2)
                    ;(Date.now() - started).should.be.aboveOrEqual(950)
                    done()
                })
            })
        })

        it("slows down when reddit says we are out of requests", (done) => {
            mock_reddit(() => token_reply, () => ({status: 200, headers: {"x-ratelimit-remaining": "0.0", "x-ratelimit-used": "100", "x-ratelimit-reset": "1"}, body: {}}), (r) => {
                reddit = r
                let api = no_throttle(Api(creds(reddit)))

                api.get("/api/v1/me", {}, () => {
                    let first = Date.now()
                    api.get("/api/v1/me", {}, () => {
                        (Date.now() - first).should.be.aboveOrEqual(950)
                        done()
                    })
                })
            })
        })

        it("retries server errors", (done) => {
            mock_reddit(() => token_reply, (req, n) => n < 3 ? {status: 503, body: "<html>busy</html>"} : {status: 200, body: {ok: true}}, (r) => {
                reddit = r
                let api = no_throttle(Api(creds(reddit)))

                api.get("/api/v1/me", {}, (err, status) => {
                    should(err).not.be.ok()
                    status.should.equal(200)
                    reddit.oauth.requests.length.should.equal(3)
                    done()
                })
            })
        })

        it("passes along 'you are doing this too much'", (done) => {
            mock_reddit(() => token_reply, () => ({status: 200, body: {json: {ratelimit: 540, errors: [["RATELIMIT", "you are doing that too much", "ratelimit"]]}}}), (r) => {
                reddit = r
                let api = no_throttle(Api(creds(reddit)))

                api.post("/api/comment", {text: "hi"}, (err, status) => {
                    err.should.match(/try again in: 540 seconds/)
                    done()
                })
            })
        })

        it("does logged out GETs against the public pages", (done) => {
            mock_reddit((req) => ({status: 200, body: {kind: "Listing", data: {children: []}}}), null, (r) => {
                reddit = r
                let api = no_throttle(Api({endpoints: reddit.endpoints}))

                api.get("r/node/new", {limit: 5}, (err, status, data) => {
                    should(err).not.be.ok()
                    status.should.equal(200)
                    let req = reddit.www.requests[0]
                    req.url.pathname.should.equal("/r/node/new.json")
                    req.url.searchParams.get("limit").should.equal("5")
                    should(req.headers.authorization).not.be.ok()
                    req.headers["user-agent"].should.equal(Api.DEFAULT_USER_AGENT)
                    done()
                })
            })
        })
    })
})
