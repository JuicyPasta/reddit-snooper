// replies to any comment on reddit with a factorial in it
// REDDIT_APP_ID=... REDDIT_APP_SECRET=... REDDIT_USERNAME=... REDDIT_PASSWORD=... node examples/unexpected-factorial.ts

import {RateLimitError, Snooper} from "../src/index.ts" // in your project: from "reddit-snooper"

const snooper = new Snooper({
    // posting needs a 'script' app logged in as your bot
    auth: {
        appId:     process.env.REDDIT_APP_ID!,
        appSecret: process.env.REDDIT_APP_SECRET!,
        username:  process.env.REDDIT_USERNAME!,
        password:  process.env.REDDIT_PASSWORD!
    },
    userAgent: "node:unexpected-factorial:v2.0.0 (by /u/your_username)",

    // waits out 'you are doing this too much' (new accounts get 1 comment every 10ish minutes)
    // instead of throwing a RateLimitError
    retryRateLimitedActions: true,

    // the sitewide comment watcher needs ~70 of reddit's 100 a minute, your replies go first
    requestsPerMinute: 90
})

function factorial(n: number): bigint {
    let j = 1n
    for (let i = 2n; i <= BigInt(n); i++) j *= i
    return j
}

const watcher = snooper.watch.comments("all") // every comment on the website, oldest first
watcher.on("warning", (warning) => console.warn(warning.message))

for await (const comment of watcher) {
    // only reply if the comment contains a factorial (and isnt a huge one)
    const match = comment.data.body.match(/\b([0-9]{1,3})!/)
    if (!match) continue

    console.log(comment.data.author + " posted " + comment.data.body)

    // not awaited so the watcher keeps going while a reply waits out reddit's rate limit
    snooper.api.post("/api/comment", {
        api_type: "json",
        text:     match[0] + " = " + factorial(Number(match[1])),
        thing_id: comment.data.name
    }).then(
        () => console.log("just replied to comment: " + comment.data.name),
        (err) => console.error(err instanceof RateLimitError ? "rate limited, skipping" : err)
    )
}
