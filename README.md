# snooper [![Build Status](https://travis-ci.org/JuicyPasta/snooper.svg?branch=master)](https://travis-ci.org/JuicyPasta/Snooper)

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
            // credential information is not needed for snooper.watcher
            username: 'reddit_username',
            password: 'reddit password',
            app_id: 'reddit api app id',
            api_secret: 'reddit api secret',
            user_agent: 'OPTIONAL user agent for your bot'
        })
```

## Reddit Watcher

#### unexpected factorial bot
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

Snooper by default handles retries, rate limit throttling conditions and Reddit's different response codes. 

Keep in mind that new accounts get little to no posting privelages (1 comment or post per 5 minutes or more) if you dont have any karma. If you just want to play around with the api I recommend using an active account. 

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

## API setup 

All you need to do to get up and running is obtain an api_id and an api_secret. Both can be obtained from [Reddit app console](https://reddit.com/prefs/apps)
1. Create (or log into) a reddit account
2. Navigate to the [authorized applications console](https://reddit.com/prefs/apps)
3. Select 'create another app...' at the bottom
4. Fill in the name, description and click on 'script', put in anything for the redirect uri, its not needed and you can change it later if you want to
5. Copy down the 'secret' that is your api_secret, the 14 character string by the name of your app is your app_id
6. Use these values and your credentials to configure the library


## Coming Soon
- Support for multiple accounts