"use strict"
const request = require("request")
const url = require("url")

// TODO: Implement retry wrapper and refactor out builtin retries

module.exports = function (snooper_options) {

    class ApiWrapper {
        constructor(snooper_options) {
            this.requests_per_minuite = 60
            this.ms_between_requests = (1000 * 60) / this.requests_per_minuite
            this.last_request = 0
            this.token_expiration = 0
            this.token = null
        }

        // Retrieve OAUTH Token (tokens work for 30-60 mins each)
        get_token(cb) {
            this._get_token(5, cb) // 5 retries
        }

        _get_token(retries, cb) {
            if (Date.now() / 1000 <= this.token_expiration) {
                cb(null, this.token)
            } else {
                request.post({
                    url:     "https://www.reddit.com/api/v1/access_token",
                    form:    {
                        "grant_type": "password",
                        "username":   snooper_options.username,
                        "password":   snooper_options.password
                    },
                    auth:    {
                        "user": snooper_options.app_id,
                        "pass": snooper_options.api_secret
                    },
                    headers: {
                        "User-Agent": snooper_options.user_agent
                    }
                }, (err, res, body) => {
                    if (err && retries <= 0) {
                        return cb(err, null)
                    } else if (err) {
                        return this._get_token(retries - 1, cb)
                    }

                    let token_info = JSON.parse(body)

                    this.token_expiration = Date.now() / 1000 + token_info.expires_in / 2
                    this.token = token_info.token_type + " " + token_info.access_token

                    cb(null, this.token)
                })
            }
        }

        // throttle requests
        schedule_request(api_request, high_priority, desired_wait_time_ms) {
            if (desired_wait_time_ms) {
                // TODO: fix case where lots of these could go off at once breaking the rate limit
                setTimeout(api_request, desired_wait_time_ms)
            } else {
                let time_diff = Date.now() - this.last_request
                if (time_diff >= this.ms_between_requests) {
                    api_request()
                    this.last_request = Date.now()
                } else {
                    let wait_time = this.ms_between_requests - time_diff
                    //console.log("wait time " + wait_time)
                    setTimeout(api_request, wait_time)

                    this.last_request = Date.now() + wait_time
                }
            }
        }

        construct_url(path) {
            let default_endpoint = "https://www.reddit.com/"
            let oauth_endpoint = "https://oauth.reddit.com/"

            //if (path.indexOf('api') > -1) {

            return (new url.URL(path, oauth_endpoint)).toString()
            //} else {
            //   return (new url.URL(path+'.json', default_endpoint)).toString()
            //}
        }

        generic_api_call(endpoint, method, data, cb) {
            this._generic_api_call(endpoint, method, data, 3, cb)

        }
        _generic_api_call(endpoint, method, data, retries_left, cb) {
            this.schedule_request(() => {

                this.get_token((err, token) => {
                    //console.log(token)
                    if (err) {
                        cb(err)
                    }
                    // data.raw_json = 1 // dont replace json objects with html escaped <, > and &
                    let request_options = {
                        url:     endpoint,
                        method:  method,
                        headers: {
                            "Authorization": token,
                            "User-Agent":    snooper_options.user_agent
                        }
                    }
                    if (method === "GET") {
                        request_options.qs = data
                    } else if (method === "PATCH" || method === "PUT" || method === "DELETE") {
                        request_options.body = data
                        request_options.json = true
                    } else if (method === "POST") {
                        request_options.form = data
                    }

                    request(request_options, (err, res, body_json) => {
                        if (err && retries_left > 0) {
                            return this._generic_api_call(endpoint, method, data, retries_left-1, cb)
                        } else if (err) {
                            return cb(err)
                        }

                        // dont parse if its already an object
                        let body = (typeof body_json === "string") ? JSON.parse(body_json) : body_json

                        // rate limit info - oauth2 clients get 60 requests / minuite
                        let ratelimit_used = res.headers["x-ratelimit-used"] // used during period
                        let ratelimit_remaining = res.headers["x-ratelimit-remaining"] // remaining requests in period
                        let ratelimit_reset = res.headers["x-ratelimit-reset"] // time until end of period

                        //console.log("ratelimit remaining:" + ratelimit_remaining + " reset:" + ratelimit_reset + " used:" + ratelimit_used)

                        let status_class = Math.floor(res.statusCode / 100)

                        switch (status_class) {
                            case 1: // information
                                cb(null, res.statusCode, body)
                                break

                            case 2: // success
                                // well is it a success...
                                if (body && body.json && body.json.ratelimit) {
                                    if (snooper_options.automatic_retries) {
                                        //console.log('retrying in ' + body.json.ratelimit *1000)
                                        this.schedule_request(() => {
                                            this.generic_api_call(endpoint, method, data, retries_left, cb)
                                        }, false, body.json.ratelimit *1000)
                                    } else {
                                        cb("you are doing this too much, try again in: " + body.json.ratelimit + " seconds", res.statusCode, body)
                                    }
                                } else {
                                    cb(null, res.statusCode, body)
                                }
                                break

                            case 3: // redirection
                                cb(null, res.statusCode, body)
                                break

                            case 4: // client error
                                cb(null, res.statusCode, body)
                                break

                            case 5: // server error (retryable)
                                //console.log("encountered retryable error")
                                if (retries_left > 0) {
                                    this.schedule_request(() => {
                                        this.generic_api_call(endpoint, method, data, retries_left - 1, cb)
                                    })
                                } else {
                                    cb(null, res.statusCode, body)
                                }
                                break

                            default:
                                cb("what happened", res.statusCode, body)
                        }

                    })
                })
            })
        }

        get(endpoint, data, cb) {
            this.generic_api_call(this.construct_url(endpoint), "GET", data, cb)
        }

        post(endpoint, data, cb) {
            this.generic_api_call(this.construct_url(endpoint), "POST", data, cb)
        }

        patch(endpoint, data, cb) {
            this.generic_api_call(this.construct_url(endpoint), "PATCH", data, cb)
        }

        put(endpoint, data, cb) {
            this.generic_api_call(this.construct_url(endpoint), "PUT", data, cb)
        }

        del(endpoint, data, cb) {
            this.generic_api_call(this.construct_url(endpoint), "DELETE", data, cb)
        }
    }


    return new ApiWrapper()
}