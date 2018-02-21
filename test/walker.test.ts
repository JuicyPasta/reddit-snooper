import assert from "node:assert/strict"
import {afterEach, describe, it} from "node:test"
import {setTimeout as sleep} from "node:timers/promises"
import {formatId, IdWalker, parseId, type Comment, type Post, type SnooperOptions, type SnooperWarning, type Watcher} from "../src/index.ts"
import {FakeIds, mockReddit, testSnooper, tokenReply, type Handler, type MockReddit} from "./support/mock-reddit.ts"

let reddit: MockReddit | null = null

async function fakeReddit(fake: FakeIds, wrap?: (handler: Handler) => Handler): Promise<MockReddit> {
    reddit = await mockReddit(() => tokenReply, wrap ? wrap(fake.handler) : fake.handler)
    return reddit
}

interface WalkerOptions {
    startAfter?: number | string
    pollInterval?: number
    signal?: AbortSignal
}

function walker<T extends Post | Comment>(kind: "posts" | "comments", options: WalkerOptions, extra: SnooperOptions = {}): IdWalker<T> {
    const snooper = testSnooper(reddit!, {auth: {appId: "a", appSecret: "b"}, ...extra})
    const startAfter = typeof options.startAfter === "number" ? formatId(BigInt(options.startAfter)) : options.startAfter
    const watcher = kind === "posts"
        ? snooper.watch.posts("all", {...options, startAfter})
        : snooper.watch.comments("", {...options, startAfter})
    assert.ok(watcher instanceof IdWalker)
    return watcher as unknown as IdWalker<T>
}

async function take<T extends Post | Comment>(watcher: Watcher<T>, n: number): Promise<number[]> {
    const ids: number[] = []
    for await (const item of watcher) {
        ids.push(Number(parseId(item.data.name)))
        if (ids.length === n) break
    }
    return ids
}

function warnings(watcher: Watcher<unknown>): SnooperWarning[] {
    const seen: SnooperWarning[] = []
    watcher.on("warning", (warning) => seen.push(warning))
    return seen
}

function range(from: number, to: number): number[] {
    return Array.from({length: to - from + 1}, (_, i) => from + i)
}

