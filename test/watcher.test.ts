import assert from "node:assert/strict"
import {once} from "node:events"
import {afterEach, describe, it} from "node:test"
import {ApiError, AuthError, FeedWatcher, IdWalker, Snooper, type Post, type Watcher} from "../src/index.ts"
import {listing, mockReddit, n36, testSnooper, type MockReddit} from "./support/mock-reddit.ts"

// first n items a watcher hands out, then stop it
async function take<T>(watcher: Watcher<T>, n: number): Promise<T[]> {
    const items: T[] = []
    if (n === 0) return items
    for await (const item of watcher) {
        items.push(item)
        if (items.length === n) break
    }
    return items
}

function failure(watcher: Watcher<unknown>): Promise<Error> {
    return new Promise((resolve) => watcher.on("item", () => {}).on("error", resolve))
}

describe("Watcher", () => {
    let reddit: MockReddit | null = null
    afterEach(async () => {
        await reddit?.close()
        reddit = null
    })

    it("post watcher skips whats already there and emits new posts, oldest first", async () => {
        reddit = await mockReddit((req, n) => {
            assert.equal(req.url.pathname, "/r/node/new.json")
            if (n === 1) return {body: listing("t3", [100])}
            return {body: listing("t3", [103, 102, 101, 100, 99])}
        })

        const posts = await take(testSnooper(reddit).watch.posts("node", {pollInterval: 10}), 3)
        assert.deepEqual(posts.map((post) => post.data.name), ["t3_2t", "t3_2u", "t3_2v"]) // 101, 102, 103
        assert.equal(reddit.www.requests[0]!.url.searchParams.get("limit"), "1")
    })

    it("keeps going when the last post it saw gets deleted", async () => {
        reddit = await mockReddit((req, n) => {
            if (n === 1) return {body: listing("t3", [100])}
            if (n === 2) return {body: listing("t3", [102, 101, 99, 98])} // 100 is gone
            return {body: listing("t3", [104, 102, 101, 99])} // and 103 got removed before we saw it
        })

        const posts = await take(testSnooper(reddit).watch.posts("node", {pollInterval: 10}), 3)
        assert.deepEqual(posts.map((post) => n36(post.data.id)), [101, 102, 104])
    })

    it("pages back when more than one page of comments came in", async () => {
        const page1: number[] = []
        for (let i = 300; i > 200; i--) page1.push(i)
        const page2 = [200, 199, 198, 150, 149]

        reddit = await mockReddit((req, n) => {
            assert.equal(req.url.pathname, "/r/node+javascript/comments.json")
            if (n === 1) return {body: listing("t1", [150])}
            if (req.url.searchParams.get("after") === "t1_" + (201).toString(36)) return {body: listing("t1", page2, "t1_" + (149).toString(36))}
            return {body: listing("t1", page1, "t1_" + (201).toString(36))}
        })

        const comments = await take(testSnooper(reddit).watch.comments("node+javascript", {pollInterval: 10}), 103)
        assert.equal(comments.length, 103) // 300..201 plus 200, 199, 198
        assert.equal(n36(comments[0]!.data.id), 198)
        assert.equal(n36(comments[102]!.data.id), 300)
    })

    it("listing watcher emits whats on the listing then only new stuff", async () => {
        reddit = await mockReddit((req, n) => {
            assert.equal(req.url.pathname, "/r/gifs/top.json")
            assert.equal(req.url.searchParams.get("t"), "week")
            if (n === 1) return {body: listing("t3", [5, 4, 3])}
            return {body: listing("t3", [5, 9, 4])}
        })

        const posts = await take(testSnooper(reddit).watch.listing("gifs", {sort: "top", time: "week", limit: 3, pollInterval: 10}), 4)
        assert.deepEqual(posts.map((post) => n36(post.data.id)), [5, 4, 3, 9])
    })

    it("listing watcher doesnt complain when a listing is short", async () => {
        reddit = await mockReddit(() => ({body: listing("t3", [2, 1])}))
        const watcher = testSnooper(reddit).watch.listing("tinysub", {sort: "top", time: "hour", limit: 50, pollInterval: 10})
        const errors: Error[] = []
        watcher.on("error", (err) => errors.push(err))

        assert.equal((await take(watcher, 2)).length, 2)
        assert.deepEqual(errors, [])
    })

    it("stops with an ApiError instead of crashing when the subreddit doesnt exist", async () => {
        reddit = await mockReddit(() => ({status: 404, body: {reason: "banned", message: "Not Found", error: 404}}))
        const watcher = testSnooper(reddit).watch.comments("deletedsub")

        await assert.rejects(take(watcher, 1), (err) => {
            assert.ok(err instanceof ApiError)
            assert.equal(err.status, 404)
            assert.match(err.message, /r\/deletedsub\/comments doesn't exist \(banned\)/)
            return true
        })
        assert.equal(watcher.closed, true)
    })

    it("treats reddit's redirect to search as a missing subreddit", async () => {
        reddit = await mockReddit(() => ({status: 302, headers: {location: "/subreddits/search.json?q=nope"}, body: ""}))
        const watcher = testSnooper(reddit).watch.posts("nope")

        const err = await failure(watcher)
        assert.match(err.message, /doesn't exist/)
        assert.equal(reddit.www.requests.length, 1) // didnt follow it
        assert.equal(watcher.closed, true)
    })

    it("says to use credentials when reddit blocks logged out requests", async () => {
        reddit = await mockReddit(() => ({status: 403, headers: {"content-type": "text/html"}, body: "<body>You've been blocked by network security.</body>"}))
        const err = await failure(testSnooper(reddit).watch.posts("pics"))
        assert.match(err.message, /auth: \{appId, appSecret\}/)
    })

    it("goes through oauth.reddit.com with a token when it has credentials", async () => {
        reddit = await mockReddit(
            () => ({body: {access_token: "watchertoken", token_type: "bearer", expires_in: 3600}}),
            (req, n) => {
                assert.equal(req.url.pathname, "/user/juicypasta/m/bots/new")
                assert.equal(req.headers.authorization, "bearer watchertoken")
                return {body: listing("t3", n === 1 ? [10] : [11, 10])}
            })

        const snooper = testSnooper(reddit, {auth: {appId: "id", appSecret: "secret"}})
        const [post] = await take(snooper.watch.multi("juicypasta", "bots", {pollInterval: 10}), 1)
        assert.equal(post!.data.name, "t3_b")
        assert.equal(new URLSearchParams(reddit.www.requests[0]!.body).get("grant_type"), "client_credentials")
    })

    it("lets you attach the error listener first", async () => {
        reddit = await mockReddit(() => ({body: listing("t3", [1])}))
        const watcher = testSnooper(reddit).watch.posts("pics")
        assert.doesNotThrow(() => watcher.on("error", () => {}).on("item", () => {}))
        watcher.close()
    })

    it("still yells about event names that dont exist", () => {
        const watcher = new Snooper().watch.posts("pics")
        // @ts-expect-error typescript catches it too
        assert.throws(() => watcher.on("comment", () => {}), /event type not recognized/)
        watcher.close()
    })

    it("cleans up subreddit names", () => {
        const watch = new Snooper().watch
        const path = (watcher: Watcher<unknown>) => (watcher as FeedWatcher<Post>).path
        assert.equal(path(watch.posts("/r/pics")), "r/pics/new")
        assert.equal(path(watch.posts("r/pics/")), "r/pics/new")
        assert.equal(path(watch.posts("pics+gifs")), "r/pics+gifs/new")
        assert.equal(path(watch.comments("AskReddit")), "r/AskReddit/comments")
        assert.equal(path(watch.multi("/u/juicypasta", "bots")), "user/juicypasta/m/bots/new")
        assert.equal(path(watch.listing("", {sort: "rising"})), "rising")
        assert.equal(path(watch.listing("all")), "r/all/hot")
        // all of reddit walks ids instead
        assert.ok(watch.comments() instanceof IdWalker)
        assert.ok(watch.posts("/r/all") instanceof IdWalker)
        assert.ok(watch.posts("ALL") instanceof IdWalker)
    })

    it("rejects bad listing options (and the gilded watcher is gone)", () => {
        const watch = new Snooper().watch
        // @ts-expect-error not a sort
        assert.throws(() => watch.listing("pics", {sort: "top_24"}), /invalid listing sort/)
        // @ts-expect-error hot doesn't take a time
        assert.throws(() => watch.listing("pics", {sort: "hot", time: "day"}), /invalid time/)
        assert.throws(() => watch.listing("pics", {limit: 0}), /limit/)
        assert.equal("gilded" in watch, false)
        assert.equal("getGildedWatcher" in watch, false)
    })

    describe("2.0", () => {
        it("emits items as events too, and stops on an AbortSignal", async () => {
            reddit = await mockReddit((req, n) => ({body: listing("t3", n === 1 ? [1] : [3, 2, 1])}))
            const controller = new AbortController()
            const watcher = testSnooper(reddit).watch.posts("node", {pollInterval: 10, signal: controller.signal})
            const seen: number[] = []

            watcher.on("item", (post) => {
                seen.push(n36(post.data.id))
                if (seen.length === 2) controller.abort()
            })
            await once(watcher, "close")
            const requests = reddit.www.requests.length
            await new Promise((resolve) => setTimeout(resolve, 50))

            assert.deepEqual(seen, [2, 3])
            assert.equal(watcher.closed, true)
            assert.equal(reddit.www.requests.length, requests) // nothing after close
        })

        it("retries errors that can fix themselves and stops on ones that can't", async () => {
            reddit = await mockReddit((req, n) => n === 1 ? {body: "<html>reddit is down</html>"} : {status: 404, body: {error: 404}})
            const watcher = testSnooper(reddit).watch.posts("node", {startAfter: "t3_a", pollInterval: 10})
            const errors: Error[] = []
            // events.once would reject on the first 'error', so wait for close by hand
            const closed = new Promise<void>((resolve) => watcher.once("close", () => resolve()))
            watcher.on("error", (err) => errors.push(err)).on("item", () => {})
            await closed

            assert.equal(errors.length, 2)
            assert.match(errors[0]!.message, /not a listing/) // tried again 5s later
            assert.equal((errors[1] as ApiError).status, 404) // and that one ended it
        })

        it("hands the cursor back as startAfter", async () => {
            reddit = await mockReddit(() => ({body: listing("t3", [12, 11, 10, 9])}))
            const watcher = testSnooper(reddit).watch.posts("node", {startAfter: "t3_a", pollInterval: 10}) // 10
            const posts = await take(watcher, 2)
            assert.deepEqual(posts.map((post) => n36(post.data.id)), [11, 12])
            assert.equal(watcher.cursor, "t3_c")
            assert.equal(reddit.www.requests[0]!.url.searchParams.get("limit"), "100") // no priming request

            // stopping after one of the three leaves the other two for next time
            const again = testSnooper(reddit).watch.posts("node", {startAfter: "t3_a", pollInterval: 10})
            assert.deepEqual((await take(again, 1)).map((post) => n36(post.data.id)), [11])
            assert.equal(again.cursor, "t3_b")
        })

        it("throws AuthErrors from the iterator", async () => {
            reddit = await mockReddit(() => ({status: 200, body: {error: "invalid_grant"}}))
            const snooper = testSnooper(reddit, {auth: {appId: "a", appSecret: "b"}})
            await assert.rejects(take(snooper.watch.comments("pics"), 1), AuthError)
        })
    })
})
