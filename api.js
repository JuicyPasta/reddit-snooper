'use strict'


module.exports = function(options) {

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
function _post_api(endpoint, data, cb) {
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

function _get_api(endpoint, data, cb) {
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

let post = retry_wrapper(4, _post_api)
let get = retry_wrapper(4, _get_api)


// API 
return {
    get,
    post,
    //patch,
}

}