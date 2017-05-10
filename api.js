'use strict'
const request = require('request')
const url = require('url')

module.exports = function(snooper_options) {


class ApiWrapper {
    constructor(snooper_options) {
        this.period_time = 60
        this.requests_per_period = 60

        this.requests_left = this.requests_per_period
        this.request_queue = []

        this.pipeline_running = false
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

    start_request_pipeline() {
        let self = this
        setTimeout(function() {
            self.requests_left = self.requests_per_period
            // use things left in the queue
            // TODO: space out the requests here
            while (self.requests_left > 0 && self.request_queue.length > 0) {
                // pop 60 off the stack 
                self.request_queue.shift()()
            }
            self.start_request_pipeline()
        }, self.period_time)
    }

    // executes requests at a rate that does not exceed reddit's rate limits
    schedule_request(api_request, high_priority) {
        let self = this

        if (!this.pipeline_running)
            self.start_request_pipeline()

        if (this.requests_left > 0) {
            console.log(this.requests_left + ' executing')
            // execute request
            api_request()

            this.requests_left -= 1
        } else {
            console.log(this.requests_left + ' waiting')
            if (high_priority) {
                self.request_queue.unshift(api_request)
            } else {
                self.request_queue.push(api_request)
            }
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