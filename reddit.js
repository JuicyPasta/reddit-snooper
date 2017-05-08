var request = require('request')
var reddit_creds = require('./secrets/reddit_credentials')
var FeedParser = require('feedparser')
 
const UserAgent = "WSBTracker/0.1"

// Retrieve OAUTH Token (tokens work for 1 hour each)
// TODO: add retry logic
function get_token(cb) {
    request.post({
        url:'https://www.reddit.com/api/v1/access_token',
        form:{
            "grant_type": "password",
            "username": reddit_creds.username,
            "password": reddit_creds.password
        },
        auth:{
            'user': reddit_creds.appId,
            'pass': reddit_creds.apiSecret
        },
        headers: {
            'User-Agent': UserAgent
        }
    }, function(err, res, body) {
        if (err) {
            cb(err, null)            
        }

        token_info = JSON.parse(body)
        cb(null, token_info.token_type + ' ' + token_info.access_token)
    })
}


// assumes the last argument is a callback
function retry_wrapper(numRetries, func) {
    return function()  {
        /* var parentCallback = arguments[arguments.length-1];
        var tempArgs = []
        for (var i = 0; i < arguments.length; i++) {
        }
        for (var i = 0; i < numRetries; i++) {
            func.apply(this, arguments)
        } */

        func.apply(this, arguments);
    }
}


/**
 * API DOCS: https://www.reddit.com/dev/api#GET_subreddits_new
 * 
 * endpoint: endpoint listed on reddit api website, ex: /api/v1/me
 * data: json data to send to the api endpoint 
 * cb(err, response)
 */
var _post_api = function(endpoint, data, cb) {
    get_token(function (err, token) {
        if (err) return cb(err)

        request.post({
            url: "https://oauth.reddit.com/" + endpoint, // API Endpoint
            headers: {
                'Authorization': token,
                'User-Agent': UserAgent
            }, 
            form: data
        }, function(err, res, body) {
            if (!err && res.statusCode == 200) {
                cb(null, body)
            } else {
                cb (err)
            }
        })
    })
}

var _get_api = function(endpoint, data, cb) {
    get_token(function (err, token) {
        if (err) return cb(err)

        request.get({
            url: "https://oauth.reddit.com/" + endpoint, // API Endpoint
            headers: {
                'Authorization': token,
                'User-Agent': UserAgent
            },
            qs: data,
        }, function(err, res, body) {
            if (!err && res.statusCode == 200) {
                cb(null, body)
            }
        })
    })
}

var post_api = retry_wrapper(4, _post_api)
var get_api = retry_wrapper(4, _get_api)




function get_comments(subreddit, num_comments, cb) {
    _get_comments(subreddit, num_comments, 0, null, null, '', [], cb)
}


// TODO: Wrap recursive function in backoff retries
/*
function _get_comments(subreddit, count_left, count, target_id, posted_after, next_page_id, comments, cb, cb_init) {
    if (count_left <= 0 && !target_id) {
        return cb(null, comments)
    } else if (count_left <= 0 && target_id) {
        return cb("Target comment name not found", comments)
    }

    request({
        url: 'http://reddit.com/r/' + subreddit + '/comments.json',
        qs: { count: count, after: next_page_id }
    }, 
    function(err, res, body_json) {
        if (err) return cb(err)

        var body_obj = JSON.parse(body_json)

        if (!next_page_id && cb_init) {
            cb_init(body_obj.data.children[0])
        }

        var comments_retrieved = body_obj.data.children
        var comments_retrieved_len = body_obj.data.children.length
        console.log(comments_retrieved_len)

        if (comments_retrieved_len <= 0) {
            return cb("Reached a page with no comments", comments)
        }

        if (comments_retrieved_len > count_left) {
            comments_retrieved_len = count_left
            comments_retrieved = comments_retrieved.slice(0, comments_retrieved_len)
        }

        // handles posted_after - only show posts that were posted after a specific time
        if (posted_after) {
            for (var i = 0; i < comments_retrieved_len; i++) {
                if (comments_retrieved[i].data.created_utc <= posted_after) {
                    // we only care about the comments before and we are done looking
                    comments_retrieved_len = i; 
                    comments_retrieved = comments_retrieved.slice(0, comments_retrieved_len)

                    // done searching but we want to handle the target_id case
                    count_left = -1;
                }
            }
        }

        // handles target_id - stops when we reach a specific comment
        if (target_id) {
            for (var i = 0; i < comments_retrieved_len; i++) {
                // found the comment we are looking up to
                if (comments_retrieved[i].data.id == target_id) {
                    // we only care about the comments before and we are done looking
                    comments_retrieved_len = i; 
                    comments_retrieved = comments_retrieved.slice(0, comments_retrieved_len)
                    return cb(null, comments.concat(comments_retrieved))
                }
            }
        }
 
        // recursive call
        _get_comments(
            subreddit, 
            count_left - comments_retrieved_len, 
            count + comments_retrieved_len, 
            target_id,
            posted_after,
            body_obj.data.after, 
            comments.concat(comments_retrieved), 
            cb)
    })
}
*/

