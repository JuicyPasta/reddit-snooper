"use strict"

const axios = require("axios")
const EventEmitter = require("events")

module.exports = function (snooper_options) {

    class RedditWatcher extends EventEmitter {
        constructor(start_page, item_type, options) {
            super()

            this.item_type = item_type
            this.options = options
            this.start_page = start_page
            this.is_closed = false

            // Automatically rate limit to 10 requests per minute minimum (6s between requests minimum)
            this.requests_per_minuite = snooper_options.api_requests_per_minute || 10;
            let requestInterval = (1000 * 60) / this.requests_per_minuite;

            if (requestInterval < 6000) {
                console.warn(`User defined requests per minute of ${this.requests_per_minuite} is too high, defaulting to the max of 10 requests per minute minimum`)
                requestInterval = 6000;
            }

            this.wait_interval = requestInterval
            this.retries = 3

            this.once("newListener", (event, listener) => {
                if (event === this.item_type) {
                    this.start()
                } else {
                    throw "event type not recognized, use a valid event type like: error or " + this.item_type
                }
            })
        }

        start() {}

        close() {
            this.is_closed = true
        }

        get_items(start_page, after_name, posts_needed, until_name, cb_first_item, cb) {
            this._get_items(start_page, after_name, posts_needed, until_name, [], this.retries, cb_first_item, cb)
        }

        async _get_items(start_page, after_name, posts_needed, until_name, items, retries, cb_first_item, cb) {
            if (this.is_closed) return

            // console.log({ start_page, after_name, posts_needed, until_name, items, retries })

            try {
                const response = await axios.get(start_page, {
                    params: { after: after_name },
                    // headers: { 'User-Agent': 'reddit-watcher-bot' }
                })

                const body = response.data
                const children = body.data.children

                if (children.length > 0) {
                    if (!after_name && cb_first_item) cb_first_item(children[0].data.name)

                    let is_done = false

                    if (posts_needed !== null && children.length >= posts_needed) {
                        children.splice(posts_needed)
                        is_done = true
                    }

                    if (until_name) {
                        for (let i = 0; i < children.length; i++) {
                            if (children[i].data.name === until_name) {
                                children.splice(i)
                                is_done = true
                                break
                            }
                        }
                    }

                    if (!until_name && posts_needed == null){
                        return
                    }

                    items = items.concat(children)

                    if (!is_done) {
                        setTimeout(() => {
                            this._get_items(
                                start_page,
                                children[children.length - 1].data.name,
                                posts_needed ? posts_needed - children.length : posts_needed,
                                until_name,
                                items,
                                this.retries,
                                cb_first_item,
                                cb)
                        }, this.wait_interval)
                    } else {
                        cb(null, items)
                    }

                } else {
                    cb('Requested too many items (reddit does not keep this large of a listing)', items)
                }

            } catch (err) {
                if (retries > 0) {
                    setTimeout(() => {
                        console.warn(`Retrying... (${retries} left)`)
                        this._get_items(start_page, after_name, posts_needed, until_name, items, retries - 1, cb_first_item, cb)
                    }, this.wait_interval)
                } else {
                    cb(err)
                }
            }
        }
    }

    class RedditListingWatcher extends RedditWatcher {
        constructor(start_page, item_type, options) {
            super(start_page, item_type, options)

            this.limit = options.limit || 25
            this.seen_items = []
            this.seen_items_size = this.limit * 5
        }

        start() {
            if (this.is_closed) return
            this.get_items(this.start_page, '', this.limit, '', null, (err, data) => {
                if (err) return this.emit('error', err)

                let new_data = 0

                for (let i = 0; i < data.length; i++) {
                    if (this.seen_items.indexOf(data[i].data.name) < 0) {
                        new_data++
                        this.emit(this.item_type, data[i])
                        this.seen_items.push(data[i].data.name)

                        if (this.seen_items.length > this.seen_items_size)
                            this.seen_items.shift()
                    }
                }

                setTimeout(() => {
                this.start()
                }, this.wait_interval)
            })
        }
    }

    class RedditFeedWatcher extends RedditWatcher {
        constructor(start_page, item_type, options) {
            super(start_page, item_type, options)
        }

        _start(until_name) {
            if (this.is_closed) return
            this.get_items(this.start_page, '', null, until_name, (first_comment_retrieved) => {
                setTimeout(() => {
                    this._start(first_comment_retrieved)
                }, this.wait_interval);
            }, (err, data) => {
                if (err) return this.emit('error', err)
                data.map((item) => this.emit(this.item_type, item))
            })
        }

        start() {
            this._start('')
        }
    }

    function getCommentWatcher(subreddit, options) {
        subreddit = subreddit.trim().replace("/", "")
        let start_page = "https://reddit.com/r/" + subreddit + "/comments.json"
        return new RedditFeedWatcher(start_page, "comment", options)
    }

    function getPostWatcher(subreddit, options) {
        subreddit = subreddit.trim().replace("/", "")
        let start_page = "https://reddit.com/r/" + subreddit + "/new.json"
        return new RedditFeedWatcher(start_page, "post", options)
    }

    function getMultiWatcher(username, multi, options) {
        username = username.trim().replace("/", "")
        multi = multi.trim().replace("/", "")
        let start_page = "https://reddit.com/user/" + username + "/m/" + multi + "/new.json"
        return new RedditFeedWatcher(start_page, "post", options)
    }

    function getGildedWatcher(subreddit, options) {
        // To be implemented
    }

    function getListingWatcher(subreddit, options) {
        options.listing = options.listing || 'hot'
        subreddit = subreddit ? 'r/' + subreddit : ''
        let start_page = 'https://reddit.com/' + subreddit + '/'

        if (['hot', 'rising', 'controversial', 'new'].includes(options.listing)) {
            start_page += options.listing + '.json'
        } else if (options.listing.startsWith('top_')) {
            const time = options.listing.substring(4)
            start_page += `top.json?sort=top&t=${time}`
        } else {
            throw "invalid listing type"
        }

        return new RedditListingWatcher(start_page, 'item', options)
    }

    return {
        getCommentWatcher,
        getPostWatcher,
        getGildedWatcher,
        getListingWatcher,
        getMultiWatcher
    }

}
