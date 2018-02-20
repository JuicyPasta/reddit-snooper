// hits the real reddit api, skipped unless these are set:
// REDDIT_APP_ID, REDDIT_APP_SECRET (watcher + reads) and REDDIT_USERNAME, REDDIT_PASSWORD (as your bot)
// npm run test:integ

import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {Snooper, type Listing, type Post} from "../../src/index.ts"

const env = process.env
const app = env.REDDIT_APP_ID && env.REDDIT_APP_SECRET ? {appId: env.REDDIT_APP_ID, appSecret: env.REDDIT_APP_SECRET} : null
const bot = app && env.REDDIT_USERNAME && env.REDDIT_PASSWORD ? {...app, username: env.REDDIT_USERNAME, password: env.REDDIT_PASSWORD} : null
const userAgent = "node:reddit-snooper-integ:v2.0.0 (by /u/juicypasta)"

describe("real reddit, app only", {skip: !app && "no REDDIT_APP_ID / REDDIT_APP_SECRET"}, () => {
    const snooper = new Snooper({auth: app!, userAgent})

    it("gets a token", async () => {
        assert.match(await snooper.api.token(), /^bearer /i)
    })

    it("/api/info", async () => {
        const [post] = await snooper.api.info<Post>(["t3_6arf2r"])
        assert.equal(post?.kind, "t3")
    })

    it("/r/all/new", async () => {
        const listing = await snooper.api.get<Listing<Post>>("r/all/new", {limit: 2})
        assert.equal(listing.data.children.length, 2)
    })
})

describe("real reddit, as the bot", {skip: !bot && "no REDDIT_USERNAME / REDDIT_PASSWORD"}, () => {
    const snooper = new Snooper({auth: bot!, userAgent})

    it("/subreddits/mine/subscriber", async () => {
        const listing = await snooper.api.get<Listing>("subreddits/mine/subscriber", {limit: 2})
        assert.equal(listing.kind, "Listing")
    })

    it("PATCH /api/v1/me/prefs", async () => {
        const prefs = await snooper.api.patch<{over_18: boolean}>("/api/v1/me/prefs", {over_18: false})
        assert.equal(prefs.over_18, false)
    })

    it("POST /api/hide", async () => {
        await snooper.api.post("/api/hide", {id: "t3_6arf2r"})
    })

    it("PUT /api/v1/me/friends", async () => {
        const friend = await snooper.api.put<{name: string}>("/api/v1/me/friends/juicypasta", {name: "juicypasta"})
        assert.equal(friend.name, "juicypasta")
    })
})
