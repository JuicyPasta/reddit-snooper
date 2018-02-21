import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {afterEach, describe, it} from "node:test"
import {ApiError, AuthError, DEFAULT_USER_AGENT, RateLimitError, RedditApi, Snooper, VERSION, type SnooperOptions} from "../src/index.ts"
import {mockReddit, tokenReply, type MockReddit} from "./support/mock-reddit.ts"

function creds(reddit: MockReddit, extra: SnooperOptions = {}): SnooperOptions {
    return {
        auth:                    {appId: "my_app_id", appSecret: "my_secret", username: "bot_account", password: "fake_password"},
        userAgent:               "node:snooper-tests:v1.0.0 (by /u/juicypasta)",
        endpoints:               reddit.endpoints,
        requestsPerMinute:       Infinity,
        publicRequestsPerMinute: Infinity,
        ...extra
    }
}

function api(reddit: MockReddit, extra?: SnooperOptions): RedditApi {
    return new RedditApi(creds(reddit, extra))
}

describe("Api", () => {
    describe("setup", () => {
        it("has a default user agent in the format reddit asks for", () => {
            assert.match(DEFAULT_USER_AGENT, /^node:reddit-snooper:v\d+\.\d+\.\d+ \(by \/u\/\w+\)$/)
            assert.equal(new Snooper().api.userAgent, DEFAULT_USER_AGENT)
            assert.equal(VERSION, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version)
        })

        it("keeps a custom user agent", () => {
            assert.equal(new Snooper({userAgent: "node:my-bot:v2 (by /u/someone)"}).api.userAgent, "node:my-bot:v2 (by /u/someone)")
        })

        it("sends authed calls to oauth.reddit.com", () => {
            const api = new RedditApi({auth: {appId: "a", appSecret: "b"}})
            assert.equal(api.url("/api/v1/me/karma"), "https://oauth.reddit.com/api/v1/me/karma")
            assert.equal(api.url("r/pics/new", "GET"), "https://oauth.reddit.com/r/pics/new")
        })

        it("falls back to the public .json pages for GETs without credentials", () => {
            const api = new RedditApi()
            assert.equal(api.url("r/pics/new", "GET"), "https://www.reddit.com/r/pics/new.json")
            assert.equal(api.url("/r/pics/about/", "GET"), "https://www.reddit.com/r/pics/about.json")
            assert.equal(api.url("/api/comment", "POST"), "https://oauth.reddit.com/api/comment")
        })

        it("honors requestsPerMinute and checks its options", async () => {
            assert.equal(new RedditApi().requestsPerMinute, 90)
            assert.throws(() => new RedditApi({requestsPerMinute: 0}), /requestsPerMinute/)
            assert.throws(() => new RedditApi({auth: {appId: "a", appSecret: ""}}), /appId and an appSecret/)
            // @ts-expect-error a username needs a password
            assert.throws(() => new RedditApi({auth: {appId: "a", appSecret: "b", username: "bot"}}), /username and a password/)

            // 600 a minute is one every 100ms
            const reddit = await mockReddit(() => tokenReply, () => ({body: {}}))
            try {
                const limited = new RedditApi(creds(reddit, {requestsPerMinute: 600}))
                await Promise.all([limited.get("/a"), limited.get("/b"), limited.get("/c")])
                const [a, b, c] = reddit.oauth.requests.map((req) => req.at)
                assert.ok(b! - a! >= 90 && c! - b! >= 90, `requests ${b! - a!}ms and ${c! - b!}ms apart`)
            } finally {
                await reddit.close()
            }
        })
    })

    describe("tokens", () => {
        let reddit: MockReddit
        afterEach(() => reddit.close())

        it("logs in with the password grant and reuses the token", async () => {
            reddit = await mockReddit(() => tokenReply, () => ({status: 200, body: {karma: []}}))
            const client = api(reddit)

            assert.deepEqual(await client.get("/api/v1/me/karma"), {karma: []})

            const tokenReq = reddit.www.requests[0]!
            assert.equal(tokenReq.method, "POST")
            assert.equal(tokenReq.url.pathname, "/api/v1/access_token")
            assert.equal(tokenReq.headers.authorization, "Basic " + Buffer.from("my_app_id:my_secret").toString("base64"))
            assert.equal(tokenReq.headers["user-agent"], "node:snooper-tests:v1.0.0 (by /u/juicypasta)")
            const form = new URLSearchParams(tokenReq.body)
            assert.equal(form.get("grant_type"), "password")
            assert.equal(form.get("username"), "bot_account")
            assert.equal(form.get("password"), "fake_password")

            const call = reddit.oauth.requests[0]!
            assert.equal(call.headers.authorization, "bearer abc123")
            assert.equal(call.headers["user-agent"], "node:snooper-tests:v1.0.0 (by /u/juicypasta)")

            await client.get("/api/v1/me/karma")
            assert.equal(reddit.www.requests.length, 1) // no second token request
            assert.equal(reddit.oauth.requests.length, 2)
        })

        it("uses app only oauth when there is no username/password", async () => {
            reddit = await mockReddit(() => tokenReply)
            const client = api(reddit, {auth: {appId: "my_app_id", appSecret: "my_secret"}})

            assert.equal(await client.token(), "bearer abc123")
            assert.equal(new URLSearchParams(reddit.www.requests[0]!.body).get("grant_type"), "client_credentials")
        })

        it("asks for one token when a bunch of calls go out at once", async () => {
            reddit = await mockReddit(() => tokenReply, () => ({body: {}}))
            const client = api(reddit)

            await Promise.all([client.get("/api/v1/me"), client.get("/api/v1/me"), client.get("/api/v1/me")])
            assert.equal(reddit.www.requests.length, 1)
            assert.equal(reddit.oauth.requests.length, 3)
        })

        it("throws an AuthError on a bad password instead of using a broken token", async () => {
            reddit = await mockReddit(() => ({status: 200, body: {error: "invalid_grant"}}))
            const client = api(reddit)

            await assert.rejects(client.get("/api/v1/me"), (err) => err instanceof AuthError && /invalid_grant/.test(err.message))
            assert.equal(reddit.oauth.requests.length, 0)
        })

        it("needs credentials to post", async () => {
            reddit = await mockReddit(() => null)
            const client = new RedditApi({endpoints: reddit.endpoints})

            await assert.rejects(client.post("/api/comment", {text: "hi"}), (err) => err instanceof AuthError && /appId, appSecret/.test(err.message))
            assert.equal(reddit.www.requests.length, 0)
            assert.equal(reddit.oauth.requests.length, 0)
        })

        it("gets a new token after a 401", async () => {
            reddit = await mockReddit(() => tokenReply, (req, n) => n === 1 ? {status: 401, body: {message: "Unauthorized", error: 401}} : {body: {ok: true}})
            const client = api(reddit)

            assert.deepEqual(await client.get("/api/v1/me"), {ok: true})
            assert.equal(reddit.www.requests.length, 2)
        })
    })

    describe("requests", () => {
        let reddit: MockReddit
        afterEach(() => reddit.close())

        it("sends GET data as a query string, POST as a form and PATCH/PUT/DELETE as json", async () => {
            reddit = await mockReddit(() => tokenReply, () => ({body: {}}))
            const client = api(reddit)

            await client.get("/api/info", {id: "t1_abc"})
            await client.post("/api/comment", {api_type: "json", text: "hello world", thing_id: "t1_abc"})
            await client.patch("/api/v1/me/prefs", {over_18: false})
            await client.put("/api/v1/me/friends/juicypasta", {name: "juicypasta"})
            await client.delete("/api/v1/me/friends/juicypasta", {id: "juicypasta"})
            const [get, post, patch, put, del] = reddit.oauth.requests

            assert.equal(get!.method, "GET")
            assert.equal(get!.url.searchParams.get("id"), "t1_abc")
            assert.equal(get!.url.searchParams.get("raw_json"), "1")

            assert.equal(post!.method, "POST")
            assert.equal(post!.headers["content-type"], "application/x-www-form-urlencoded")
            assert.equal(new URLSearchParams(post!.body).get("text"), "hello world")

            assert.equal(patch!.method, "PATCH")
            assert.deepEqual(JSON.parse(patch!.body), {over_18: false})
            assert.equal(put!.method, "PUT")
            assert.deepEqual(JSON.parse(put!.body), {name: "juicypasta"})

            assert.equal(del!.method, "DELETE")
            assert.equal(del!.url.pathname, "/api/v1/me/friends/juicypasta")
        })

        it("waits out a 429 and tries again", async () => {
            reddit = await mockReddit(() => tokenReply, (req, n) => n === 1
                ? {status: 429, headers: {"retry-after": "1"}, body: {message: "Too Many Requests", error: 429}}
                : {body: {ok: true}})
            const client = api(reddit)
            const started = Date.now()

            const res = await client.request<{ok: boolean}>("GET", "/api/v1/me")
            assert.equal(res.status, 200)
            assert.equal(res.body.ok, true)
            assert.equal(reddit.oauth.requests.length, 2)
            assert.ok(Date.now() - started >= 950)
        })

        it("slows down when reddit says we are out of requests", async () => {
            reddit = await mockReddit(() => tokenReply, () => ({headers: {"x-ratelimit-remaining": "0.0", "x-ratelimit-used": "100", "x-ratelimit-reset": "1"}, body: {}}))
            const client = api(reddit)

            await client.get("/api/v1/me")
            const first = Date.now()
            await client.get("/api/v1/me")
            assert.ok(Date.now() - first >= 950)
        })

        it("retries server errors", async () => {
            reddit = await mockReddit(() => tokenReply, (req, n) => n < 3 ? {status: 503, body: "<html>busy</html>"} : {body: {ok: true}})
            const client = api(reddit)

            assert.deepEqual(await client.get("/api/v1/me"), {ok: true})
            assert.equal(reddit.oauth.requests.length, 3)
        })

        it("throws a RateLimitError for 'you are doing this too much', and reddit's other json errors as ApiErrors", async () => {
            reddit = await mockReddit(() => tokenReply, (req) => req.url.pathname === "/api/comment"
                ? {body: {json: {ratelimit: 540, errors: [["RATELIMIT", "you are doing that too much", "ratelimit"]]}}}
                : {body: {json: {errors: [["THREAD_LOCKED", "that thread is locked", "parent"]]}}})
            const client = api(reddit)

            await assert.rejects(client.post("/api/comment", {text: "hi"}), (err) => {
                assert.ok(err instanceof RateLimitError)
                assert.match(err.message, /try again in: 540 seconds/)
                assert.equal(err.retryAfterMs, 540_000)
                return true
            })
            await assert.rejects(client.post("/api/submit", {text: "hi"}), (err) => {
                assert.ok(err instanceof ApiError && !(err instanceof RateLimitError))
                assert.equal(err.errors[0]![0], "THREAD_LOCKED")
                assert.match(err.message, /that thread is locked/)
                return true
            })
        })

        it("does logged out GETs against the public pages", async () => {
            reddit = await mockReddit(() => ({body: {kind: "Listing", data: {children: []}}}))
            const client = new RedditApi({endpoints: reddit.endpoints, publicRequestsPerMinute: Infinity})

            await client.get("r/node/new", {limit: 5})
            const req = reddit.www.requests[0]!
            assert.equal(req.url.pathname, "/r/node/new.json")
            assert.equal(req.url.searchParams.get("limit"), "5")
            assert.equal(req.headers.authorization, undefined)
            assert.equal(req.headers["user-agent"], DEFAULT_USER_AGENT)
        })
    })

    describe("2.0", () => {
        let reddit: MockReddit
        afterEach(() => reddit.close())

        it("throws ApiErrors with the status for 4xx", async () => {
            reddit = await mockReddit(() => tokenReply, () => ({status: 403, body: {reason: "private", message: "Forbidden", error: 403}}))
            await assert.rejects(api(reddit).get("/r/secret/about"), (err) => {
                assert.ok(err instanceof ApiError)
                assert.equal(err.status, 403)
                assert.equal(err.path, "/r/secret/about")
                assert.match(err.message, /\/r\/secret\/about is private or forbidden \(private\)/)
                return true
            })
        })

        it("lets your calls cut in front of a watcher's", async () => {
            reddit = await mockReddit(() => tokenReply, () => ({body: {}}))
            const client = api(reddit, {requestsPerMinute: 600})

            const low = [1, 2, 3].map((n) => client.get(`/low/${n}`, {}, {priority: "low"}))
            await new Promise((resolve) => setTimeout(resolve, 20)) // first low one goes right away
            const mine = client.get("/mine")
            await Promise.all([...low, mine])
            assert.deepEqual(reddit.oauth.requests.map((req) => req.url.pathname), ["/low/1", "/mine", "/low/2", "/low/3"])
        })

        it("stops a call that's waiting its turn when its signal aborts", async () => {
            reddit = await mockReddit(() => tokenReply, () => ({body: {}}))
            const client = api(reddit, {requestsPerMinute: 60})
            const controller = new AbortController()

            await client.get("/first")
            const waiting = client.get("/second", {}, {signal: controller.signal})
            controller.abort()
            await assert.rejects(waiting, {name: "AbortError"})
            assert.equal(reddit.oauth.requests.length, 1)
        })

        it("info asks for up to 100 fullnames at once", async () => {
            reddit = await mockReddit(() => tokenReply, (req) => ({body: {kind: "Listing", data: {after: null, before: null, children: req.url.searchParams.get("id")!.split(",").map((name) => ({kind: "t3", data: {name}}))}}}))
            const client = api(reddit)

            const posts = await client.info(["t3_a", "t3_b"])
            assert.deepEqual(posts.map((post) => post.data.name), ["t3_a", "t3_b"])
            await assert.rejects(client.info(Array.from({length: 101}, (_, i) => `t3_${i}`)), RangeError)
            assert.deepEqual(await client.info([]), [])
            assert.equal(reddit.oauth.requests.length, 1)
        })
    })
})
