import {setTimeout as sleep} from "node:timers/promises"
import {ApiError, AuthError, RateLimitError, SnooperError, type RedditErrorTuple} from "./errors.ts"
import {backoffMs, httpRequest, Limiter, retryAfterMs, type HttpResponse, type Method, type Params, type Priority} from "./http.ts"
import {isListing, type Comment, type Listing, type Post, type Thing} from "./types.ts"
import {VERSION} from "./version.ts"

export const DEFAULT_USER_AGENT = `node:reddit-snooper:v${VERSION} (by /u/juicypasta)`

const RETRIES = 3
const TOKEN_RETRIES = 5

/** app only oauth: enough for watchers and reading anything public */
export interface AppAuth {
    appId: string
    appSecret: string
    username?: undefined
    password?: undefined
}

/** a 'script' app logged in as your bot account: needed to post, vote, read /api/v1/me... */
export interface ScriptAuth {
    appId: string
    appSecret: string
    username: string
    password: string
}

export type Auth = AppAuth | ScriptAuth

export interface Endpoints {
    token: string  // where tokens come from
    oauth: string  // anything with a bearer token goes here
    public: string // logged out .json pages
}

export interface SnooperOptions {
    /** leave it out to go logged out (reddit blocks most of that now, see the README) */
    auth?: Auth
    /** reddit wants something like "node:my-bot:v1.0.0 (by /u/your_username)" */
    userAgent?: string
    /** oauth requests a minute, reddit allows 100. default 90 */
    requestsPerMinute?: number
    /** logged out requests a minute, reddit allows 10. default 10 */
    publicRequestsPerMinute?: number
    /** wait out "you are doing that too much" on posts and comments instead of throwing a RateLimitError */
    retryRateLimitedActions?: boolean
    /** point snooper somewhere else (a proxy, or a fake reddit in tests) */
    endpoints?: Partial<Endpoints>
}

export interface CallOptions {
    /** abort to give up on the call */
    signal?: AbortSignal
    /** "low" waits behind everything "normal" (your calls). watchers use "low" */
    priority?: Priority
}

export interface RequestOptions extends CallOptions {
    query?: Params
    form?: Params
    json?: unknown
}

export interface ApiResponse<T> {
    status: number
    headers: Record<string, string>
    body: T
}

interface TokenBody {
    access_token?: string
    token_type?: string
    expires_in?: number
    error?: string
    message?: string
}

function positive(name: string, value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback
    if (typeof value !== "number" || !(value > 0)) throw new TypeError(`${name} has to be a number above 0, got ${value}`)
    return value
}

function checkAuth(auth: Auth | undefined): Auth | undefined {
    if (auth === undefined) return undefined
    if (!auth.appId || !auth.appSecret) {
        throw new TypeError("auth needs an appId and an appSecret (from https://www.reddit.com/prefs/apps)")
    }
    if ((auth.username === undefined) !== (auth.password === undefined)) {
        throw new TypeError("auth needs both a username and a password, or neither")
    }
    return auth
}

// turns a reddit response we didn't want into something readable
function describe(method: string, path: string, res: HttpResponse): string {
    const body = res.body
    const reason = (typeof body === "object" && body !== null && "reason" in body && body.reason) ? ` (${String(body.reason)})` : ""
    const where = "/" + path.replace(/^\/+/, "")

    if (res.status === 403 && typeof body === "string") {
        return `reddit blocked the request to ${where} (403). reddit wants oauth for almost everything now, pass auth: {appId, appSecret}`
    } else if (res.status === 403) {
        return `${where} is private or forbidden${reason}`
    } else if (res.status === 404 || (res.status >= 300 && res.status < 400)) {
        // logged out, reddit redirects subreddits that dont exist to the search page
        return `${where} doesn't exist${reason}`
    } else if (res.status === 429) {
        return `reddit is rate limiting us (429) on ${method} ${where}`
    } else if (res.status === 401) {
        return `reddit rejected our token for ${where} (401), check appId and appSecret`
    }
    return `unexpected response from reddit for ${method} ${where} (${res.status})`
}

export class RedditApi {
    readonly userAgent: string
    readonly requestsPerMinute: number
    readonly #auth: Auth | undefined
    readonly #endpoints: Endpoints
    readonly #limiter: Limiter
    readonly #publicLimiter: Limiter
    readonly #retryRateLimitedActions: boolean
    #token: string | null = null
    #tokenExpires = 0
    #tokenRequest: Promise<string> | null = null

