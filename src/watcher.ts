import {EventEmitter} from "node:events"
import {setTimeout as sleep} from "node:timers/promises"
import type {RedditApi} from "./api.ts"
import {isTransient, SnooperError} from "./errors.ts"
import {parseId, toFullname} from "./ids.ts"
import {isListing, type Comment, type Post, type Thing} from "./types.ts"

export interface WatchOptions {
    /** abort it to stop the watcher, same as watcher.close() */
    signal?: AbortSignal
    /** ms to wait between polls once the watcher is caught up */
    pollInterval?: number
}

export interface StreamOptions extends WatchOptions {
    /** id or fullname to pick up after (a saved watcher.cursor), instead of starting at whatever is newest */
    startAfter?: string
}

export interface SnooperWarning {
    /** missed-items: a listing moved faster than we could page back (reddit only keeps ~1000) */
    code: "missed-items"
    message: string
}

export interface WatcherEvents<T> {
    item: [item: T]
    error: [error: Error]
    warning: [warning: SnooperWarning]
    close: []
}

export interface Poll<T> {
    items: T[]
    waitMs: number // how long until the next poll, 0 when there's more waiting
}

const EVENTS = new Set(["item", "error", "warning", "close", "newListener", "removeListener"])

// what one for await loop has been handed but hasn't gotten to yet
class Inbox<T> {
    readonly #items: T[] = []
    readonly #onEmpty: () => void
    // method style so a Watcher<Post> still counts as a Watcher<unknown>
    #waiter: {resolve(result: IteratorResult<T>): void, reject(err: unknown): void} | null = null
    #done = false
    #error: {err: unknown} | null = null

    constructor(onEmpty: () => void) {
        this.#onEmpty = onEmpty
    }

    get size(): number {
        return this.#items.length
    }

    // takes back whatever the loop hasn't gotten to yet
    drain(): T[] {
        return this.#items.splice(0)
    }

    push(item: T): void {
        if (this.#waiter) {
            this.#waiter.resolve({value: item, done: false})
            this.#waiter = null
        } else {
            this.#items.push(item)
        }
    }