describe("IdWalker (sitewide watchers)", () => {
    afterEach(async () => {
        await reddit?.close()
        reddit = null
    })

    it("seeds from the newest post on /r/all/new and hands out only newer ones, in id order", async () => {
        const fake = new FakeIds("t3").add(1, 60)
        fake.seed = 40n
        await fakeReddit(fake)

        const posts = walker<Post>("posts", {pollInterval: 10})
        assert.equal(posts.cursor, null)
        assert.deepEqual(await take(posts, 20), range(41, 60))

        const seed = reddit!.oauth.requests[0]!
        assert.equal(seed.url.pathname, "/r/all/new")
        assert.equal(seed.url.searchParams.get("limit"), "1")
        assert.equal(fake.infoRequests[0]![0], 41n)
        assert.equal(posts.cursor, "t3_" + formatId(60n))
    })

    it("asks for 100 ids a request and catches up a backlog without waiting", async () => {
        const fake = new FakeIds("t3").add(1, 300)
        await fakeReddit(fake)
        const started = Date.now()

        // a minute between polls, so any waiting would time the test out
        assert.deepEqual(await take(walker<Post>("posts", {startAfter: 0, pollInterval: 60_000}), 300), range(1, 300))
        assert.ok(Date.now() - started < 2000)

        const [first, second, third] = fake.infoRequests
        assert.deepEqual(first, range(1, 100).map(BigInt))
        assert.deepEqual(second, range(101, 200).map(BigInt))
        assert.deepEqual(third, range(201, 300).map(BigInt))
        const ids = reddit!.oauth.requests.find((req) => req.url.pathname === "/api/info")!.url.searchParams.get("id")!.split(",")
        assert.equal(ids.length, 100)
        assert.equal(ids[0], "t3_1")
        assert.equal(ids[35], "t3_10") // 36 carries
    })

    it("leaves a cursor that picks up right after the last item it handed out", async () => {
        const fake = new FakeIds("t3").add(1, 300)
        await fakeReddit(fake)

        // stops halfway through the second batch of 100
        const first = walker<Post>("posts", {startAfter: 0, pollInterval: 10})
        assert.deepEqual(await take(first, 150), range(1, 150))
        assert.equal(first.cursor, "t3_" + formatId(150n))

        const second = walker<Post>("posts", {startAfter: first.cursor!, pollInterval: 10})
        assert.deepEqual(await take(second, 150), range(151, 300))
    })

    it("carries past zz, and walks comments the same way from /r/all/comments", async () => {
        const fake = new FakeIds("t1").add(1290, 1300)
        fake.seed = parseId("zz") // 1295
        await fakeReddit(fake)

        const comments = walker<Comment>("comments", {pollInterval: 10})
        assert.deepEqual(await take(comments, 5), range(1296, 1300))
        assert.equal(reddit!.oauth.requests[0]!.url.pathname, "/r/all/comments")
        assert.equal(fake.infoRequests[0]![0], parseId("100"))
        assert.match(reddit!.oauth.requests[1]!.url.searchParams.get("id")!, /^t1_100,t1_101,/)
    })

    it("steps over ids that never come back (deleted, removed, spam...)", async () => {
        // a 70 id gap inside a batch, a 250 id gap across batches, and every 7th id deleted
        const missing = (id: bigint) => (id >= 120n && id < 190n) || (id > 300n && id <= 550n) || id % 7n === 0n
        const fake = new FakeIds("t3").add(1, 800, missing)
        await fakeReddit(fake)

        const posts = walker<Post>("posts", {startAfter: 0, pollInterval: 10})
        const expected = range(1, 800).filter((id) => !missing(BigInt(id)))
        assert.deepEqual(await take(posts, expected.length), expected)
        assert.ok(fake.infoRequests.length < 20, `${fake.infoRequests.length} requests`)
    })

    it("jumps a big hole in a handful of requests without losing anything past it", async () => {
        // ~20,000 ids that never show up, like an id jump
        const fake = new FakeIds("t3").add(1, 50).add(20_050, 45_000)
        await fakeReddit(fake)

        const posts = walker<Post>("posts", {startAfter: 0, pollInterval: 10})
        const seen = warnings(posts)
        const ids = await take(posts, 550)

        assert.deepEqual(ids, [...range(1, 50), ...range(20_050, 20_549)])
        const toCross = fake.infoRequests.findIndex((req) => req.some((id) => id >= 20_050n && id <= 20_150n && req[0]! >= 19_000n))
        assert.ok(toCross >= 0 && toCross < 10, `took ${toCross + 1} requests to get past the hole`)
        assert.ok(seen.some((warning) => warning.code === "skipped-ids"))
    })

    it("falls back on the listing when it's stuck in front of a hole wider than the lookahead", async () => {
        const fake = new FakeIds("t3").add(1, 10).add(250_000, 250_400)
        await fakeReddit(fake)

        const posts = walker<Post>("posts", {startAfter: 10, pollInterval: 5})
        const seen = warnings(posts)
        assert.deepEqual(await take(posts, 300), range(250_000, 250_299))
        assert.ok(fake.listingRequests >= 1)
        assert.ok(seen.some((warning) => warning.code === "skipped-ids"))
    })

    it("picks up ids that show up late, and gives up on the ones that never do", async () => {
        const fake = new FakeIds("t3").add(1, 10, (id) => id === 5n || id === 7n).showLate(5, 3)
        await fakeReddit(fake)

        const posts = walker<Post>("posts", {startAfter: 0, pollInterval: 20})
        const ids: number[] = []
        posts.on("item", (post) => ids.push(Number(parseId(post.data.name))))
        await sleep(800)
        posts.close()

        assert.deepEqual(ids, [1, 2, 3, 4, 6, 8, 9, 10, 5])
        // asked for in the batch, then lateRetries (3) more times, then dropped
        assert.equal(fake.infoRequests.filter((req) => req.includes(7n)).length, 4)
    })

    it("sits quietly at the head and keeps going when new posts show up", async () => {
        const fake = new FakeIds("t3").add(1, 10)
        await fakeReddit(fake)

        const posts = walker<Post>("posts", {startAfter: 10, pollInterval: 50})
        const ids: number[] = []
        posts.on("item", (post) => ids.push(Number(parseId(post.data.name))))
        await sleep(600)

        // one request per pollInterval, not a flood
        const idle = fake.infoRequests.length
        assert.ok(idle >= 5 && idle <= 14, `${idle} requests in 600ms`)
        assert.deepEqual(ids, [])

        fake.add(11, 15)
        await sleep(150)
        posts.close()
        assert.deepEqual(ids, range(11, 15))
    })

    it("goes through the rate limiter and waits out a 429 without losing or repeating anything", async () => {
        const fake = new FakeIds("t3").add(1, 400)
        fake.infoReply = (n) => n === 2 ? {status: 429, headers: {"retry-after": "1"}, body: {message: "Too Many Requests", error: 429}} : null
        await fakeReddit(fake)

        const started = Date.now()
        const posts = walker<Post>("posts", {startAfter: 0, pollInterval: 10}, {requestsPerMinute: 600})
        assert.deepEqual(await take(posts, 400), range(1, 400))

        const times = reddit!.oauth.requests.filter((req) => req.url.pathname === "/api/info").map((req) => req.at)
        for (let i = 1; i < times.length; i++) assert.ok(times[i]! - times[i - 1]! >= 90, `requests ${times[i]! - times[i - 1]!}ms apart`)
        assert.ok(Date.now() - started >= 1000)
        assert.equal(fake.infoRequests[1]![0], fake.infoRequests[2]![0]) // the 429'd batch was asked for again
    })

    it("warns when it falls minutes behind reddit", async () => {
        const fake = new FakeIds("t1").add(1, 250)
        fake.createdUtc = Date.now() / 1000 - 10 * 60
        await fakeReddit(fake)

        const comments = walker<Comment>("comments", {startAfter: 0, pollInterval: 10}, {requestsPerMinute: 60})
        const seen = warnings(comments)
        await take(comments, 100)
        assert.equal(seen.length, 1)
        assert.equal(seen[0]!.code, "behind")
        assert.match(seen[0]!.message, /10 minutes behind.*requestsPerMinute \(60\)/)
    })

    it("stops cleanly on an AbortSignal, even mid request", async () => {
        const fake = new FakeIds("t3").add(1, 120)
        await fakeReddit(fake, (handler) => async (req, n) => {
            if (n > 1) await sleep(1000) // the second batch takes a while
            return handler(req, n)
        })

        const controller = new AbortController()
        const posts = walker<Post>("posts", {startAfter: 0, pollInterval: 10, signal: controller.signal})
        const closed = new Promise<void>((resolve) => posts.once("close", () => resolve()))
        const ids: number[] = []
        setTimeout(() => controller.abort(), 200)

        const started = Date.now()
        for await (const post of posts) ids.push(Number(parseId(post.data.name)))
        await closed

        assert.deepEqual(ids, range(1, 100)) // the loop just ends, no error
        assert.ok(Date.now() - started < 600, "didn't wait for the slow request")
        const requests = reddit!.oauth.requests.length
        await sleep(100)
        assert.equal(reddit!.oauth.requests.length, requests)
        assert.equal(posts.closed, true)
    })
})
