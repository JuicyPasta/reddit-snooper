import type {RedditApi} from "./api.ts"
import {SnooperError} from "./errors.ts"
import {parseId, toFullname} from "./ids.ts"
import {isListing, type Comment, type Post, type Thing} from "./types.ts"
import {StreamWatcher, type Poll, type StreamOptions} from "./watcher.ts"

// The sitewide watchers don't poll /r/all/new or /r/all/comments, they walk the id space instead.
// reddit hands out post ids (t3_) and comment ids (t1_) from counters in base 36, and /api/info takes up
// to 100 fullnames at a time, so we just keep asking for the next 100 ids.
//
// - seed: the newest item on /r/all/new (or /r/all/comments), or startAfter if you saved a cursor
// - each request: the next ids in a row from the cursor, plus (when caught up) up to 20 ids that might
//   show up late, plus 10 pairs of probe ids past the end if the last batch came back empty. 100 fullnames total
// - the newest id that comes back is proof of how far reddit has gotten. anything missing below it
//   is a gap (deleted, removed, spam, private or quarantined sub, or just late), anything above it
//   hasn't happened yet and gets asked for again next time
// - head: we're caught up when the batch ends in a run of at least 5 missing ids (more likely not made
//   yet than all deleted), or ends short with items from the last 30 seconds (room for clock skew).
//   then wait pollInterval before asking again, one request per pollInterval at the head. fewer than 5
//   missing at the end of a batch of older stuff is just deletions, so while catching up it keeps going.
//   either way the missing tail isn't written off, it's the start of the next batch
// - late: a gap next to items less than 2 minutes old gets asked for again lateRetries times, about
//   1, 5 and 21 poll intervals after it went missing. older gaps are just gone. the re-asks only ride
//   along on polls right after we were caught up, so catching up always gets all 100 slots
// - holes: when a whole batch comes back empty the next requests send probes. with no idea how far
//   reddit has gotten they reach out 100, 215, 464... up to 100,000 ids. once one lands, they're
//   spread evenly between the batch and the furthest id we know exists. after 3 empty batches in a row
//   we jump to just past the last probe pair that came back empty, warn about it ('skipped-ids'),
//   and keep reading from there. every jump shrinks the unknown stretch ~11x so a hole of any size
//   costs a handful of requests, not one per 100 ids
// - stall: 12 empty polls at the head with no probe hits means a hole past the lookahead or reddit
//   being weird, so we check the listing's newest id again and treat it as the furthest known id
//
// request budget (reddit caps an oauth app at ~100 a minute): going by how fast the ids have been
// climbing the last couple of years reddit makes about 1,000 post ids and 7,000 comment ids a minute,
// spam and removed stuff included. posts: one poll every 5s at the head comes back with ~80 ids,
// ~12 requests a minute (~15 when there are a lot of late ids to re-ask for). comments: 100 ids
// fill up in under a second, so that walker basically never waits and runs at ~70 requests a minute.
// the default requestsPerMinute of 90 covers that with ~20 left over, and your own calls go first
const BATCH = 100
const MAX_RECHECKS = 20
const PROBE_PAIRS = 10
const LOOKAHEAD = 100_000
const HOLE_BATCHES = 3
const STALL_POLLS = 12
const MAX_GAPS = 2_000
const LATE_WINDOW_S = 120
const HEAD_TAIL = 5      // missing ids in a row at the end of a batch that mean "not made yet"
const FRESH_S = 30       // newest item younger than this means we're at the head
const BEHIND_WARN_S = 5 * 60
const WARN_EVERY_MS = 10 * 60_000

interface Gap {
    left: number  // re-asks left
    due: number   // not before this (ms)
    delay: number // ms until the one after that
}

interface Probes {
    pairs: [bigint, bigint][]
    bounded: boolean // spread out below an id we know exists, so a miss means nothing is there
}

export class IdWalker<T extends Post | Comment> extends StreamWatcher<T> {
    readonly kind: T["kind"]
    readonly lateRetries: number
    readonly #seedPath: string
    #next: bigint | null = null // lowest id we haven't dealt with yet
    #head = -1n                 // highest id we know exists
    #gaps = new Map<bigint, Gap>()
    #emptyRun = 0               // polls in a row where nothing in the batch came back
    #caughtUp = false           // the last poll reached the head
    #warnedBehindAt = -Infinity

