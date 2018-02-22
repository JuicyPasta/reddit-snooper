// downloads everything that makes it to the first 2 pages of today's top posts on r/gifs
// REDDIT_APP_ID=... REDDIT_APP_SECRET=... node examples/top-gif-watcher.ts

import fs from "node:fs"
import {Snooper} from "../src/index.ts" // in your project: from "reddit-snooper"

// watchers only need appId + appSecret (no username/password), reddit blocks most logged out traffic now
const snooper = new Snooper({
    auth:      {appId: process.env.REDDIT_APP_ID!, appSecret: process.env.REDDIT_APP_SECRET!},
    userAgent: "node:my-gif-bot:v1.0.0 (by /u/your_username)"
})

fs.mkdirSync("gifs", {recursive: true})

// this is different than just downloading the front 2 pages since it also triggers when the front 2 pages change
snooper.watch.listing("gifs", {sort: "top", time: "day", limit: 50})
    .on("item", (post) => {
        // ONLY NON STICKIED POSTS
        const urlmatch = post.data.url.match(/\.([a-zA-Z0-9]+)$/)
        if (!post.data.stickied && urlmatch) {
            download(post.data.url, "./gifs/" + post.data.title.replace(/[^\w\- ]/g, "") + urlmatch[0])
        }
    })
    .on("error", console.error)

function download(url: string, file: string): void {
    fetch(url)
        .then((res) => res.arrayBuffer())
        .then((data) => fs.writeFileSync(file, Buffer.from(data)))
        .catch(console.error)
}
