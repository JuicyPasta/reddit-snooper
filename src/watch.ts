import type {RedditApi} from "./api.ts"
import type {Comment, Post} from "./types.ts"
import {IdWalker} from "./walker.ts"
import {FeedWatcher, ListingWatcher, type ListingOptions, type StreamOptions, type StreamWatcher, type Watcher} from "./watcher.ts"

// 'pics', '/r/pics', 'r/pics' all work, blank means all of reddit, 'pics+gifs' watches both
export function cleanSubreddit(subreddit = ""): string {
    return subreddit.trim().replace(/^\/?r\//i, "").replace(/\//g, "") || "all"
}

function isSitewide(subreddit: string): boolean {
    return subreddit.toLowerCase() === "all"
}

// snooper.watch.*
//
// sitewide ('all' or blank) walks the id space through /api/info, see walker.ts.
// a single subreddit polls its own /new or /comments listing instead: walking every id on reddit
// to keep the few from one sub would cost the same ~12 (posts) or ~70 (comments) requests a minute
// as watching everything, where the listing is one request per poll for all but the busiest subs
export class Watch {
    readonly #api: RedditApi

    constructor(api: RedditApi) {
        this.#api = api
    }

    /** new posts, oldest first. 'all' or blank walks every post id on reddit, a subreddit polls its /new */
    posts(subreddit = "all", options: StreamOptions = {}): StreamWatcher<Post> {
        const sub = cleanSubreddit(subreddit)
        return isSitewide(sub)
            ? new IdWalker<Post>(this.#api, "t3", options)
            : new FeedWatcher<Post>(this.#api, `r/${sub}/new`, "t3", options)
    }

    /** new comments, oldest first. 'all' or blank walks every comment id on reddit, a subreddit polls its /comments */
    comments(subreddit = "all", options: StreamOptions = {}): StreamWatcher<Comment> {
        const sub = cleanSubreddit(subreddit)
        return isSitewide(sub)
            ? new IdWalker<Comment>(this.#api, "t1", options)
            : new FeedWatcher<Comment>(this.#api, `r/${sub}/comments`, "t1", options)
    }

    /** new posts on a user's multireddit */
    multi(username: string, multi: string, options: StreamOptions = {}): StreamWatcher<Post> {
        const user = username.trim().replace(/^\/?u(ser)?\//i, "").replace(/\//g, "")
        const name = multi.trim().replace(/\//g, "")
        if (!user || !name) throw new TypeError("multi needs a username and the multi's name")
        return new FeedWatcher<Post>(this.#api, `user/${user}/m/${name}/new`, "t3", options)
    }

    /**
     * posts that make it into the first `limit` spots of hot, rising, controversial or top.
     * blank subreddit is the front page, 'all' is r/all
     */
    listing(subreddit = "", options: ListingOptions = {}): Watcher<Post> {
        return new ListingWatcher(this.#api, subreddit.trim() ? cleanSubreddit(subreddit) : "", options)
    }
}
