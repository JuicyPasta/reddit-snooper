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

// notify when things reach the front 101 posts of gifs
snooper.watcher.getListingWatcher('gifs', {
    listing: 'top_day',
    limit: 101
})
.on('item', function(post) { // post will be a json object containing all post information
    console.log(post.data.name)

})
.on('error', console.error)
