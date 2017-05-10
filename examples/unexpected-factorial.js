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
 * user_agent: 'OPTIONAL user agent for your script'
 *
 *  })
 */

// looks in a specific subreddit, in this case 'all' were looking at comments
// posted anywhere on the website
snooper.watcher.getCommentWatcher("all")

.on("comment", function (comment) {
    // only reply if the comment contains a factorial
    let match = comment.data.body.match("[0-9]+!")
    if (match && comment.data.author === "juicypasta") {

        // post a reply
        snooper.api.post("/api/comment", {
            api_type: "json",
            text:     match[0] + " = " + factorial(+match[0].substring(0, match[0].length -1)),
            thing_id: comment.data.name
        }, function (err, statusCode, data) {
            console.log(err)
            console.log(data)
        })
    }
})
.on("error", console.error)



function factorial(n) {
    j = 1
    for (i = 1; i <= n; i++) j = j * i
    return j
}