const request = require('request')
const fs = require('fs')

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
