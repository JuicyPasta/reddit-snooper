// downloads every image posted to r/pics
// REDDIT_APP_ID=... REDDIT_APP_SECRET=... node examples/new-pic-downloader.ts

import fs from "node:fs"
import {Snooper} from "../src/index.ts" // in your project: from "reddit-snooper"

// watchers only need appId + appSecret (no username/password), reddit blocks most logged out traffic now
const snooper = new Snooper({
    auth:      {appId: process.env.REDDIT_APP_ID!, appSecret: process.env.REDDIT_APP_SECRET!},
    userAgent: "node:my-pic-bot:v1.0.0 (by /u/your_username)"
})

fs.mkdirSync("pics", {recursive: true})

// ctrl+c stops the watcher, the for await loop just ends
const stop = new AbortController()
process.once("SIGINT", () => stop.abort())

// start watching for new posts to r/pics
for await (const post of snooper.watch.posts("pics", {signal: stop.signal})) {
    // make sure there is an image link
    const urlmatch = post.data.url.match(/\.([a-zA-Z]+)$/)
    if (!post.data.is_self && urlmatch) {
        await download(post.data.url, "pics/" + post.data.title.replace(/[^\w\- ]/g, "") + urlmatch[0])
    }
}

async function download(url: string, file: string): Promise<void> {
    try {
        const res = await fetch(url)
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    } catch (err) {
        console.error(err)
    }
}
