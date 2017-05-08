var reddit_creds = require('../secrets/reddit_credentials')

var Snooper = require('../snooper'),
    snooper = new Snooper(reddit_creds)
/*
    snooper = new Snooper(
        {
            username: 'reddit_username',
            password: 'reddit password',
            app_id: 'reddit api app id',
            api_secret: 'reddit api secret',
            user_agent: 'OPTIONAL user agent for your script'

        })
        */


new snooper.watcher.RedditWatcher('')
    .on('item', function(comment) {
        console.log('comment '+ comment.data.id)
    })
    //.on('error', console.err)

    
new snooper.watcher.RedditWatcher('https://www.reddit.com/r/all/new.json')
    .on('item', function(comment) {
        console.log('post '+ comment.data.id)
    })