const fs = require('fs')

// watchers only need app_id + api_secret (no username/password), reddit blocks most logged out traffic now
const credentials = require("../secrets/reddit-credentials")

const Snooper = require("../reddit-snooper"),
    snooper = new Snooper(credentials)
/**
 * snooper = new Snooper(
 * {
 * app_id: 'reddit api app id',
 * api_secret: 'reddit api secret',
 * user_agent: 'node:my-pic-bot:v1.0.0 (by /u/your_username)'
 *
 *  })
 */

fs.mkdirSync("pics", {recursive: true})

// start watching for new posts to r/pics
snooper.watcher.getPostWatcher('pics')
.on('post', function(post) { // post will be a json object containing all post information

    // check if its a link post (t3, definitions found on reddit api page)
    // also make sure there is an image link
    let urlmatch = post.data.url.match('\.([a-zA-Z]+$)')
    if (post.kind === 't3' && urlmatch) {
        download(post.data.url, "pics/" + post.data.title.replace(/[^\w\- ]/g, '') + urlmatch[0])
    }

})
.on('error', console.error)

function download(url, file) {
    fetch(url)
        .then((res) => res.arrayBuffer())
        .then((data) => fs.writeFileSync(file, Buffer.from(data)))
        .catch(console.error)
}
