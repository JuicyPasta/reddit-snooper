# Reddit-Snooper - Reddit bot framework for Nodejs

[![npm package](https://nodei.co/npm/reddit-snooper.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/reddit-snooper/)

[![Build Status](https://travis-ci.org/JuicyPasta/reddit-snooper.svg?branch=master)](https://travis-ci.org/JuicyPasta/reddit-snooper)
[![dependencies Status](https://david-dm.org/JuicyPasta/reddit-snooper/status.svg)](https://david-dm.org/JuicyPasta/reddit-snooper)
[![Gitter](https://badges.gitter.im/reddit-snooper-nodjs/Lobby.svg)](https://gitter.im/reddit-snooper-nodjs/Lobby?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=body_badge)


## Simple to use
Reddit-snooper is designed to a simple but powerful interface to talk to Reddit. Reddit represents all of its objects in JSON natively which makes javascipt a good choice for building a bot.

``` js
snooper.watcher.getCommentWatcher('all') 
    .on('comment', function(comment) {
        console.log('/u/' + comment.data.author + ' posted a comment: ' + comment.data.body)
        snooper.api.post(...) // leave a reply 
    }
```


## Table of Contents
- [Setup and Configuration](#setup-and-configuration)
- [Watcher](#reddit-watcher-snooperwatcher)
- [Api](#reddit-api-snooperapi)

## Setup and Configuration
### Installing reddit-snooper
``` bash
npm install reddit-snooper --save
```

### Library usage and configuration
``` js
var Snooper = require('reddit-snooper')
    snooper = new Snooper(
        {
            // credential information is not needed for snooper.watcher
            username: 'reddit_username',
            password: 'reddit password',
            app_id: 'reddit api app id',
            api_secret: 'reddit api secret',
            user_agent: 'OPTIONAL user agent for your bot',

            automatic_retries: true, // automatically handles condition when reddit says 'you are doing this too much'
            api_requests_per_minuite: 60 // api requests will be spread out in order to play nicely with Reddit
        })
```

### API setup 
All you need to get up and running is obtain an api_id and an api_secret. Both can be created on the [Reddit app console](https://reddit.com/prefs/apps)
1. Create (or log into) a reddit account
2. Navigate to the [authorized applications console](https://reddit.com/prefs/apps)
3. Select 'create another app...' at the bottom
4. Fill in the name, description and click on 'script', put in anything for the redirect uri, its not needed and you can change it later if you want to
5. Copy down the 'secret' that is your api_secret, the 14 character string by the name of your app is your app_id
6. Use these values and your credentials to configure the snooper


## Reddit Watcher (snooper.watcher)
Reddit watchers are event emitters that trigger when new things happen on the website,
Right now you can watch for:
- new comments across the website or on a specific subreddit
- new posts across the website or on a specific subreddit
- post or comment is gilded (website or subreddit)
- new posts reaching the first x pages of different listings (hot, top_24, top_day, controversial, rising) across the website or subreddit

notify when a new comment is posted
``` js
snooper.watcher.getCommentWatcher('subreddit') // blank argument or 'all' looks at the entire website
    .on('comment', function(comment) {
        // comment is a object containing all comment data
        console.log('comment was posted by: ' + comment.data.author)
        console.log('contents ' + comment.data.body)
        // or
        console.log(comment)
    })
    .on('error', console.error)
```

notify when a new post is posted
``` js
snooper.watcher.getPostWatcher('subreddit') // blank argument or 'all' looks at the entire website
    .on('post', function(post) {
        // comment is a object containing all comment data
        console.log('post was posted by: ' + post.data.author)
        console.log(post)
    })
    .on('error', console.error)
```

notify when something is gilded
``` js
snooper.watcher.getGildedWatcher('subreddit') // blank argument or 'all' looks at the entire website
    .on('item', function(item) {
        // comment is a object containing all comment data
        console.log('user: ' + post.data.author + ' has been gilded')
        console.log(item)
    })
    .on('error', console.error)
```

notify when a new post reaches a specific listing (eg. the front page)
``` js
let options = {
    listing: 'hot', // 'hot' OR 'rising' OR 'controversial' OR 'top_day' OR 'top_hour' OR 'top_month' OR 'top_year' OR 'top_all'
    limit: 50 // how many posts you want to watch? if any of these spots get overtaken by a new post an event will be emitted, 50 is 2 pages
}
snooper.watcher.getListingWatcher('subreddit' or 'all', options) 
    .on('item', function(item) {
        console.log("new item in listing " + item)
    })
    .on('error', console.error)
```

### examples (full programs in the examples folder)
#### unexpected factorial bot
``` js
snooper.watcher.getCommentWatcher("all")
.on("comment", function (comment) {

    // only reply if the comment contains a factorial
    let match = comment.data.body.match("[0-9]+!")
    if (match) {

        // post a reply, if you have automatic_retries set to true this comment will make
        // it through even if it takes 10+ minutes ('you are doing this too much!') otherwise
        // an error will be thrown
        snooper.api.post("/api/comment", {
            api_type: "json",
            text:     match[0] + " = " + factorial(+match[0].substring(0, match[0].length -1)),
            thing_id: comment.data.name
        }, function (err, statusCode, data) {
            if (!err) console.log('just replied to comment: ' + comment.data.name)
        })
    }
})
.on("error", console.error)

// when you are done 
// commentWatcher.close()
```

#### repost all gilded comments with over 1000 ups to r/bestof (please dont do this)
``` js

snooper.watcher.getGildedWatcher('all')
.on('item', function(err, data) {
    
... coming soon
})

```

#### RemindMe! bot
```js
// also coming soon, this is really easy to implement with setTimeout 
```

#### download all gifs that make it to the front 2 pages of hot on r/gifs
this is different than just downloading the front 2 pages since it also triggers an event when the front 2 pages change
``` js

snooper.watcher.getListingWatcher('gifs', {
    listing: 'top_day', // look at the top posts of the day
    limit: 50 // 2 pages (25 per page)
})
.on('item', function(post) { // post will be a json object containing all post information
    let urlmatch = post.data.url.match('\.([a-zA-Z]+$)')
    
    // filter out stickied posts
    if (!post.data.stickied && post.kind === 't3') {
       request(post.data.url).pipe(fs.createWriteStream("./gifs/"+post.data.title.split('\"').join('')+urlmatch[0]))
    }

})

```

#### download all pics that are posted to r/pics
``` js
// start watching for new posts to r/pics
snooper.watcher.getPostWatcher('pics')
.on('post', function(post) { // post will be a json object containing all post information

    // check if its a link post (t3, definitions found on reddit api page)
    // also make sure there is an image link
    let urlmatch = post.data.url.match('\.([a-zA-Z]+$)')
    if (post.kind === 't3' && urlmatch) {
        request(post.data.url).pipe(fs.createWriteStream("gifs/"+post.data.title+urlmatch[0]))
    }

})
.on('error', console.error)
```


## Reddit API (snooper.api)

Snooper's api component is an agnostic wrapper around Reddit's rest API that handles retries, rate limit throttling and Reddit's different response codes.

In order to use the api head over to the [Reddit API Documentation](https://www.reddit.com/dev/api/). All of the api methods use one of the 5 HTTP methods (GET, POST, PATCH, PUT, DELETE) which map to the 5 different snooper.api methods. 

``` js
// endpoint: api endpoint ex: 'api/v1/me' or '/api/v1/me/karma/' (listed on api documentation)
// data: JSON data, dependent on the request which is specified in the docs
// NOTE: the function .get is used for api calls that use HTTP GET, you can find the method each api endpiont uses on (you guessed it) the reddit api docs

// HTTP GET
snooper.api.get(endpoint, data, function(err, responseCode, responseData) {
    if (err) {
        return console.error("api request failed: " + err)
    }
    
    console.log("API reponded")
    console.log("status: " + respnoseCode) // http status codes
    console.log("data: " + responseData)
})
    
// HTTP POST
snooper.api.post(endpoint, data, function(err, responseCode, responseData) {
    //...
})

// HTTP PATCH
snooper.api.patch(endpoint, data, function(err, responseCode, responseData) {
    //...
})

// HTTP PUT
snooper.api.put(endpoint, data, function(err, responseCode, responseData) {
    //...
})

// HTTP DELETE
snooper.api.delete(endpoint, data, function(err, responseCode, responseData) {
    //...
})

// gets an api token 
snooper.api.get_token(function(err, token) {
    console.log(token)
})

```

*Note: new accounts get little to no posting privileges (1 comment or post per 5 minutes or more) if you dont have any karma. If you just want to play around with the api I recommend using an active account.*


### basic api usage

check how much karma your bot has
``` js
snooper.api.get('api/v1/me/karma', {}, function(err, statusCode, data) {
    console.log("I have " + data.karma + " karma")
})
```

post a comment
``` js
snooper.api.post("/api/comment", {
    api_type: "json",
    text:     "Hello World"
    thing_id: comment.data.name
}, function (err, statusCode, data) {
    if (!err) console.log('just replied to comment: ' + comment.data.name)
})

```


I highly doubt your bot is over 18 years of age
``` js
snooper.api.patch('/api/v1/me/prefs/', {
    over_18: false
}, function(err, statusCode, data) {

})
```

activate turbo mode doubling performance       (kidding)
``` js
snooper.api.post('api/v1/gold/give', {
    months: 1,
    username: 'juicypasta'
}, function(err, statusCode, data) {

})

```


## Coming Soon
- Support for multiple accounts
- Convenience methods for commonly used api requests
- Object model for api items (User, Subreddit, Post, Comment, etc.)
- Watchers for **everything**
    - private messages
    - replies
    - new post reaching the front page (configurable to different pages/ # of pages)