    constructor(options: SnooperOptions = {}) {
        this.#auth = checkAuth(options.auth)
        this.userAgent = options.userAgent || DEFAULT_USER_AGENT
        this.#endpoints = {
            token:  "https://www.reddit.com/api/v1/access_token",
            oauth:  "https://oauth.reddit.com/",
            public: "https://www.reddit.com/",
            ...options.endpoints
        }

        // reddit gives oauth clients 100 requests / minute (averaged over 10 minutes), 90 leaves a little room
        this.requestsPerMinute = positive("requestsPerMinute", options.requestsPerMinute, 90)
        this.#limiter = new Limiter(this.requestsPerMinute)
        // logged out traffic gets 10 requests / minute (when reddit lets it through at all)
        this.#publicLimiter = new Limiter(positive("publicRequestsPerMinute", options.publicRequestsPerMinute, 10))
        this.#retryRateLimitedActions = options.retryRateLimitedActions ?? false
    }

    get hasAuth(): boolean {
        return this.#auth !== undefined
    }

    /** bearer token for oauth.reddit.com. tokens are good for an hour, we grab a new one after 30 mins */
    async token(): Promise<string> {
        if (this.#token && Date.now() < this.#tokenExpires) return this.#token
        if (!this.#auth) {
            throw new AuthError("reddit api credentials (auth: {appId, appSecret}) are needed for this, see the README")
        }

        // only ask reddit once even if a bunch of calls need a token at the same time
        this.#tokenRequest ??= this.#fetchToken(this.#auth).finally(() => this.#tokenRequest = null)
        return this.#tokenRequest
    }

    async #fetchToken(auth: Auth): Promise<string> {
        // script apps can log in as the bot account, otherwise use app only oauth (read only stuff)
        const form: Params = auth.username !== undefined
            ? {grant_type: "password", username: auth.username, password: auth.password}
            : {grant_type: "client_credentials"}

        for (let attempt = 0; ; attempt++) {
            let res: HttpResponse
            try {
                res = await httpRequest({
                    url:     this.#endpoints.token,
                    method:  "POST",
                    form:    form,
                    headers: {
                        "Authorization": "Basic " + Buffer.from(auth.appId + ":" + auth.appSecret).toString("base64"),
                        "User-Agent":    this.userAgent
                    }
                })
            } catch (err) {
                if (attempt < TOKEN_RETRIES) {
                    await sleep(backoffMs(attempt))
                    continue
                }
                throw new SnooperError(`couldn't reach reddit for an oauth token: ${(err as Error).message}`, {cause: err})
            }

            if ((res.status === 429 || res.status >= 500) && attempt < TOKEN_RETRIES) {
                await sleep(retryAfterMs(res.headers, attempt))
                continue
            }
            if (res.status >= 500) {
                throw new ApiError(`reddit's token endpoint is having a bad time (${res.status})`, {status: res.status, method: "POST", path: "api/v1/access_token", body: res.body})
            }

            const body = (typeof res.body === "object" && res.body !== null ? res.body : {}) as TokenBody
            // reddit sends a 200 with {"error": "invalid_grant"} when the password is wrong
            if (res.status !== 200 || !body.access_token) {
                const reason = body.error ?? body.message ?? "no access_token in response"
                throw new AuthError(`could not get an oauth token from reddit (${res.status}): ${reason}`)
            }

            this.#tokenExpires = Date.now() + (body.expires_in ?? 3600) * 1000 / 2
            this.#token = `${body.token_type ?? "bearer"} ${body.access_token}`
            return this.#token
        }
    }

    /** where a call to `path` goes: oauth.reddit.com with auth, the public .json pages for logged out GETs */
    url(path: string, method: Method = "GET"): string {
        const relative = path.replace(/^\/+/, "")
        if (!this.hasAuth && method === "GET") {
            const url = new URL(relative, this.#endpoints.public)
            if (!url.pathname.endsWith(".json")) {
                url.pathname = url.pathname.replace(/\/+$/, "") + ".json"
            }
            return url.toString()
        }
        return new URL(relative, this.#endpoints.oauth).toString()
    }

    /** the whole response. throws an ApiError for anything that isn't a 2xx, and for 200s where reddit's json.errors says no */
    async request<T = unknown>(method: Method, path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
        const url = this.url(path, method)
        const authed = this.hasAuth || method !== "GET"
        const limiter = authed ? this.#limiter : this.#publicLimiter
        // raw_json: dont html escape <, > and & in what comes back
        const query = method === "GET" ? {raw_json: 1, ...options.query} : options.query
        const form = method === "POST" ? (options.form ?? {}) : undefined
        const json = method === "PATCH" || method === "PUT" || method === "DELETE" ? (options.json ?? undefined) : undefined

        for (let attempt = 0; ; attempt++) {
            // token first (it doesn't count against the oauth limit), so the request goes out the moment its slot comes up
            const token = authed ? await this.token() : undefined
            await limiter.take(options.priority, options.signal)

            let res: HttpResponse
            try {
                res = await httpRequest({
                    url, method, query, form, json,
                    headers: token ? {"User-Agent": this.userAgent, "Authorization": token} : {"User-Agent": this.userAgent},
                    signal:  options.signal
                })
            } catch (err) {
                if (options.signal?.aborted) throw options.signal.reason
                // back off the whole queue (reddit is struggling) then go again
                if (attempt < RETRIES) {
                    limiter.backoff(backoffMs(attempt))
                    continue
                }
                throw new SnooperError(`${method} /${path.replace(/^\/+/, "")} failed: ${(err as Error).message}`, {cause: err})
            }

            limiter.update(res.headers)
            const details = {status: res.status, method, path, body: res.body}

            // token got revoked or expired early, grab a new one and try again
            if (res.status === 401 && token && attempt < RETRIES) {
                this.#token = null
                continue
            }

            // too many requests, wait however long reddit says and try again
            if (res.status === 429) {
                const wait = retryAfterMs(res.headers, attempt)
                limiter.backoff(wait)
                if (attempt < RETRIES) continue
                throw new RateLimitError(describe(method, path, res), {...details, retryAfterMs: wait})
            }

            if (res.status >= 500 && attempt < RETRIES) {
                limiter.backoff(backoffMs(attempt))
                continue
            }

            if (res.status < 200 || res.status >= 300) {
                throw new ApiError(describe(method, path, res), details)
            }

            // well is it a success...
            const reply = (res.body as {json?: {ratelimit?: number, errors?: RedditErrorTuple[]}} | null)?.json
            if (reply?.ratelimit) {
                const wait = reply.ratelimit * 1000
                if (this.#retryRateLimitedActions) {
                    // this one is per action (commenting etc) so only this request waits, and it doesn't use up a retry
                    await sleep(wait, undefined, {signal: options.signal})
                    attempt--
                    continue
                }
                throw new RateLimitError(`you are doing this too much, try again in: ${reply.ratelimit} seconds`, {...details, retryAfterMs: wait, errors: reply.errors})
            }
            if (Array.isArray(reply?.errors) && reply.errors.length > 0) {
                const said = reply.errors.map(([code, message]) => `${code}: ${message}`).join(", ")
                throw new ApiError(`reddit said ${said}`, {...details, errors: reply.errors})
            }

            return {status: res.status, headers: res.headers, body: res.body as T}
        }
    }

    async get<T = unknown>(path: string, query?: Params, options?: CallOptions): Promise<T> {
        return (await this.request<T>("GET", path, {...options, query})).body
    }

    async post<T = unknown>(path: string, form?: Params, options?: CallOptions): Promise<T> {
        return (await this.request<T>("POST", path, {...options, form})).body
    }

    async patch<T = unknown>(path: string, json?: unknown, options?: CallOptions): Promise<T> {
        return (await this.request<T>("PATCH", path, {...options, json})).body
    }

    async put<T = unknown>(path: string, json?: unknown, options?: CallOptions): Promise<T> {
        return (await this.request<T>("PUT", path, {...options, json})).body
    }

    async delete<T = unknown>(path: string, json?: unknown, options?: CallOptions): Promise<T> {
        return (await this.request<T>("DELETE", path, {...options, json})).body
    }

    /**
     * posts, comments or subreddits by fullname (t3_..., t1_..., t5_...), up to 100 at a time.
     * anything deleted, removed or private just isn't in the result
     */
    async info<T extends Thing = Post | Comment>(fullnames: readonly string[], options?: CallOptions): Promise<T[]> {
        if (fullnames.length === 0) return []
        if (fullnames.length > 100) throw new RangeError(`reddit takes at most 100 fullnames per /api/info call, got ${fullnames.length}`)

        const body = await this.get<Listing<T>>("api/info", {id: fullnames.join(",")}, options)
        if (!isListing(body)) throw new SnooperError("unexpected response from reddit for GET /api/info (not a listing)")
        return body.data.children
    }
}
