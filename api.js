'use strict'
var request = require('request')

module.exports = function(snooper_options) {

// Retrieve OAUTH Token (tokens work for 1 hour each)
// TODO: add retry logic
function get_token(cb) {
    request.post({
        url:'https://www.reddit.com/api/v1/access_token',
        form:{
            "grant_type": "password",
            "username": snooper_options.username,
            "password": snooper_options.password
        },
        auth:{
            'user': snooper_options.app_id,
            'pass': snooper_options.api_secret
        },
        headers: {
            'User-Agent': snooper_options.user_agent
        }
    }, function(err, res, body) {
        if (err) {
            cb(err, null)            
        }

        let token_info = JSON.parse(body)
        cb(null, token_info.token_type + ' ' + token_info.access_token)
    })
}

// assumes the last argument is a callback
// function retry_wrapper(numRetries, func, cb) {
//     return function()  {
//         func.apply(this, arguments);
//     }
// }


function construct_url(api_endpoint) {
    return "https://oauth.reddit.com/" + api_endpoint
}

function generic_api_call(endpoint, method, data, cb) {
    get_token(function (err, token) {
        if (err) {
            cb(err)
        }

        data.raw_json = 1 // dont replace json objects with html escaped <, > and &
        let request_options = {
            url: endpoint,
            method: method,
            headers: { 'Authorization': token, 'User-Agent': snooper_options.user_agent },
        }
        if (method == "GET") {
            request_options.qs = data
        } else if (method == "PATCH" || method == "PUT") {
            request_options.body = data
            request_options.json = true
        } else if (method == "POST") {
            request_options.form = data
        }

        request(request_options, function(err, res, body_json) {
            if (err) {
                cb(err)    
            }
            let body = JSON.parse(body_json)

            // rate limit info - oauth2 clients get 60 requests / minuite 
            let ratelimit_used = res.headers['x-ratelimit-used'] // used during period 
            let ratelimit_remaining = res.headers['x-ratelimit-remaining'] // remaining requests in period
            let ratelimit_reset = res.headers['x-ratelimit-reset'] // time until end of period

            if (res.statusCode/100 == 1) { // information
                cb(null, res.statusCode, body)
            } else if (res.statusCode/200 == 1) { // success
                // well is it a success...
                if (body && body.json && body.json.ratelimit) {
                    cb("you are doing this too much, try again in: " + body.json.ratelimit + " seconds", res.statusCode, body)
                } else {
                    cb(null, res.statusCode, body)
                }
            } else if (res.statusCode/300 ==1) { // redirection
                cb(null, res.statusCode, body)
            } else if (res.statusCode/400 ==1) { // client error
                cb(null, res.statusCode, body)
            } else if (res.statusCode/500 ==1) { // server error
                // retryable
                cb("internal server error", res.statusCode, body)
            }
        })
    })
}

function get(endpoint, data, cb) {
    generic_api_call(construct_url(endpoint), "GET", data, cb)
}
function post(endpoint, data, cb) {
    generic_api_call(construct_url(endpoint), "POST", data, cb)
}
function patch(endpoint, data, cb) {
    generic_api_call(construct_url(endpoint), "PATCH", data, cb)
}
function put(endpoint, data, cb) {
    generic_api_call(construct_url(endpoint), "PUT", data, cb)
}


// let get = retry_wrapper(4, _get)
// let post = retry_wrapper(4, _post)
// let patch = retry_wrapper(4, _patch)
// let put = retry_wrapper(4, _put)

// API 
return {
    get,
    post,
    patch,
    put
}

}