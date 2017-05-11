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

// notify when things reach the front 2 pages of r/gifs that have not been stickied
snooper.watcher.getListingWatcher('gifs', {
    listing: 'top_day',
    limit: 50 // 2 pages
})
.on('item', function(post) { // post will be a json object containing all post information
    // ONLY NON STICKIED POSTS
    let urlmatch = post.data.url.match('\.([a-zA-Z]+$)')
    if (!post.data.stickied && post.kind === 't3') {
       request(post.data.url).pipe(fs.createWriteStream("./gifs/"+post.data.title.split('\"').join('')+urlmatch[0]))
    }

})
.on('error', console.error)
