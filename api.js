'use strict'
const request = require('request')
const url = require('url')

module.exports = function(snooper_options) {


class ApiWrapper {
    constructor(snooper_options) {
        this.requests_per_minuite = 60
        this.ms_between_requests = (1000*60) / this.requests_per_minuite
        this.last_request = 0
        this.request_queue = []

    }

    // Retrieve OAUTH Token (tokens work for 1 hour each)
    // TODO: add retry logic
    get_token(cb) {
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

    // ratelimit requests
    schedule_request(api_request, high_priority) {
        let self = this

        let time_diff = Date.now() - this.last_request
        if (time_diff >= self.ms_between_requests) {
            api_request()
            self.last_request = Date.now()
        } else {
            let wait_time = self.ms_between_requests - time_diff
            console.log('wait time ' + wait_time)
            setTimeout(api_request, wait_time)

            self.last_request = Date.now() + wait_time

        }
    }

    construct_url(path) {
        let default_endpoint = 'https://www.reddit.com/'
        let oauth_endpoint = 'https://oauth.reddit.com/'

        //if (path.indexOf('api') > -1) {

            return (new url.URL(path, oauth_endpoint)).toString()
        //} else {
        //   return (new url.URL(path+'.json', default_endpoint)).toString()
        //}
    }

    generic_api_call(endpoint, method, data, retries_left, cb) {
        let self = this
        self.schedule_request(function() {

            self.get_token(function (err, token) {
                //console.log(token)
                if (err) {
                    cb(err)
                }
                // data.raw_json = 1 // dont replace json objects with html escaped <, > and &
                let request_options = {
                    url: endpoint,
                    method: method,
                    headers: { 
                        'Authorization': token, 
                        'User-Agent': snooper_options.user_agent 
                    },
                }
                if (method === "GET") {
                    request_options.qs = data
                } else if (method === "PATCH" || method === "PUT") {
                    request_options.body = data
                    request_options.json = true
                } else if (method === "POST") {
                    request_options.form = data
                }

                request(request_options, function(err, res, body_json) {
                    // console.log(res)
                    if (err) {
                        console.log(err)
                        cb(err)    
                    }

                    // dont parse if its already an object
                    let body = (typeof body_json == 'string') ? JSON.parse(body_json) : body_json

                    // rate limit info - oauth2 clients get 60 requests / minuite 
                    let ratelimit_used = res.headers['x-ratelimit-used'] // used during period 
                    let ratelimit_remaining = res.headers['x-ratelimit-remaining'] // remaining requests in period
                    let ratelimit_reset = res.headers['x-ratelimit-reset'] // time until end of period

                    console.log('ratelimit remaining:' +  ratelimit_remaining + ' reset:' + ratelimit_reset + ' used:' + ratelimit_used)

                    let status_class = Math.floor(res.statusCode/100)

                    switch(status_class) {
                        case 1: // information
                            cb(null, res.statusCode, body)
                            break;

                        case 2: // success
                            // well is it a success...
                            if (body && body.json && body.json.ratelimit) {
                                cb("you are doing this too much, try again in: " + body.json.ratelimit + " seconds", res.statusCode, body)
                            } else {
                                cb(null, res.statusCode, body)
                            }
                            break;

                        case 3: // redirection
                            cb(null, res.statusCode, body)
                            break;

                        case 4: // client error
                            cb(null, res.statusCode, body)
                            break;

                        case 5: // server error (retryable)
                            console.log("encountered retryable error")
                            if (retries_left > 0) {
                                self.schedule_request(function() {
                                    self.generic_api_call(endpoint, method, data, retries_left -1, cb)
                                })
                            } else {
                                cb(null, res.statusCode, body)
                            }
                            break;

                        default:
                            cb("what happened", res.statusCode, body)
                    }

                })
            })
        })
    }

    get(endpoint, data, cb) {
        this.generic_api_call(this.construct_url(endpoint), "GET", data, 4, cb)
    }
    post(endpoint, data, cb) {
        this.generic_api_call(this.construct_url(endpoint), "POST", data, 4, cb)
    }
    patch(endpoint, data, cb) {
        this.generic_api_call(this.construct_url(endpoint), "PATCH", data, 4, cb)
    }
    put(endpoint, data, cb) {
        this.generic_api_call(this.construct_url(endpoint), "PUT", data, 4, cb)
    }
    del(endpoint, data, cb) {
        this.generic_api_call(this.construct_url(endpoint), "DELETE", data, 4, cb)
    }
}


return new ApiWrapper()
}