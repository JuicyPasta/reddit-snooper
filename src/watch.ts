import type {RedditApi} from "./api.ts"
import type {Comment, Post} from "./types.ts"
import {FeedWatcher, ListingWatcher, type ListingOptions, type StreamOptions, type StreamWatcher, type Watcher} from "./watcher.ts"

// 'pics', '/r/pics', 'r/pics' all work, blank means all of reddit, 'pics+gifs' watches both
export function cleanSubreddit(subreddit = ""): string {
    return subreddit.trim().replace(/^\/?r\//i, "").replace(/\//g, "") || "all"
}

// snooper.watch.*
export class Watch {
    readonly #api: RedditApi

    constructor(api: RedditApi) {
        this.#api = api
    }

    /** new posts, oldest first. 'all' or blank is all of reddit */
    posts(subreddit = "all", options: StreamOptions = {}): StreamWatcher<Post> {
        return new FeedWatcher<Post>(this.#api, `r/${cleanSubreddit(subreddit)}/new`, "t3", options)
    }

    /** new comments, oldest first. 'all' or blank is all of reddit */
    comments(subreddit = "all", options: StreamOptions = {}): StreamWatcher<Comment> {
        return new FeedWatcher<Comment>(this.#api, `r/${cleanSubreddit(subreddit)}/comments`, "t1", options)
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
