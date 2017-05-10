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


snooper.watcher.getCommentWatcher('all') // looks in a specific subreddit, in this case 'all' were looking at comments posted anywhere on the website
    .on('comment', function(comment) {
        console.log(comment.data.id)
        // only reply if the comment contains a factorial
        let match = comment.data.body.match('[0-9]+!')
        if (match && comment.data.author == 'juicypasta') {
            console.log('found match ' + comment.data.author)
            // post a reply
            snooper.api.post('/api/comment', {
                api_type:'json',
                text: match[0] + " = " + factorial(+match[0].substring(0, match.length-1)),
                thing_id: comment.data.name,
            }, function(err, statusCode, data) {
                console.log(err)
                console.log(data)
            })
        }
    })
    .on('error', console.error)

    

function factorial (n){
  j = 1
  for(i=1;i<=n;i++) j = j*i
  return j
}