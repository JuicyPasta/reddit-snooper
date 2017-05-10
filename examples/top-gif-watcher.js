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
snooper.watcher.getListingWatcher('all', {
    listing: 'rising',
    limit: 5
})
.on('item', function(post) { // post will be a json object containing all post information
    console.log(post.data.name)


})
.on('error', console.error)
