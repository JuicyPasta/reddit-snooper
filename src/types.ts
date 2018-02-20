// reddit's json, typed. field names stay the way reddit sends them (snake_case)
// only the common fields are listed, everything else is still there as unknown

export type Fullname<Kind extends string = string> = `${Kind}_${string}`

export interface Thing<Kind extends string = string, Data = {[field: string]: unknown}> {
    kind: Kind
    data: Data
}

export interface PostData {
    id: string
    name: Fullname<"t3">
    author: string
    title: string
    selftext: string
    url: string
    permalink: string
    subreddit: string
    subreddit_id: Fullname<"t5">
    created_utc: number
    score: number
    num_comments: number
    over_18: boolean
    is_self: boolean
    stickied: boolean
    [field: string]: unknown
}

export interface CommentData {
    id: string
    name: Fullname<"t1">
    author: string
    body: string
    link_id: Fullname<"t3">
    parent_id: Fullname<"t1" | "t3">
    permalink: string
    subreddit: string
    subreddit_id: Fullname<"t5">
    created_utc: number
    score: number
    [field: string]: unknown
}

export type Post = Thing<"t3", PostData>
export type Comment = Thing<"t1", CommentData>

export interface Listing<T = Thing> {
    kind: "Listing"
    data: {
        after: string | null
        before: string | null
        dist?: number | null
        children: T[]
        [field: string]: unknown
    }
}

export function isListing(body: unknown): body is Listing<unknown> {
    if (typeof body !== "object" || body === null) return false
    const listing = body as {kind?: unknown, data?: {children?: unknown}}
    return listing.kind === "Listing" && Array.isArray(listing.data?.children)
}
