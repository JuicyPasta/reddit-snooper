# Reddit-Snooper - Simplified Reddit bot framework for Nodejs

[![npm package](https://nodei.co/npm/reddit-snooper.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/reddit-snooper/)

[![Build Status](https://travis-ci.org/JuicyPasta/reddit-snooper.svg?branch=master)](https://travis-ci.org/JuicyPasta/reddit-snooper)
[![dependencies Status](https://david-dm.org/JuicyPasta/reddit-snooper/status.svg)](https://david-dm.org/JuicyPasta/reddit-snooper)
[![Gitter](https://badges.gitter.im/reddit-snooper-nodjs/Lobby.svg)](https://gitter.im/reddit-snooper-nodjs/Lobby?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=body_badge)

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
- new posts reaching the first x pages of different listings (hot, top_24, top_day, controversial, rising) across the website or subreddit

There are 4 types of watchers: 
1. snooper.watcher.getCommentWatcher(subreddit or 'all') // emits events when a comment is posted
2. snooper.watcher.getPostWatcher(subreddit or 'all') // emits an event when a post is made
3. snooper.watcher.getGildedWatcher(subreddit or 'all') // emits an event as soon as something gets gilded
3. snooper.watcher.getListingWatcher(subreddit or 'all', options) // watches a listing and emits an event if something changes (a new post reaches the front page)
    - options: object
        - listing: 'hot', 'rising', 'controversial', 'top_day', 'top_hour', 'top_month', 'top_year', 'top_all'
        - limit: how many of the top posts you want to watch, if any of these spots get overtaken by a new post an event will be emitted

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

snooper.watcher.getGilded('all')
.on('item', function(err, data) {
    
... coming soon
})

```

#### download all gifs that make it to the front 2 pages of hot on r/gifs
``` js
// NOTICE THIS IS DIFFERENT THAT JUST DOWNLOADING THE FIRST 2 PAGES

snooper.watcher.getListingWatcher('gifs', {
    listing: 'top_day',
    limit: 4 // 2 pages
})
.on('item', function(post) { // post will be a json object containing all post information
    // ONLY NON STICKIED POSTS
    let urlmatch = post.data.url.match('\.([a-zA-Z]+$)')
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

snooper.api.get(endpoint, data, function(err, responseCode, responseData) {
        err // any errors that occurred in the api request
        responseCode // http status code of the api request
        responseData // json data of the api response
    })
    
snooper.api.post(same as get)
snooper.api.patch(same as get)
snooper.api.put(same as get)
snooper.api.delete(same as get)


// gets an api token 
snooper.api.get_token(function(err, token) {
    console.log(token)
})

```

*Note: new accounts get little to no posting privileges (1 comment or post per 5 minutes or more) if you dont have any karma. If you just want to play around with the api I recommend using an active account.*


### basic api usage
``` js
// check how much karma your bot has
snooper.api.get('api/v1/me/karma', {}, function(err, statusCode, data) {
    console.log("I have " + data.karma + " karma")
})

// I highly doubt your bot is over 18 years of age
snooper.api.patch('/api/v1/me/prefs/', {
    over_18: false
}, function(err, statusCode, data) {

})

// activate turbo mode doubling performance       (kidding)
snooper.api.post('api/v1/gold/give', {
    months: 1,
    username: 'juicypasta'
}, function(err, statusCode, data) {

})

```

### Debugging 
**DISCLAIMER:** I have not tested every single endpoint so there is a chance that something might not work, if this happens you can open up an issue(/ message me), or send the request manually using a token from get_token method.

If you choose latter option I recommend using something like postman to verify you are sending the request correctly. After you know how the endpoint works, you can use the get_token method to send your own request, just remember to put the token in the 'Authentication' header. 

#### sending a request 'manually' using the [request](https://www.npmjs.com/package/request) library
``` js
snooper.api.get_token(function (err, token) {
    //console.log(token)
    if (err) console.error(err)

    request({
        url:     endpoint, // put the desired endpoint here
        method:  method, // HTTP method ("GET", "POST", "PATCH"...
        headers: {
            "Authorization": token,
            "User-Agent":    "Snooper/1.0"
        },
        data: { // !!! this might be called data, body, or qs depending on the request type, check the request documentation
            key: value,
            ...
            
        }
    }, function (err, res, body_json) {
        http response
    }
```




## Coming Soon
- Support for multiple accounts
- Convenience methods for commonly used api requests
- Object model for api items (User, Subreddit, Post, Comment, etc.)
- Watchers for **everything**
    - private messages
    - replies
    - new post reaching the front page (configurable to different pages/ # of pages)

