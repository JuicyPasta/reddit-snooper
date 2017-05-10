'use strict'

const credentials = require("../secrets/reddit-credentials")

const Snooper = require("../reddit-snooper"),
    snooper = new Snooper(credentials)
/**
 * snooper = new Snooper(
 * {
 * username: 'reddit_username',
 * password: 'reddit password',
 * app_id: 'reddit api app id',
 * api_secret: 'reddit api secret',
 * user_agent: 'OPTIONAL user agent for your script',
 *
 * automatic_retries: true, // automatically handles condition when reddit says 'you are doing this too much'
 *
 *  })
 */

// looks in a specific subreddit, in this case 'all' were looking at comments
// posted anywhere on the website
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


function factorial(n) {
    let j = 1
    for (let i = 1; i <= n; i++) j = j * i
    return j
}