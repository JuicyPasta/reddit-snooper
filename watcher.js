"use strict"

const EventEmitter = require("events")
const Api = require("./api")

// reddit only keeps about 1000 items in a listing, 10 pages of 100
const MAX_PAGES = 10
const PAGE_SIZE = 100

module.exports = function (snooper_options, api) {
    snooper_options = snooper_options || {}
    api = api || Api(snooper_options)

    // reddit ids are base 36 and count up, so we can tell whats newer even if the item we stopped at got deleted
    function id_of(name) {
        return parseInt(String(name).split("_").pop(), 36)
    }

    function listing_error(path, status, body) {
        let reason = (body && typeof body === "object" && body.reason) ? " (" + body.reason + ")" : ""

        if (status === 403 && typeof body === "string") {
            return "reddit blocked the request to /" + path + " (403). reddit wants oauth for almost everything now, give snooper an app_id and api_secret"
        } else if (status === 403) {
            return "/" + path + " is private or forbidden" + reason
        } else if (status === 404 || (status >= 300 && status < 400)) {
            // logged out, reddit redirects subreddits that dont exist to the search page
            return "/" + path + " doesn't exist" + reason
        } else if (status === 429) {
            return "reddit is rate limiting us (429), backing off"
        } else if (status === 401) {
            return "reddit rejected our token for /" + path + " (401), check app_id and api_secret"
        }
        return "unexpected response from reddit for /" + path + " (" + status + ")"
    }

    class RedditWatcher extends EventEmitter {
        constructor(start_page, item_type, options, query) {
            super()

            this.item_type = item_type
            this.options = options || {}
            this.start_page = start_page // path like r/all/new
            this.query = query || {}
            this.is_closed = false
            this.is_started = false
            this.wait_interval = this.options.wait_interval || 0 // the api rate limit spaces requests out already
            this.failures = 0
            this.timer = null

            this.on("newListener", (event, listener) => {
                if (event === this.item_type) {
                    if (!this.is_started) {
                        this.is_started = true
                        // wait until the rest of the .on() chain (like .on('error')) is attached
                        process.nextTick(() => this.start())
                    }
                } else if (event !== "error" && event !== "newListener" && event !== "removeListener") {
                    throw new Error("event type not recognized, use a valid event type like: error or " + this.item_type)
                }
            })
        }

        start() {
            if (this.is_closed)
                return

            this.poll((err, items, warning) => {
                if (this.is_closed)
                    return

                if (err) {
                    this.failures++
                    this.emit("error", err)
                } else {
                    this.failures = 0
                    items.forEach((item) => this.emit(this.item_type, item))
                    if (warning) this.emit("error", warning)
                }

                // someone might have closed us from inside a listener
                if (this.is_closed)
                    return

                // back off when things are going wrong: 5s, 10s, 20s... up to 5 mins
                let wait = this.failures ? Math.min(5000 * Math.pow(2, this.failures - 1), 5 * 60 * 1000) : this.wait_interval
                this.timer = setTimeout(() => this.start(), wait)
            })
        }

        poll(cb) {
            cb(null, [])
        }

        close() {
            this.is_closed = true
            clearTimeout(this.timer)
        }

        // gets one page of the listing, cb(err, {children, after})
        get_page(after_name, limit, cb) {
            let query = Object.assign({}, this.query, {limit: limit})
            if (after_name) query.after = after_name

            api.get(this.start_page, query, (err, status, body) => {
                if (this.is_closed)
                    return
                if (err)
                    return cb(err)
                if (status !== 200 || !body || body.kind !== "Listing" || !body.data) {
                    return cb(listing_error(this.start_page, status, body))
                }

                cb(null, {children: body.data.children || [], after: body.data.after})
            })
        }

        // first n items of the listing (or less if reddit doesnt have that many)
        get_items(posts_needed, cb, after_name, items) {
            items = items || []

            this.get_page(after_name, Math.min(PAGE_SIZE, posts_needed - items.length), (err, page) => {
                if (err)
                    return cb(err)

                items = items.concat(page.children).slice(0, posts_needed)

                if (items.length >= posts_needed || !page.after || page.children.length === 0) {
                    return cb(null, items)
                }
                this.get_items(posts_needed, cb, page.after, items)
            })
        }

        // everything newer than until_name, newest first
        // cb(err, items, warning) warning is set when we couldnt page back far enough to catch up
        get_items_until(until_name, cb, after_name, items, pages) {
            items = items || []
            pages = pages || 0
            let until_id = id_of(until_name)

            this.get_page(after_name, PAGE_SIZE, (err, page) => {
                if (err)
                    return cb(err)

                for (let i = 0; i < page.children.length; i++) {
                    // stop at the last thing we saw, or anything older than it if it got removed
                    if (id_of(page.children[i].data.name) <= until_id) {
                        return cb(null, items)
                    }
                    items.push(page.children[i])
                }

                if (!page.after || page.children.length === 0 || pages + 1 >= MAX_PAGES) {
                    return cb(null, items, "fell behind on /" + this.start_page + " (reddit only keeps ~1000 items), some items were probably missed")
                }
                this.get_items_until(until_name, cb, page.after, items, pages + 1)
            })
        }
    }

    // posts/comments in the order they were made
    class RedditFeedWatcher extends RedditWatcher {
        constructor(start_page, item_type, options) {
            super(start_page, item_type, options)
            this.newest_name = null
            this.is_primed = false
        }

        poll(cb) {
            // first time around just remember where the feed is, this makes it so feeds dont receive current data
            if (!this.is_primed) {
                return this.get_page(null, 1, (err, page) => {
                    if (err)
                        return cb(err)
                    this.is_primed = true
                    if (page.children.length > 0) this.newest_name = page.children[0].data.name
                    cb(null, [])
                })
            }

            // feed was empty last time, everything on the first page is new
            if (!this.newest_name) {
                return this.get_page(null, PAGE_SIZE, (err, page) => {
                    if (err)
                        return cb(err)
                    this.remember_newest(page.children)
                    cb(null, page.children)
                })
            }

            this.get_items_until(this.newest_name, (err, items, warning) => {
                if (err)
                    return cb(err)
                this.remember_newest(items)
                cb(null, items, warning)
            })
        }

        remember_newest(items) {
            items.forEach((item) => {
                if (!this.newest_name || id_of(item.data.name) > id_of(this.newest_name)) {
                    this.newest_name = item.data.name
                }
            })
        }
    }

    // listings are reddit pages where posts can show pop in and out in no particular order or location
    // as opposed to feeds which sequentially display new content
    class RedditListingWatcher extends RedditWatcher {
        constructor(start_page, item_type, options, query) {
            super(start_page, item_type, options, query)

            this.limit = this.options.limit || 25
            this.seen_items = []
            this.seen_items_size = this.limit * 5
        }

        poll(cb) {
            this.get_items(this.limit, (err, data) => {
                if (err)
                    return cb(err)

                let new_items = []
                for (let i = 0; i < data.length; i++) {
                    if (this.seen_items.indexOf(data[i].data.name) < 0) {
                        new_items.push(data[i])

                        this.seen_items.push(data[i].data.name)

                        if (this.seen_items.length > this.seen_items_size)
                            this.seen_items.shift()
                    }
                }

                cb(null, new_items)
            })
        }
    }

    // 'pics', '/r/pics', 'r/pics' all work, blank means all of reddit, 'pics+gifs' watches both
    function clean_subreddit(subreddit) {
        subreddit = (subreddit || "").trim().replace(/^\/?r\//i, "").replace(/\//g, "")
        return subreddit || "all"
    }

    function getCommentWatcher(subreddit, options) {
        let start_page = "r/" + clean_subreddit(subreddit) + "/comments"

        return new RedditFeedWatcher(start_page, "comment", options)
    }

    function getPostWatcher(subreddit, options) {
        let start_page = "r/" + clean_subreddit(subreddit) + "/new"

        return new RedditFeedWatcher(start_page, "post", options)
    }

    function getMultiWatcher(username, multi, options) {
        username = username.trim().replace(/\//g, "")
        multi = multi.trim().replace(/\//g, "")
        let start_page = "user/" + username + "/m/" + multi + "/new"

        return new RedditFeedWatcher(start_page, "post", options)
    }

    function getGildedWatcher(subreddit, options) {
        throw new Error("getGildedWatcher never got finished and reddit has since gotten rid of gold, sorry")
    }

    // listings: hot, rising, controversial, top_hour, top_day, top_week, top_month, top_year, top_all
    function getListingWatcher(subreddit, options) {
        options = options || {}
        options.listing = options.listing || "hot"

        // blank subreddit is the front page
        let start_page = subreddit ? "r/" + clean_subreddit(subreddit) + "/" : ""
        let query = {}

        if (options.listing === "hot" || options.listing === "rising" || options.listing === "controversial") {
            start_page += options.listing
        } else if (/^top_(hour|day|week|month|year|all)$/.test(options.listing)) {
            start_page += "top"
            query.t = options.listing.substring(4)
        } else {
            throw new Error("invalid listing type: " + options.listing)
        }

        return new RedditListingWatcher(start_page, "item", options, query)
    }

    return {
        getCommentWatcher,
        getPostWatcher,
        getGildedWatcher,
        getListingWatcher,
        getMultiWatcher
    }

}
