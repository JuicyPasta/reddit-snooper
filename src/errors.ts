// everything snooper throws is a SnooperError, so one instanceof check catches all of it

export class SnooperError extends Error {
    override name = "SnooperError"
}

// no credentials, or reddit turned them down. retrying won't help
export class AuthError extends SnooperError {
    override name = "AuthError"
}

// reddit's json.errors, ex: ["THREAD_LOCKED", "that thread is locked", "parent"]
export type RedditErrorTuple = [code: string, message: string, field?: string]

export interface ApiErrorDetails {
    status: number
    method: string
    path: string
    body?: unknown
    errors?: RedditErrorTuple[]
}

// reddit answered, but not with what we asked for
export class ApiError extends SnooperError {
    override name = "ApiError"
    readonly status: number
    readonly method: string
    readonly path: string
    readonly body: unknown
    readonly errors: RedditErrorTuple[]

    constructor(message: string, details: ApiErrorDetails, options?: ErrorOptions) {
        super(message, options)
        this.status = details.status
        this.method = details.method
        this.path = details.path
        this.body = details.body
        this.errors = details.errors ?? []
    }
}

// a 429 we ran out of retries on, or "you are doing that too much" on a post/comment
export class RateLimitError extends ApiError {
    override name = "RateLimitError"
    readonly retryAfterMs: number

    constructor(message: string, details: ApiErrorDetails & {retryAfterMs: number}, options?: ErrorOptions) {
        super(message, details, options)
        this.retryAfterMs = details.retryAfterMs
    }
}

// worth trying again later: network trouble, reddit having a bad time, rate limits.
// auth problems and 4xx (missing or private subreddit...) won't fix themselves
export function isTransient(err: unknown): boolean {
    if (err instanceof RateLimitError) return true
    if (err instanceof ApiError) return err.status >= 500
    return !(err instanceof AuthError)
}