function _get_items(page, after_name, until_name, cb, cb_first_item) {
    request({
        url: 'https://reddit.com' + page,
        qs: { after: after_name }
    }, function (err, res, body_json) {
        if (err) return cb(err)

        var body = JSON.parse(body_json)
        var children = body.data.children

        if (children.length > 0) {
            if (!after_name) {
                cb_first_item(children[0].data.name)
                //console.log(children[0].data.name + " - " + until_name)
            }

            after_name = children[children.length-1].data.name
            var is_done = false

            for (var i = 0; i < children.length; i++) {
                // found the comment we are looking up to
                if (children[i].data.name == until_name) {
                    // we only care about the comments before and we are done looking
                    children = children.slice(0, i)
                    is_done = true
                    break
                }
            }

            if (!is_done && until_name) _get_items(page, after_name, until_name, cb, cb_first_item)

            if (until_name) {
                children.map(function(comment) {
                    cb(null, comment)
                    emit('comment', comment)
                })
            } 
        } 
    })
}

function _concurrent_item_emitter(subreddit, wait_interval, until_name, cb) {
    setTimeout(function() {
        _get_items(subreddit, '', until_name, cb, function(first_comment_retrieved) {
            _concurrent_item_emitter(subreddit, wait_interval, first_comment_retrieved, cb)
        })
    }, wait_interval)
}

function comment_emitter(subreddit, cb) {
    subreddit = subreddit || 'all'
    _concurrent_item_emitter("/r/" + subreddit + "/comments.json", 0, '', cb)
}

function post_emitter(subreddit, cb) {
    subreddit = subreddit || 'all'
    _concurrent_item_emitter("/r/" + subreddit + "/new.json", 0, '', cb)
}

/*
comment_emitter('all', function(err, comment) {
    console.log(comment.data.name)
})
*/

post_emitter('all', function(err, post) {
    console.log(post.kind + ' ' + post.data.title)
})

// BASIC COMMENT EMITTER
// ONLY EMITS SINGLE COMMENTS, RUNS FOREVVERRR


/*
function concurrent_comment_emitter(subreddit, cb) {
    _concurrent_comment_emitter(subreddit, 0, cb)
}
*/




// adjust comment_dept and wait_interval to match what your hardware is capable of, 
// having a really low wait interval and high comment depth will not cause additional strain if you can handle the amount of comments a subreddit is producing

// comment_depth = 1000

// POSSIBLE ERROR: not enough bandwidth to load comments as fast as they are being posted
// you can fix this by lowering the wait_interval which will increase the degree of multiprogramming (more threads) 


//function _get_comments(subreddit, count_left, count, target_id, posted_after, next_page_id, comments, cb, cb_init) {


/*
function _concurrent_comment_emitter(subreddit, first_call, wait_interval, most_recent_name, stop_at_name, cb, cb_first_item) {
    console.log('requesting before: ' + most_recent_name)

    var terminated = false
    request({
        url: 'http://reddit.com/r/' + subreddit + '/comments.json',
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
// TESTS
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
config_options = {
    subreddit: string
    comment_threshold: integer


}
*/

// event emitter
// on....
/**
 * newComment
 * newPost
 * 
 * newTopMonth
 * newTop24
 * newTopYear
 * 
 * newHot (with page limits ex: only look at 2 pages)
 * 
 */