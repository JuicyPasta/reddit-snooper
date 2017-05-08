# snooper
Reddit bot framework for node.js

## Installing snooper reddit bot
``` bash
npm install snooper --save
```

## api overview

-snooper.watcher.CommentWatcher
    -event: 'comment'
    -watcher.close()

-snooper.watcher.PostWatcher
    -event: 'post'
    -watcher.close()

// handles retries and error checking
-snooper.api.get()
-snooper.api.post()


## Library usage
``` js
var Snooper = require('snooper')
    snooper = new Snooper(
        {
            username: 'reddit_username',
            password: 'reddit password',
            app_id: 'reddit api app id',
            api_secret: 'reddit api secret',
            user_agent: 'OPTIONAL user agent for your script'
        })
```

## Reddit Watcher

example unexpected factorial bot
``` js
var commentWatcher = new snooper.watcher.CommentWatcher('all')
    .on('comment', function(comment) {
        console.log(comment.data.id)
    })
    .on('error', console.err)

// when you are done 
commentWatcher.close()
```

download all gifs from r/gifs with over 100 upvotes
``` js
var postWatcher = new snooper.PostWatcher('gifs')
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

``` js
// check how much karma your bot has
snooper.api.get('api/v1/me/karma', {}, function(err, data) {
    console.log("I have " + data.karma + " karma")
})

// I highly doubt your bot is over 18 years of age
snooper.api.patch("/api/v1/me/prefs/', {
    over_18: false
}, function(err, data) {

})

// activate turbo mode which doubles overall performance       (kidding)
snooper.api.post('api/v1/gold/give', {
    months: 1,
    username: 'juicypasta'
}, function(err, data) {

})

```