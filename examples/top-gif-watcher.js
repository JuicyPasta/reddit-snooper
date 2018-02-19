const fs = require('fs')

// watchers only need app_id + api_secret (no username/password), reddit blocks most logged out traffic now
const credentials = require("../secrets/reddit-credentials")

const Snooper = require("../reddit-snooper"),
    snooper = new Snooper(credentials) // alternative way to bring in credentials (as a module)
/**
 * snooper = new Snooper(
 * {
 * app_id: 'reddit api app id',
 * api_secret: 'reddit api secret',
 * user_agent: 'node:my-gif-bot:v1.0.0 (by /u/your_username)'
 *
 *  })
 */

fs.mkdirSync("gifs", {recursive: true})

// notify when things reach the front 2 pages of r/gifs that have not been stickied
snooper.watcher.getListingWatcher('gifs', {
    listing: 'top_day',
    limit: 50 // 2 pages
})
.on('item', function(post) { // post will be a json object containing all post information
    // ONLY NON STICKIED POSTS
    let urlmatch = post.data.url.match('\.([a-zA-Z0-9]+$)')
    if (!post.data.stickied && post.kind === 't3' && urlmatch) {
        download(post.data.url, "./gifs/" + post.data.title.replace(/[^\w\- ]/g, '') + urlmatch[0])
    }

})
.on('error', console.error)

function download(url, file) {
    fetch(url)
        .then((res) => res.arrayBuffer())
        .then((data) => fs.writeFileSync(file, Buffer.from(data)))
        .catch(console.error)
}
