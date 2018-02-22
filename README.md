# Reddit-Snooper - Reddit bot framework for Nodejs

[![npm](https://img.shields.io/npm/v/reddit-snooper.svg)](https://www.npmjs.com/package/reddit-snooper)
[![test](https://github.com/JuicyPasta/reddit-snooper/actions/workflows/test.yml/badge.svg)](https://github.com/JuicyPasta/reddit-snooper/actions/workflows/test.yml)


## Simple to use
Reddit-snooper is designed to be a simple but powerful interface to talk to Reddit. Reddit represents all of its objects in JSON natively which makes javascript a good choice for building a bot. It's written in TypeScript now, so you get types for all of it too.

``` ts
for await (const comment of snooper.watch.comments('all')) {
    console.log('/u/' + comment.data.author + ' posted a comment: ' + comment.data.body)
    await snooper.api.post(...) // leave a reply
}
```


## Table of Contents
- [Setup and Configuration](#setup-and-configuration)
- [What needs credentials](#what-needs-credentials)
- [Watcher](#reddit-watcher-snooperwatch)
- [How the sitewide watchers work](#how-the-sitewide-watchers-work)
- [Api](#reddit-api-snooperapi)
- [Upgrading from 1.x](#upgrading-from-1x)

## Setup and Configuration
### Installing reddit-snooper
``` bash
npm install reddit-snooper --save
```
Needs node 22 or newer (it uses the built in fetch, no other dependencies). Types are included and it works with both `import` and `require`.

### Library usage and configuration
``` ts
import {Snooper} from 'reddit-snooper' // or const {Snooper} = require('reddit-snooper')

const snooper = new Snooper({
    // appId and appSecret are enough for snooper.watch,
    // username and password are only needed when your bot acts as a user (posting, voting, etc.)
    auth: {
        appId: 'reddit api app id',
        appSecret: 'reddit api secret',
        username: 'reddit_username',
        password: 'reddit password'
    },
    userAgent: 'node:my-bot:v1.0.0 (by /u/your_username)', // OPTIONAL but reddit wants one in this format

    retryRateLimitedActions: true, // automatically handles condition when reddit says 'you are doing this too much'
    requestsPerMinute: 90 // api requests will be spread out in order to play nicely with Reddit (it allows 100)
})
```

### API setup
All you need to get up and running is obtain an appId and an appSecret. Both can be created on the [Reddit app console](https://www.reddit.com/prefs/apps)
1. Create (or log into) a reddit account
2. Navigate to the [authorized applications console](https://www.reddit.com/prefs/apps)
3. Select 'create another app...' at the bottom
4. Fill in the name, description and click on 'script', put in anything for the redirect uri, it's not needed and you can change it later if you want to
5. Copy down the 'secret' that is your appSecret, the string under the name of your app is your appId
6. Use these values and your credentials to configure the snooper

Reddit reviews new apps now (their Responsible Builder Policy), so you might have to request API access and wait before step 3 works.

### What needs credentials
Reddit wants OAuth for pretty much everything now, caps each app at about 100 requests a minute and blocks logged out or generic looking clients a lot more than it used to.

- watchers just need an appId and appSecret, snooper gets an app only token and watches through oauth.reddit.com. With no `auth` at all it falls back to the public .json pages (10 requests a minute), but Reddit blocks most of that traffic now and you'll get a 403 "blocked by network security" error.
- snooper.api calls that act as your bot (commenting, voting, /api/v1/me, etc.) need username and password too, on a 'script' app. GETs without any credentials go to the public .json pages like the watchers do.
- set your own userAgent, something like `node:my-bot:v1.0.0 (by /u/your_username)`. The default one just says reddit-snooper.

Snooper spaces requests out to stay under `requestsPerMinute`, reads Reddit's `x-ratelimit-*` headers and waits out 429s on its own. Watchers wait in line behind your own calls, so a busy watcher can't hold up your bot's replies.


## Reddit Watcher (snooper.watch)
Reddit watchers trigger when new things happen on the website,
Right now you can watch for:
- new comments across the website or on a specific subreddit
- new posts across the website or on a specific subreddit
- new posts on a user's multi subreddit
- new posts reaching the first x spots of different listings (hot, rising, controversial, top) across the website or subreddit

Subreddits can be combined like `'pics+gifs'`.

Every watcher works two ways, use whichever you like: `for await` over it, or `.on('item', ...)` like an event emitter. It starts when you start looping or add an 'item' listener. It stops when you `break` out of the loop, call `.close()`, or abort the `signal` you gave it. New posts and comments come out oldest first.

Errors that might fix themselves (reddit having a bad time, rate limits) get emitted on 'error' and retried with backoff. Ones that won't (the subreddit doesn't exist or is private, bad credentials) stop the watcher: the loop throws, or you get an 'error' event.

notify when a new comment is posted
``` ts
for await (const comment of snooper.watch.comments('subreddit')) { // blank argument or 'all' looks at the entire website
    // comment is a object containing all comment data
    console.log('comment was posted by: ' + comment.data.author)
    console.log('contents ' + comment.data.body)
    // or
    console.log(comment)
}
```

notify when a new post is posted (event style)
``` ts
snooper.watch.posts('subreddit') // blank argument or 'all' looks at the entire website
    .on('item', (post) => {
        console.log('post was posted by: ' + post.data.author)
        console.log(post)
    })
    .on('error', console.error)
```

notify when a new post reaches a specific listing (eg. the front page)
``` ts
snooper.watch.listing('subreddit', { // 'all' for r/all, blank for the front page
    sort: 'top', // 'hot' OR 'rising' OR 'controversial' OR 'top'
    time: 'day', // top and controversial only: 'hour' OR 'day' OR 'week' OR 'month' OR 'year' OR 'all'
    limit: 50 // how many posts you want to watch? if any of these spots get overtaken by a new post you hear about it, 50 is 2 pages
})
    .on('item', (post) => console.log('new item in listing ' + post.data.title))
    .on('error', console.error)
```

notify when a new post is posted (on a user's multi subreddit)
``` ts
for await (const post of snooper.watch.multi('username', 'multi')) {
    console.log('post was posted by: ' + post.data.author)
}
```

stop it, and pick up where you left off next time
``` ts
const stop = new AbortController()
const watcher = snooper.watch.comments('all', {
    signal: stop.signal,                   // stop.abort() ends the for await loop (watcher.close() works too)
    startAfter: fs.readFileSync('cursor', 'utf8'), // instead of starting at whatever is newest
    pollInterval: 1000                     // ms to wait between polls once it's caught up
})
watcher.on('warning', (warning) => console.warn(warning.message))

for await (const comment of watcher) {
    // ...
}
if (watcher.cursor) fs.writeFileSync('cursor', watcher.cursor)
```

Warnings aren't errors, nothing stopped: `'missed-items'` when a subreddit's listing moved faster than snooper could page back (reddit only keeps ~1000), `'behind'` when a sitewide watcher is minutes behind reddit, and `'skipped-ids'` when it jumped a hole (see below).

### How the sitewide watchers work
In 1.x, watching all of reddit meant polling /r/all/new over and over, paging back through up to 1000 posts each time and hoping nothing fell off the end. Now `posts('all')` and `comments('all')` just count. Reddit ids are base 36 numbers that go up by one for every post (t3_) and comment (t1_), and /api/info takes 100 of them at a time, so the watcher asks for the next 100 ids, hands out whatever comes back in id order, and moves on.

- it starts at the newest item on /r/all/new (or /r/all/comments), or at your `startAfter`
- deleted, removed and spam stuff (and anything in private or quarantined subs) never comes back from /api/info. An id that's missing next to brand new ones gets asked for a few more times in case it's just late (`lateRetries`, default 3), then it's skipped
- a batch that doesn't fill up means it caught up with reddit, so it waits (5s for posts, 1s for comments) before asking again
- when whole batches come back empty it sends a few probe ids further ahead to tell a hole from the end, and jumps the hole instead of reading through it 100 ids at a time
- falling behind doesn't lose anything, ids don't expire like a listing does
- it sees subs that opt out of r/all too, which the old way never did

Reddit makes about 1,000 post ids and 7,000 comment ids a minute (going by how fast the ids have been climbing, spam included). That's ~12 requests a minute for the post watcher and ~70 for the comment watcher, which is why `requestsPerMinute` defaults to 90 now. If your bot is busy with other calls the comment watcher falls behind and tells you so.

A specific subreddit still polls its own /new or /comments listing. Walking every id on reddit to keep the handful from one sub would cost as much as watching everything.

Heads up: the id walking has only been run against the fake reddit in test/ so far, I don't have API access to try it on the real thing yet.

### examples (full programs in the examples folder)
#### unexpected factorial bot
``` ts
for await (const comment of snooper.watch.comments('all')) {
    // only reply if the comment contains a factorial
    const match = comment.data.body.match(/\b([0-9]{1,3})!/)
    if (!match) continue

    // post a reply, if you have retryRateLimitedActions set to true this comment will make
    // it through even if it takes 10+ minutes ('you are doing this too much!') otherwise
    // you get a RateLimitError
    snooper.api.post('/api/comment', {
        api_type: 'json',
        text:     match[0] + ' = ' + factorial(Number(match[1])),
        thing_id: comment.data.name
    }).then(() => console.log('just replied to comment: ' + comment.data.name), console.error)
}
```

#### RemindMe! bot
```ts
// also coming soon, this is really easy to implement with setTimeout
```

#### download all gifs that make it to the front 2 pages of top on r/gifs
this is different than just downloading the front 2 pages since it also triggers an event when the front 2 pages change
``` ts
snooper.watch.listing('gifs', {
    sort: 'top', time: 'day', // look at the top posts of the day
    limit: 50 // 2 pages (25 per page)
})
.on('item', (post) => {
    const urlmatch = post.data.url.match(/\.([a-zA-Z0-9]+)$/)

    // filter out stickied posts
    if (!post.data.stickied && urlmatch) {
       download(post.data.url, './gifs/' + post.data.title.replace(/[^\w\- ]/g, '') + urlmatch[0]) // little fetch helper, see examples/
    }
})
```

#### download all pics that are posted to r/pics
``` ts
for await (const post of snooper.watch.posts('pics')) {
    // make sure there is an image link
    const urlmatch = post.data.url.match(/\.([a-zA-Z]+)$/)
    if (!post.data.is_self && urlmatch) {
        await download(post.data.url, 'pics/' + post.data.title.replace(/[^\w\- ]/g, '') + urlmatch[0])
    }
}
```

The examples read credentials from `REDDIT_APP_ID`, `REDDIT_APP_SECRET`, `REDDIT_USERNAME` and `REDDIT_PASSWORD`, and run straight through node: `node examples/new-pic-downloader.ts`.


## Reddit API (snooper.api)

Snooper's api component is an agnostic wrapper around Reddit's rest API that handles retries, rate limit throttling and Reddit's different response codes.

In order to use the api head over to the [Reddit API Documentation](https://www.reddit.com/dev/api/). All of the api methods use one of the 5 HTTP methods (GET, POST, PATCH, PUT, DELETE) which map to the 5 different snooper.api methods. They return a promise of whatever reddit sent back, and throw when reddit says no.

``` ts
// endpoint: api endpoint ex: 'api/v1/me' or '/api/v1/me/karma/' (listed on api documentation)
// data: dependent on the request which is specified in the docs. GET data goes in the query string,
// POST data as a form and PATCH/PUT/DELETE data as json, which is what reddit expects

const me = await snooper.api.get(endpoint, data)  // HTTP GET
await snooper.api.post(endpoint, data)            // HTTP POST
await snooper.api.patch(endpoint, data)           // HTTP PATCH
await snooper.api.put(endpoint, data)             // HTTP PUT
await snooper.api.delete(endpoint, data)          // HTTP DELETE

// say what you expect back and you get types for it (it's unknown otherwise)
const newest = await snooper.api.get<Listing<Post>>('r/node/new', {limit: 5})

// the status code and headers too
const {status, headers, body} = await snooper.api.request('GET', 'api/v1/me')

// posts and comments by fullname, up to 100 at a time
const [post] = await snooper.api.info<Post>(['t3_6arf2r'])

// gets an api token
const token = await snooper.api.token()
```

Everything snooper throws is a `SnooperError`:
``` ts
import {ApiError, AuthError, RateLimitError} from 'reddit-snooper'

try {
    await snooper.api.post('/api/comment', {api_type: 'json', text: 'hi', thing_id: comment.data.name})
} catch (err) {
    if (err instanceof RateLimitError) {
        // 'you are doing this too much', or 429s it gave up on. err.retryAfterMs says how long
    } else if (err instanceof ApiError) {
        // reddit said no: err.status, err.errors (reddit's json.errors, like THREAD_LOCKED), err.body
    } else if (err instanceof AuthError) {
        // no credentials, or reddit turned them down
    }
}
```

*Note: new accounts get little to no posting privileges (1 comment or post per 5 minutes or more) if you dont have any karma. If you just want to play around with the api I recommend using an active account.*


### basic api usage

check how much karma your bot has
``` ts
const karma = await snooper.api.get<{data: {sr: string, comment_karma: number}[]}>('api/v1/me/karma')
console.log('I have karma in ' + karma.data.length + ' subreddits')
```

post a comment
``` ts
await snooper.api.post('/api/comment', {
    api_type: 'json',
    text:     'Hello World',
    thing_id: comment.data.name
})
console.log('just replied to comment: ' + comment.data.name)
```


I highly doubt your bot is over 18 years of age
``` ts
await snooper.api.patch('/api/v1/me/prefs/', {
    over_18: false
})
```


## Upgrading from 1.x
2.0 breaks pretty much everything, but it's mostly renames.

- node 22 or newer. `new Snooper(...)` is a class now, `import {Snooper} from 'reddit-snooper'` or `const {Snooper} = require('reddit-snooper')`
- options are camelCase and the credentials moved into `auth`: `app_id` → `auth.appId`, `api_secret` → `auth.appSecret`, `username`/`password` → `auth.username`/`auth.password`, `user_agent` → `userAgent`, `api_requests_per_minute` → `requestsPerMinute` (the default went from 60 to 90), `automatic_retries` → `retryRateLimitedActions`
- `snooper.watcher.getPostWatcher(sub)` → `snooper.watch.posts(sub)`, `getCommentWatcher` → `comments`, `getMultiWatcher` → `multi`, `getListingWatcher(sub, {listing: 'top_week'})` → `listing(sub, {sort: 'top', time: 'week'})`, `wait_interval` → `pollInterval`
- `getGildedWatcher` is gone. It never worked and reddit got rid of gold anyway
- every watcher emits `'item'` instead of `'post'`/`'comment'`, and you can `for await` it instead
- new posts and comments come out oldest first (they used to come out newest first within each poll)
- `'all'` and blank post/comment watchers walk ids now (see above), so they also pick up subs that opt out of r/all
- a watcher stops on errors retrying can't fix (missing or private subreddit, bad credentials) instead of retrying them forever. "fell behind" is a `'warning'` now, not an error
- `snooper.api.get(endpoint, data, cb)` → `await snooper.api.get(endpoint, data)`, which gives you the body. Use `snooper.api.request()` if you need the status code
- anything that isn't a 2xx throws an `ApiError` instead of showing up as a status code in the callback, and so do 200s where reddit's `json.errors` says no (locked thread etc)
- `get_token(cb)` → `await token()`, `del` → `delete`
- GETs send `raw_json=1`, so text comes back with `&` and `<` instead of `&amp;` and `&lt;`
- the examples and integ tests read credentials from env vars instead of secrets/reddit-credentials.js


## Coming Soon
- Support for multiple accounts
- Convenience methods for commonly used api requests
- Watchers for **everything**
    - private messages
    - replies

## Tests
``` bash
npm test            # builds, then unit tests against a fake reddit, so no credentials needed
npm run typecheck
npm run test:integ  # hits the real api, needs REDDIT_APP_ID and REDDIT_APP_SECRET (plus REDDIT_USERNAME and REDDIT_PASSWORD for the bot parts)
```
