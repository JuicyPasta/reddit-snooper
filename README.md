# snooper [![Build Status](https://travis-ci.org/JuicyPasta/Snooper.svg?branch=master)](https://travis-ci.org/JuicyPasta/Snooper)

Reddit bot framework that allows you to easily create high performance reddit bots with nodejs. 

## Installing snooper
``` bash
npm install snooper --save
```

## Library usage
``` js
var Snooper = require('snooper')
    snooper = new Snooper(
        {
            username: 'reddit_username',
            password: 'reddit password',
            app_id: 'reddit api app id',
            api_secret: 'reddit api secret',
            user_agent: 'OPTIONAL user agent for your bot'
        })
```

## Reddit Watcher

#### example unexpected factorial bot
``` js
var commentWatcher = snooper.watcher.getCommentWatcher('all')
    .on('comment', function(comment) {
        let match = comment.data.body.match('[0-9]+!')
        if (match) {
            snooper.api.post('/api/comment', {
                api_type:'json',
                text: match[0] + " = " + factorial(+match[0].substring(0, match.length-1)),
                thing_id: comment.data.name,
            }, function(err, statusCode, data) {
                if (!err) console.log("just replied to" + comment.data.author)
            })
        }
    })
    .on('error', console.err)

// when you are done 
commentWatcher.close()
```

#### download all gifs from r/gifs with over 100 upvotes
``` js
var postWatcher = snooper.getPostWatcher('gifs')
    .on('post', function(post) {
        // post is a text post with over 100 upvotes 
        if (post.kind == 't3' && post.data.ups > 100) {
            // download from data.preview.images.source
        }

    })
    .on('error', console.err)
```


## Reddit API

Snooper handles Reddit response codes, rate limit throttling and retries

[Reddit API Documentation](https://www.reddit.com/dev/api/)

#### basic api usage
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

// activate turbo mode which doubles overall performance       (kidding)
snooper.api.post('api/v1/gold/give', {
    months: 1,
    username: 'juicypasta'
}, function(err, statusCode, data) {

})

```