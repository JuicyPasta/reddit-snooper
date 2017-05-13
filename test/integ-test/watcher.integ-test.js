const EventEmitter = require('events').EventEmitter;
const should = require('should');

const credentials = require('../../secrets/reddit-credentials')
const Snooper = require('../../reddit-snooper')
const snooper = Snooper(credentials)


/*
describe("Comment Watcher", function() {
    describe("Recieving All Comments", function() {
        let comments_recieved = []
        let comments_recieved_map = {}
        let counter = 0

        let comment_watcher = snooper.watcher.getCommentWatcher('all')
                .on('comment', function(comment) {
                    comments_recieved.push(comment.data.name)
                    comments_recieved_map[comment.data.name] = true
                }).on('error', function(err) {
                    console.log(err)
                })
        
        it("creates a new comment watcher", function() {
            should.exist(comment_watcher)
        })

        it("reads all comments that are not removed", function(done) {
            this.timeout(30000) // so mocha doesnt timeout after 2s

            setTimeout(function() {
                comments_recieved.length.should.be.above(26)

                comment_watcher.close()
                comments_recieved = comments_recieved.sort()

                let first_comment = comments_recieved[0]
                let last_comment = comments_recieved[comments_recieved.length-1]

                let missing_comments = []
                for (var i = parseInt(first_comment, 36); i < parseInt(last_comment, 36); i++) {
                    let curr = i.toString(36)
                    if (!(curr in comments_recieved_map)) {
                        missing_comments.push(curr)
                    }
                }

                missing_comments.length.should.be.equal(0)
                snooper.api.get('api/info', {
                    id: missing_comments.join(','), //missing_comments
                }, function(err, responseCode, data) {
                    should(err).not.be.ok()
                    for (let child_idx in data.data.children) {
                        console.log(data.data.children[child_idx])
                    }

                    done()
                })

            }, 20000)

        })
    })

})
*/