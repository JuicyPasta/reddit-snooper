// tiny wrapper around node's built in fetch, plus the rate limiter every request goes through

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
export type Params = Record<string, string | number | boolean | null | undefined>

export interface HttpRequest {
    url: string
    method: Method
    headers: Record<string, string>
    query?: Params
    form?: Params
    json?: unknown
    timeoutMs?: number
    signal?: AbortSignal
}

export interface HttpResponse {
    status: number
    headers: Record<string, string>
    body: unknown // parsed json when reddit sends json, otherwise the raw text
}

function entries(params: Params): [string, string][] {
    return Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => [key, String(value)])
}

export async function httpRequest(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url)
    const headers = {...req.headers}
    let body: string | undefined

    for (const [key, value] of entries(req.query ?? {})) url.searchParams.set(key, value)

    if (req.form) {
        body = new URLSearchParams(entries(req.form)).toString()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    } else if (req.json !== undefined) {
        body = JSON.stringify(req.json)
        headers["Content-Type"] = "application/json"
    }

    const timeout = AbortSignal.timeout(req.timeoutMs ?? 30_000)
    const res = await fetch(url, {
        method:   req.method,
        headers:  headers,
        body:     body,
        redirect: "manual", // reddit redirects missing subreddits to search, we want to see that
        signal:   req.signal ? AbortSignal.any([req.signal, timeout]) : timeout
    })

    const text = await res.text()
    const resHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => resHeaders[key] = value)

    let parsed: unknown = text
    if (/json/.test(resHeaders["content-type"] ?? "") || /^\s*[{[]/.test(text)) {
        try {
            parsed = JSON.parse(text)
        } catch {
            // leave it as text
        }
    }

    return {status: res.status, headers: resHeaders, body: parsed}
}

// your own api calls are "normal", watchers are "low" so a busy watcher can't starve your bot's replies
export type Priority = "normal" | "low"

interface Waiter {
    resolve: () => void
    signal?: AbortSignal
    onAbort?: () => void
}

// spaces requests out so we stay under reddit's limits, everything goes through one queue
// so a bunch of retries firing at once cant blow through the limit
export class Limiter {
    readonly msBetweenRequests: number
    #nextSlot = 0
    #blockedUntil = 0
    #queues: Record<Priority, Waiter[]> = {normal: [], low: []}
    #timer: ReturnType<typeof setTimeout> | undefined

    constructor(requestsPerMinute: number) {
        this.msBetweenRequests = 60_000 / requestsPerMinute
    }

    // resolves when it's this request's turn
    take(priority: Priority = "normal", signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(signal.reason)

            const waiter: Waiter = {resolve}
            const queue = this.#queues[priority]
            if (signal) {
                waiter.signal = signal
                waiter.onAbort = () => {
                    queue.splice(queue.indexOf(waiter), 1)
                    reject(signal.reason)
                    // nothing left to wait for, dont hold the process open with a timer
                    if (this.#queues.normal.length === 0 && this.#queues.low.length === 0) {
                        clearTimeout(this.#timer)
                        this.#timer = undefined
                    }
                }
                signal.addEventListener("abort", waiter.onAbort, {once: true})
            }

            queue.push(waiter)
            this.#drain()
        })
    }

    // wait at least ms before sending anything else
    backoff(ms: number): void {
        this.#blockedUntil = Math.max(this.#blockedUntil, Date.now() + ms)
    }

    // reddit tells us how many requests are left in the current window
    // x-ratelimit-used: used during period
    // x-ratelimit-remaining: remaining requests in period
    // x-ratelimit-reset: seconds until end of period
    update(headers: Record<string, string>): void {
        const remaining = parseFloat(headers["x-ratelimit-remaining"] ?? "")
        const reset = parseFloat(headers["x-ratelimit-reset"] ?? "")
        if (!isNaN(remaining) && !isNaN(reset) && remaining < 1) {
            this.backoff(reset * 1000)
        }
    }

    #drain(): void {
        if (this.#timer) return

        const queue = this.#queues.normal.length > 0 ? this.#queues.normal : this.#queues.low
        if (queue.length === 0) return

        const wait = Math.max(this.#nextSlot, this.#blockedUntil) - Date.now()
        if (wait > 0) {
            this.#timer = setTimeout(() => {
                this.#timer = undefined
                this.#drain()
            }, wait)
            return
        }

        const waiter = queue.shift()!
        if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort)
        this.#nextSlot = Date.now() + this.msBetweenRequests
        waiter.resolve()
        this.#drain()
    }
}

// how long to wait after a 429, reddit sends retry-after and/or x-ratelimit-reset (both in seconds)
export function retryAfterMs(headers: Record<string, string>, attempt: number): number {
    const retryAfter = parseFloat(headers["retry-after"] ?? "")
    if (retryAfter > 0) return retryAfter * 1000

    const reset = parseFloat(headers["x-ratelimit-reset"] ?? "")
    if (reset > 0) return reset * 1000

    return backoffMs(attempt)
}

// 1s, 2s, 4s, 8s... capped at a minute
export function backoffMs(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 60 * 1000)
}