    constructor(api: RedditApi, kind: T["kind"], options: StreamOptions = {}) {
        super(api, options, kind === "t1" ? 1_000 : 5_000)
        this.kind = kind
        this.#seedPath = kind === "t1" ? "r/all/comments" : "r/all/new"
        this.lateRetries = options.lateRetries ?? 3
        if (!Number.isInteger(this.lateRetries) || this.lateRetries < 0) {
            throw new TypeError(`lateRetries has to be a whole number, 0 or more, got ${options.lateRetries}`)
        }
        if (options.startAfter !== undefined) {
            this.#next = parseId(options.startAfter) + 1n
            this.#head = this.#next - 1n
        }
    }

    /** everything up to here has been handed out (or given up on), pass it back as startAfter */
    get cursor(): string | null {
        return this.#next === null ? null : toFullname(this.kind, this.#next - 1n)
    }

    protected rewindTo(id: bigint): void {
        if (this.#next !== null && this.#next > id) this.#next = id
    }

    protected async poll(): Promise<Poll<T>> {
        if (this.#next === null) {
            const newest = await this.#newestInListing()
            if (newest === null) return {items: [], waitMs: this.pollInterval}
            this.#next = newest + 1n
            this.#head = newest
            // r/all leaves some subs out, so there's usually something newer already
            return {items: [], waitMs: 0}
        }
        return this.#walk(this.#next)
    }

    async #walk(next: bigint): Promise<Poll<T>> {
        const now = Date.now()
        const rechecks = this.#caughtUp ? this.#dueGaps(now) : []
        const probing = this.#emptyRun > 0
        const hi = next + BigInt(BATCH - rechecks.length - (probing ? PROBE_PAIRS * 2 : 0)) - 1n
        const probes: Probes = probing ? this.#probes(hi) : {pairs: [], bounded: false}

        const ids = [...rechecks]
        for (let id = next; id <= hi; id++) ids.push(id)
        for (const pair of probes.pairs) ids.push(...pair)

        const things = await this.api.info<T>(ids.map((id) => toFullname(this.kind, id)), {signal: this.signal, priority: "low"})
        const found = new Map<bigint, T>()
        for (const thing of things) {
            if (thing?.kind === this.kind && typeof thing.data?.name === "string") found.set(parseId(thing.data.name), thing)
        }

        const items: T[] = []

        // late arrivals
        for (const id of rechecks) {
            const thing = found.get(id)
            if (thing) {
                items.push(thing)
                this.#gaps.delete(id)
            } else {
                this.#retryLater(id, now)
            }
        }

        // the batch
        let newest = -1n
        let newestCreated = 0
        for (let id = next; id <= hi; id++) {
            const thing = found.get(id)
            if (!thing) continue
            items.push(thing)
            newest = id
            newestCreated = Math.max(newestCreated, Number(thing.data.created_utc) || 0)
        }
        if (newest > this.#head) this.#head = newest

        // probes only tell us how far the ids go, the batches pick those items up when they get there
        let lowestHit: bigint | null = null
        let lastMiss: bigint | null = null
        for (const [a, b] of probes.pairs) {
            const hit = found.has(b) ? b : found.has(a) ? a : null
            if (hit === null) {
                if (lowestHit === null) lastMiss = b
                continue
            }
            if (lowestHit === null) lowestHit = found.has(a) ? a : b
            if (hit > this.#head) this.#head = hit
        }

        let cursor = next
        // short batch: everything past the newest id we know exists gets asked for again next time
        const short = this.#head < hi
        const tail = hi - (this.#head >= next ? this.#head : next - 1n)
        const atHead = short && (tail >= BigInt(HEAD_TAIL) || (newest >= next && newestCreated > now / 1000 - FRESH_S))
        const resolvedTo = short ? this.#head : hi
        if (resolvedTo >= next) {
            // missing below an id that exists: deleted, removed, spam... or late, if it's brand new
            const fresh = newest >= next && newestCreated > now / 1000 - LATE_WINDOW_S
            if (fresh && this.lateRetries > 0) {
                for (let id = next; id <= resolvedTo; id++) {
                    if (!found.has(id)) this.#addGap(id, now)
                }
            }
            cursor = resolvedTo + 1n
        }

        this.#emptyRun = newest >= next ? 0 : this.#emptyRun + 1
        this.#caughtUp = atHead

        // a run of empty batches with live ids past it: jump to just after the last probe that came back empty
        if (this.#emptyRun >= HOLE_BATCHES && lastMiss !== null && (lowestHit !== null || probes.bounded) && lastMiss >= cursor) {
            this.warn("skipped-ids", `nothing came back for ${HOLE_BATCHES} batches in a row after ${toFullname(this.kind, cursor - 1n)}, skipped ${lastMiss + 1n - cursor} ids (up to ${toFullname(this.kind, lastMiss)}) that look like a hole`)
            cursor = lastMiss + 1n
        }
        this.#next = cursor

        // quiet for a long time at the head: make sure we aren't stuck in front of a hole wider than the lookahead
        if (atHead && newest < next && lowestHit === null && this.#emptyRun % STALL_POLLS === 0) {
            const listed = await this.#newestInListing()
            if (listed !== null && listed > this.#head) this.#head = listed
        }

        if (!atHead && newestCreated > 0 && newestCreated < now / 1000 - BEHIND_WARN_S && now - this.#warnedBehindAt > WARN_EVERY_MS) {
            this.#warnedBehindAt = now
            const minutes = Math.round((now / 1000 - newestCreated) / 60)
            const what = this.kind === "t1" ? "comment" : "post"
            this.warn("behind", `the sitewide ${what} watcher is ${minutes} minutes behind reddit, requestsPerMinute (${this.api.requestsPerMinute}) isn't leaving it enough requests`)
        }

        items.sort((a, b) => {
            const diff = parseId(a.data.name) - parseId(b.data.name)
            return diff < 0n ? -1 : diff > 0n ? 1 : 0
        })
        // caught up: wait. still behind (or crossing a hole): go again, the rate limiter spaces it out
        return {items, waitMs: atHead ? this.pollInterval : 0}
    }

    // pairs of ids past the batch, a pair so one deleted item doesn't hide a whole stretch.
    // spread evenly up to the furthest id we know exists, or reaching further and further out when we don't know one
    #probes(hi: bigint): Probes {
        const pairs: [bigint, bigint][] = []
        const span = this.#head - hi

        if (span >= BigInt((PROBE_PAIRS + 1) * 2)) {
            const step = span / BigInt(PROBE_PAIRS + 1)
            for (let i = 1; i <= PROBE_PAIRS; i++) {
                const id = hi + step * BigInt(i)
                pairs.push([id, id + 1n])
            }
            return {pairs, bounded: true}
        }

        for (let i = 0; i < PROBE_PAIRS; i++) {
            const distance = BigInt(Math.round(BATCH * Math.pow(LOOKAHEAD / BATCH, i / (PROBE_PAIRS - 1))))
            pairs.push([hi + distance, hi + distance + 1n])
        }
        return {pairs, bounded: false}
    }

    #addGap(id: bigint, now: number): void {
        this.#gaps.set(id, {left: this.lateRetries, due: now + this.pollInterval, delay: this.pollInterval})
        if (this.#gaps.size > MAX_GAPS) this.#gaps.delete(this.#gaps.keys().next().value!)
    }

    #dueGaps(now: number): bigint[] {
        const due: bigint[] = []
        for (const [id, gap] of this.#gaps) {
            if (gap.due > now) continue
            due.push(id)
            if (due.length === MAX_RECHECKS) break
        }
        return due
    }

    #retryLater(id: bigint, now: number): void {
        const gap = this.#gaps.get(id)
        if (!gap) return
        gap.left--
        if (gap.left <= 0) {
            this.#gaps.delete(id)
            return
        }
        gap.delay *= 4
        gap.due = now + gap.delay
    }

    async #newestInListing(): Promise<bigint | null> {
        const body = await this.api.get(this.#seedPath, {limit: 1}, {signal: this.signal, priority: "low"})
        if (!isListing(body)) throw new SnooperError(`unexpected response from reddit for /${this.#seedPath} (not a listing)`)

        const first = body.data.children[0] as Thing<string, {name?: unknown}> | undefined
        return typeof first?.data?.name === "string" ? parseId(first.data.name) : null
    }
}
