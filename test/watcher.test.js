"use strict"

const should = require("should")
const Snooper = require("../reddit-snooper")
const {mock_reddit, listing, no_throttle} = require("./support/mock-reddit")

// snooper pointed at the fake reddit, logged out unless creds are passed
function test_snooper(reddit, extra) {
    let snooper = Snooper(Object.assign({endpoints: reddit.endpoints}, extra))
    no_throttle(snooper.api)
    return snooper
}

describe("Watcher", function () {
    this.timeout(10000)

    let reddit
    afterEach((done) => reddit ? reddit.close(done) : done())

    it("post watcher skips whats already there and emits new posts", (done) => {
        mock_reddit((req, n) => {
            req.url.pathname.should.equal("/r/node/new.json")
            if (n === 1) return {body: listing("t3", [100])}
            return {body: listing("t3", [103, 102, 101, 100, 99])}
        }, null, (r) => {
            reddit = r
            let seen = []
            let watcher = test_snooper(reddit).watcher.getPostWatcher("node", {wait_interval: 10})
                .on("post", (post) => {
                    seen.push(post.data.name)
                    if (seen.length === 3) {
                        setTimeout(() => {
                            watcher.close()
                            seen.should.eql(["t3_2v", "t3_2u", "t3_2t"]) // 103, 102, 101 newest first
                            reddit.www.requests[0].url.searchParams.get("limit").should.equal("1")
                            done()
                        }, 50)
                    }
                })
                .on("error", done)
        })
    })

    it("keeps going when the last post it saw gets deleted", (done) => {
        mock_reddit((req, n) => {
            if (n === 1) return {body: listing("t3", [100])}
            if (n === 2) return {body: listing("t3", [102, 101, 99, 98])} // 100 is gone
            return {body: listing("t3", [104, 102, 101, 99])} // and 103 got removed before we saw it
        }, null, (r) => {
            reddit = r
            let seen = []
            let watcher = test_snooper(reddit).watcher.getPostWatcher("node", {wait_interval: 10})
                .on("post", (post) => {
                    seen.push(parseInt(post.data.id, 36))
                    if (seen.length === 3) {
                        setTimeout(() => {
                            watcher.close()
                            seen.should.eql([102, 101, 104])
                            done()
                        }, 50)
                    }
                })
                .on("error", done)
        })
    })

    it("pages back when more than one page of comments came in", (done) => {
        let page1 = []
        for (let i = 300; i > 200; i--) page1.push(i)
        let page2 = [200, 199, 198, 150, 149]

        mock_reddit((req, n) => {
            req.url.pathname.should.equal("/r/all/comments.json")
            if (n === 1) return {body: listing("t1", [150])}
            if (req.url.searchParams.get("after") === "t1_" + (201).toString(36)) return {body: listing("t1", page2, "t1_" + (149).toString(36))}
            return {body: listing("t1", page1, "t1_" + (201).toString(36))}
        }, null, (r) => {
            reddit = r
            let count = 0
            let watcher = test_snooper(reddit).watcher.getCommentWatcher("", {wait_interval: 10}) // blank is all of reddit
                .on("comment", () => {
                    if (++count === 103) {
                        setTimeout(() => {
                            watcher.close()
                            count.should.equal(103) // 300..201 plus 200, 199, 198
                            done()
                        }, 50)
                    }
                })
                .on("error", done)
        })
    })

    it("listing watcher emits whats on the listing then only new stuff", (done) => {
        mock_reddit((req, n) => {
            req.url.pathname.should.equal("/r/gifs/top.json")
            req.url.searchParams.get("t").should.equal("week")
            if (n === 1) return {body: listing("t3", [5, 4, 3])}
            return {body: listing("t3", [5, 9, 4])}
        }, null, (r) => {
            reddit = r
            let seen = []
            let watcher = test_snooper(reddit).watcher.getListingWatcher("gifs", {listing: "top_week", limit: 3, wait_interval: 10})
                .on("item", (item) => {
                    seen.push(parseInt(item.data.id, 36))
                    if (seen.length === 4) {
                        setTimeout(() => {
                            watcher.close()
                            seen.should.eql([5, 4, 3, 9])
                            done()
                        }, 50)
                    }
                })
                .on("error", done)
        })
    })

    it("listing watcher doesnt complain when a listing is short", (done) => {
        mock_reddit(() => ({body: listing("t3", [2, 1])}), null, (r) => {
            reddit = r
            let seen = 0
            let watcher = test_snooper(reddit).watcher.getListingWatcher("tinysub", {listing: "top_hour", limit: 50, wait_interval: 10})
                .on("item", () => {
                    if (++seen === 2) {
                        setTimeout(() => {
                            watcher.close()
                            done()
                        }, 50)
                    }
                })
                .on("error", done)
        })
    })

    it("emits an error instead of crashing when the subreddit doesnt exist", (done) => {
        mock_reddit(() => ({status: 404, body: {reason: "banned", message: "Not Found", error: 404}}), null, (r) => {
            reddit = r
            let watcher = test_snooper(reddit).watcher.getCommentWatcher("deletedsub")
                .on("comment", () => done(new Error("should not get comments")))
                .on("error", (err) => {
                    watcher.close()
                    err.should.match(/r\/deletedsub\/comments doesn't exist \(banned\)/)
                    done()
                })
        })
    })

    it("treats reddit's redirect to search as a missing subreddit", (done) => {
        mock_reddit(() => ({status: 302, headers: {location: "/subreddits/search.json?q=nope"}, body: ""}), null, (r) => {
            reddit = r
            let watcher = test_snooper(reddit).watcher.getPostWatcher("nope")
                .on("post", () => {})
                .on("error", (err) => {
                    watcher.close()
                    err.should.match(/doesn't exist/)
                    reddit.www.requests.length.should.equal(1) // didnt follow it
                    done()
                })
        })
    })

    it("says to use credentials when reddit blocks logged out requests", (done) => {
        mock_reddit(() => ({status: 403, headers: {"content-type": "text/html"}, body: "<body>You've been blocked by network security.</body>"}), null, (r) => {
            reddit = r
            let watcher = test_snooper(reddit).watcher.getPostWatcher("pics")
                .on("post", () => {})
                .on("error", (err) => {
                    watcher.close()
                    err.should.match(/app_id and api_secret/)
                    done()
                })
        })
    })

    it("goes through oauth.reddit.com with a token when it has credentials", (done) => {
        mock_reddit(
            () => ({body: {access_token: "watchertoken", token_type: "bearer", expires_in: 3600}}),
            (req, n) => {
                req.url.pathname.should.equal("/user/juicypasta/m/bots/new")
                req.headers.authorization.should.equal("bearer watchertoken")
                return {body: listing("t3", n === 1 ? [10] : [11, 10])}
            }, (r) => {
                reddit = r
                let snooper = test_snooper(reddit, {app_id: "id", api_secret: "secret"})
                let watcher = snooper.watcher.getMultiWatcher("juicypasta", "bots", {wait_interval: 10})
                    .on("post", (post) => {
                        watcher.close()
                        post.data.name.should.equal("t3_b")
                        new URLSearchParams(reddit.www.requests[0].body).get("grant_type").should.equal("client_credentials")
                        done()
                    })
                    .on("error", done)
            })
    })

    it("lets you attach the error listener first", (done) => {
        mock_reddit(() => ({body: listing("t3", [1])}), null, (r) => {
            reddit = r
            let watcher = test_snooper(reddit).watcher.getPostWatcher("pics");
            (() => watcher.on("error", () => {}).on("post", () => {})).should.not.throw()
            watcher.close()
            done()
        })
    })

    it("still yells about event names that dont exist", () => {
        reddit = null
        let watcher = Snooper().watcher.getPostWatcher("pics");
        (() => watcher.on("comment", () => {})).should.throw(/event type not recognized/)
        watcher.close()
    })

    it("cleans up subreddit names", () => {
        reddit = null
        let watcher = Snooper().watcher
        watcher.getPostWatcher("/r/pics").start_page.should.equal("r/pics/new")
        watcher.getPostWatcher("r/pics/").start_page.should.equal("r/pics/new")
        watcher.getPostWatcher("pics+gifs").start_page.should.equal("r/pics+gifs/new")
        watcher.getCommentWatcher().start_page.should.equal("r/all/comments")
        watcher.getListingWatcher("", {listing: "rising"}).start_page.should.equal("rising")
        watcher.getListingWatcher("all").start_page.should.equal("r/all/hot")
    })

    it("rejects bad listing types and the gilded watcher", () => {
        reddit = null
        let watcher = Snooper().watcher;
        (() => watcher.getListingWatcher("pics", {listing: "top_24"})).should.throw(/invalid listing type/);
        (() => watcher.getGildedWatcher("all")).should.throw(/gold/)
    })
})
