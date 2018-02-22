// REDDIT_APP_ID=... REDDIT_APP_SECRET=... REDDIT_USERNAME=... REDDIT_PASSWORD=... node examples/api-usage.ts

import {ApiError, Snooper, type Listing, type Post} from "../src/index.ts" // in your project: from "reddit-snooper"

const snooper = new Snooper({
    auth: {
        appId:     process.env.REDDIT_APP_ID!,
        appSecret: process.env.REDDIT_APP_SECRET!,
        username:  process.env.REDDIT_USERNAME!,
        password:  process.env.REDDIT_PASSWORD!
    },
    userAgent: "node:my-bot:v1.0.0 (by /u/your_username)"
})

interface Karma {
    kind: "KarmaList"
    data: {sr: string, comment_karma: number, link_karma: number}[]
}

const karma = await snooper.api.get<Karma>("api/v1/me/karma")
console.log(karma.data)

// the newest 5 posts on r/node
const newest = await snooper.api.get<Listing<Post>>("r/node/new", {limit: 5})
for (const post of newest.data.children) console.log(post.data.title)

// same thing by fullname, up to 100 at a time
const [post] = await snooper.api.info<Post>(["t3_6arf2r"])
console.log(post?.data.title)

// I highly doubt your bot is over 18 years of age
await snooper.api.patch("/api/v1/me/prefs", {over_18: false})

try {
    await snooper.api.get("r/this_sub_does_not_exist_hopefully/about")
} catch (err) {
    if (err instanceof ApiError) console.log(err.status, err.message) // 404 /r/.../about doesn't exist
}