    end(err?: {err: unknown}): void {
        if (this.#done) return
        this.#done = true
        this.#error = err ?? null
        if (this.#waiter && this.#items.length === 0) {
            const waiter = this.#waiter
            this.#waiter = null
            if (err) {
                this.#error = null
                waiter.reject(err.err)
            } else {
                waiter.resolve({value: undefined, done: true})
            }
        }
    }

    next(): Promise<IteratorResult<T>> {
        if (this.#items.length > 0) {
            const value = this.#items.shift()!
            if (this.#items.length === 0) this.#onEmpty()
            return Promise.resolve({value, done: false})
        }
        if (this.#error) {
            const {err} = this.#error
            this.#error = null
            return Promise.reject(err)
        }
        if (this.#done) return Promise.resolve({value: undefined, done: true})
        return new Promise((resolve, reject) => this.#waiter = {resolve, reject})
    }
}

/**
 * an event emitter ('item', 'error', 'warning', 'close') and an async iterable, use either.
 * it starts on the first 'item' listener or for await loop, and stops on close(), its signal, or an error
 * retrying can't fix (missing subreddit, bad credentials). errors retrying can fix are emitted and retried
 */
export abstract class Watcher<T> extends EventEmitter<WatcherEvents<T>> implements AsyncIterable<T> {
    protected readonly api: RedditApi
    readonly pollInterval: number
    readonly #controller = new AbortController()
    readonly #inboxes = new Set<Inbox<T>>()
    #state: "idle" | "running" | "closed" = "idle"
    #failures = 0
    #roomWaiter: (() => void) | null = null

    constructor(api: RedditApi, options: WatchOptions, defaultPollInterval: number) {
        super()
        this.api = api
        this.pollInterval = options.pollInterval ?? defaultPollInterval
        if (!(this.pollInterval >= 0)) throw new TypeError(`pollInterval has to be 0 or more ms, got ${options.pollInterval}`)

        if (options.signal?.aborted) {
            this.#state = "closed"
            this.#controller.abort()
        } else {
            // the {signal} drops this listener once we close, so long lived signals dont pile them up
            options.signal?.addEventListener("abort", () => this.close(), {once: true, signal: this.#controller.signal})
        }

        // newListener isn't in WatcherEvents on purpose (it'd show up in everyone's autocomplete)
        ;(this as EventEmitter).on("newListener", (event: string | symbol) => {
            if (!EVENTS.has(String(event))) {
                throw new TypeError(`event type not recognized: ${String(event)}, use one of: item, error, warning, close`)
            }
            if (event === "item") this.#start()
        })
    }

    get closed(): boolean {
        return this.#state === "closed"
    }

    // aborts with the watcher, pass it to anything the watcher waits on
    protected get signal(): AbortSignal {
        return this.#controller.signal
    }

    protected abstract poll(): Promise<Poll<T>>

    close(): void {
        this.#shutdown()
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        const inbox = new Inbox<T>(() => this.#checkRoom())
        if (this.closed) {
            inbox.end()
        } else {
            this.#inboxes.add(inbox)
            this.#start()
        }

        return {
            next: () => inbox.next(),
            // break out of the for await loop (or throw in it) and the watcher stops, unless something else is listening
            return: async () => {
                const left = inbox.drain()
                inbox.end()
                this.#inboxes.delete(inbox)
                this.#checkRoom()
                if (this.#inboxes.size === 0 && this.listenerCount("item") === 0) {
                    this.close()
                    this.rewind(left)
                }
                return {value: undefined, done: true}
            }
        }
    }

    // these never got handed out (the watcher stopped first), so the cursor shouldn't count them
    protected rewind(_items: T[]): void {}

    protected warn(code: SnooperWarning["code"], message: string): void {
        this.emit("warning", {code, message})
    }

    #start(): void {
        if (this.#state !== "idle") return
        this.#state = "running"
        // wait until the rest of the .on() chain (like .on('error')) is attached
        process.nextTick(() => {
            this.#run().catch((err) => {
                // a listener threw, let it crash like any other event emitter would
                process.nextTick(() => {
                    throw err
                })
            })
        })
    }

    async #run(): Promise<void> {
        while (!this.closed) {
            // a for await loop that hasn't caught up gets to finish first
            await this.#waitForRoom()
            if (this.closed) return

            let wait: number
            try {
                const {items, waitMs} = await this.poll()
                if (this.closed) return this.rewind(items)
                this.#failures = 0
                for (let i = 0; i < items.length; i++) {
                    this.emit("item", items[i]!)
                    for (const inbox of this.#inboxes) inbox.push(items[i]!)
                    // someone might have closed us from inside a listener
                    if (this.closed) return this.rewind(items.slice(i + 1))
                }
                wait = waitMs
            } catch (err) {
                if (this.closed) return
                const error = err instanceof Error ? err : new SnooperError(String(err))
                if (!isTransient(error)) return this.#shutdown(error)

                this.#failures++
                if (this.listenerCount("error") > 0) this.emit("error", error)
                // back off when things are going wrong: 5s, 10s, 20s... up to 5 mins
                wait = Math.min(5000 * Math.pow(2, this.#failures - 1), 5 * 60 * 1000)
            }

            if (wait > 0) {
                try {
                    await sleep(wait, undefined, {signal: this.signal})
                } catch {
                    return // closed while we were waiting
                }
            }
        }
    }

    #shutdown(error?: Error): void {
        if (this.#state === "closed") return
        this.#state = "closed"
        this.#controller.abort()

        // closing drops what a for await loop hasn't gotten to yet, an error lets it finish those first
        const inboxes = [...this.#inboxes]
        this.#inboxes.clear()
        const left: T[] = []
        for (const inbox of inboxes) {
            if (!error) left.push(...inbox.drain())
            inbox.end(error && {err: error})
        }
        this.#checkRoom()
        if (left.length > 0) this.rewind(left)

        try {
            // nobody iterating means nobody else hears about it, so emit even without an 'error' listener
            if (error && (this.listenerCount("error") > 0 || inboxes.length === 0)) this.emit("error", error)
        } finally {
            this.emit("close")
        }
    }

    #waitForRoom(): Promise<void> {
        if (this.#hasRoom()) return Promise.resolve()
        return new Promise((resolve) => this.#roomWaiter = resolve)
    }

    #hasRoom(): boolean {
        for (const inbox of this.#inboxes) if (inbox.size > 0) return false
        return true
    }

    #checkRoom(): void {
        if (this.#roomWaiter && (this.closed || this.#hasRoom())) {
            const resolve = this.#roomWaiter
            this.#roomWaiter = null
            resolve()
        }
    }
}

/** posts or comments in the order they were made. cursor is how far it got, hand it back as startAfter later */
export abstract class StreamWatcher<T extends Post | Comment> extends Watcher<T> {
    abstract readonly kind: T["kind"]
    abstract get cursor(): string | null

    // move the cursor back to just before `id`, if it's past it
    protected abstract rewindTo(id: bigint): void

    protected override rewind(items: T[]): void {
        if (items.length === 0) return
        this.rewindTo(items.map(idOf).reduce((low, id) => id < low ? id : low))
    }
}

// reddit only keeps about 1000 items in a listing, 10 pages of 100
const MAX_PAGES = 10
const PAGE_SIZE = 100

interface Page<T> {
    children: T[]
    after: string | null
}

async function getPage<T extends Thing>(api: RedditApi, signal: AbortSignal, path: string, query: Record<string, string | number>): Promise<Page<T>> {
    const body = await api.get(path, query, {signal, priority: "low"})
    if (!isListing(body)) throw new SnooperError(`unexpected response from reddit for /${path} (not a listing)`)
    return {children: body.data.children as T[], after: body.data.after}
}

// reddit ids count up, so we can tell whats newer even if the item we stopped at got deleted
function idOf(thing: Thing<string, {name: string}>): bigint {
    return parseId(thing.data.name)
}

// a subreddit's (or multi's) /new or /comments page, polled
export class FeedWatcher<T extends Post | Comment> extends StreamWatcher<T> {
    readonly kind: T["kind"]
    readonly path: string // like r/pics/new
    #newest: string | null = null
    #primed = false

    constructor(api: RedditApi, path: string, kind: T["kind"], options: StreamOptions = {}) {
        super(api, options, 5_000)
        this.path = path
        this.kind = kind
        if (options.startAfter !== undefined) {
            this.#newest = toFullname(kind, parseId(options.startAfter))
            this.#primed = true
        }
    }

    get cursor(): string | null {
        return this.#newest
    }

    protected rewindTo(id: bigint): void {
        if (this.#newest === null || parseId(this.#newest) >= id) this.#newest = toFullname(this.kind, id - 1n)
    }

    protected async poll(): Promise<Poll<T>> {
        // first time around just remember where the feed is, this makes it so feeds dont receive current data
        if (!this.#primed) {
            const page = await this.#page(null, 1)
            this.#primed = true
            this.#newest = page.children[0]?.data.name ?? null
            return {items: [], waitMs: this.pollInterval}
        }

        // feed was empty last time, everything on the first page is new
        const items = this.#newest === null
            ? (await this.#page(null, PAGE_SIZE)).children
            : await this.#itemsUntil(parseId(this.#newest))

        for (const item of items) {
            if (this.#newest === null || idOf(item) > parseId(this.#newest)) this.#newest = item.data.name
        }

        // listings are newest first, hand them out oldest first like the sitewide walker does
        return {items: items.reverse(), waitMs: this.pollInterval}
    }

    #page(after: string | null, limit: number): Promise<Page<T>> {
        const query: Record<string, string | number> = {limit}
        if (after) query.after = after
        return getPage(this.api, this.signal, this.path, query)
    }

    // everything newer than untilId, newest first
    async #itemsUntil(untilId: bigint): Promise<T[]> {
        const items: T[] = []
        let after: string | null = null

        for (let pages = 0; pages < MAX_PAGES; pages++) {
            const page = await this.#page(after, PAGE_SIZE)
            for (const child of page.children) {
                // stop at the last thing we saw, or anything older than it if it got removed
                if (idOf(child) <= untilId) return items
                items.push(child)
            }
            if (!page.after || page.children.length === 0) break
            after = page.after
        }

        this.warn("missed-items", `fell behind on /${this.path} (reddit only keeps ~1000 items), some items were probably missed`)
        return items
    }
}

export type ListingSort = "hot" | "rising" | "controversial" | "top"
export type TimeRange = "hour" | "day" | "week" | "month" | "year" | "all"

export type ListingOptions = WatchOptions & {
    /** how many spots to watch, if any of these get taken by a new post you hear about it. default 25 (a page) */
    limit?: number
} & (
    | {sort?: "hot" | "rising", time?: never}
    | {sort: "top" | "controversial", time?: TimeRange}
)

const SORTS = new Set<string>(["hot", "rising", "controversial", "top"])
const TIMES = new Set<string>(["hour", "day", "week", "month", "year", "all"])

// listings are reddit pages where posts can pop in and out in no particular order or location
// as opposed to feeds which sequentially display new content
export class ListingWatcher extends Watcher<Post> {
    readonly path: string
    readonly limit: number
    readonly #query: Record<string, string>
    readonly #seen = new Set<string>()

    constructor(api: RedditApi, subreddit: string, options: ListingOptions = {}) {
        super(api, options, 30_000)

        const sort = options.sort ?? "hot"
        if (!SORTS.has(sort)) throw new TypeError(`invalid listing sort: ${sort}, use hot, rising, controversial or top`)
        if (options.time !== undefined && (!TIMES.has(options.time) || (sort !== "top" && sort !== "controversial"))) {
            throw new TypeError(`invalid time: ${options.time}, top and controversial take hour, day, week, month, year or all`)
        }
        this.limit = options.limit ?? 25
        if (!Number.isInteger(this.limit) || this.limit < 1 || this.limit > 1000) {
            throw new TypeError(`limit has to be a whole number from 1 to 1000, got ${options.limit}`)
        }

        // blank subreddit is the front page
        this.path = (subreddit ? `r/${subreddit}/` : "") + sort
        this.#query = options.time ? {t: options.time} : {}
    }

    protected async poll(): Promise<Poll<Post>> {
        const fresh: Post[] = []
        for (const item of await this.#items()) {
            if (this.#seen.has(item.data.name)) continue
            fresh.push(item)
            this.#seen.add(item.data.name)
            if (this.#seen.size > this.limit * 5) this.#seen.delete(this.#seen.values().next().value!)
        }
        return {items: fresh, waitMs: this.pollInterval}
    }

    // first `limit` items of the listing (or less if reddit doesnt have that many)
    async #items(): Promise<Post[]> {
        let items: Post[] = []
        let after: string | null = null

        while (items.length < this.limit) {
            const query: Record<string, string | number> = {...this.#query, limit: Math.min(PAGE_SIZE, this.limit - items.length)}
            if (after) query.after = after
            const page: Page<Post> = await getPage(this.api, this.signal, this.path, query)
            items = items.concat(page.children)
            if (!page.after || page.children.length === 0) break
            after = page.after
        }
        return items.slice(0, this.limit)
    }
}
