const watcher = require('../watcher')();
const EventEmitter = require('events').EventEmitter;
const should = require('should');

/*
describe('RedditWatcher', () => {

  it('RedditWatcher should exist', () => should.exist(RedditWatcher));

  let emitter = RedditWatcher.getEmitter();

  it('should be able to get the emitter', () => {
    should.exist(emitter);
    emitter.should.be.an.instanceof(EventEmitter);
    emitter.on.should.be.a.Function();
  });
  
  
})
*/


/*
get_api("user/juicypasta/comments", {type:'links', limit: 1}, function(err, data) {
    //console.log(data)
    console.log(JSON.parse(data).data.children.length) // THIS SHOULD BE 1
})

post_api("api/search_reddit_names", {exact:true, query:'wallstreetbets'}, function(err, data) {
    console.log(data)
    //data.names.should.be("wallstreetbets")
}) 

get_comments('wallstreetbets', 914, function(err, data) {
    //console.log(err)
    //console.log(data.length) // SHOULD BE 914
})

get_comments_after_time("wallstreetbets", 1000, Date.now()/1000 - 100, function(err, comments) {
    console.log(err)
    console.log(comments.length)
    comments.map(function(data) {
        console.log(data.data.id)
    })
})

get_comments_until_id("wallstreetbets", 1000, "dh7vz0r", function(err, comments) {
    console.log(err)
    console.log(comments.length)
    comments.map(function(data) {
        console.log(data.data.id)
    })
})
*/


/*
function _concurrent_comment_emitter(subreddit, first_call, wait_interval, most_recent_name, stop_at_name, cb, cb_first_item) {
    console.log('requesting before: ' + most_recent_name)
    var terminated = false
    request({
        url: 'http://reddit.com/r/new/comments.json',
        qs: { before: most_recent_name }
    }, function (err, res, body_json) {
        if (err) return cb(err)
        var body = JSON.parse(body_json)
        var children = body.data.children
        if (children.length > 0) {
            if (!most_recent_name) {
                cb_first_item(children[children.length-1].data.name)
            }
            most_recent_name = children[0].data.name
            // first call is a boolean that says if the helper method called this function
            if (!first_call) {
                for (var i = 0; i < children.length; i++) {
                    if (children[i].data.name == stop_at_name) {
                        console.log("slicing")
                        children = children.slice(i+1, children.length)
                        // WERE DONE STOP
                        terminated = true
                    }
                }
                children.map(function(comment) {
                    cb(null, comment)
                })
            }
        } else {
            // this could mean 2 things.......
            terminated = true
        }
        //wait_interval += body.data.children.length > 0 ? -100 : 100
        //wait_interval = wait_interval < 5000 ? 5000 : wait_interval
        // if the wait_interval gets too far in the negative, we need to start another _comment_emitter thread so we dont get too 
        // far behind reddit bc they stop supporting the before query after a certain amount of time
        // the current thread needs to stop where the new thread stops. 
        if (wait_interval < -500) {
            //start new comment_emitter, get the first item it reads and set the current threads stop time to that
            // 
        }
        console.log('==== ' + wait_interval)
        console.log('==== ' + body.data.children.length)
        setTimeout(function() {
            _comment_emitter(subreddit, wait_interval, most_recent_name, stop_at_name, cb)
        }, wait_interval)
    })
}
function comment_emitter(subreddit, cb) {
    _comment_emitter(subreddit, 0, null, cb)
}
comment_emitter("all", function(err, comment) {
    console.log(comment.data.id)
})
*/


