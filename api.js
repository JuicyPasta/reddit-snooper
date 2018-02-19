"use strict"
const { http_request, Limiter, retry_after_ms, backoff_ms } = require("./http")
const version = require("./package.json").version

const DEFAULT_USER_AGENT = "node:reddit-snooper:v" + version + " (by /u/juicypasta)"

module.exports = function (snooper_options) {
    snooper_options = snooper_options || {}

    const endpoints = Object.assign({
        token:  "https://www.reddit.com/api/v1/access_token",
        oauth:  "https://oauth.reddit.com/", // anything with a bearer token goes here
        public: "https://www.reddit.com/"    // logged out .json pages
    }, snooper_options.endpoints)

    class ApiWrapper {
        constructor(snooper_options) {
            this.user_agent = snooper_options.user_agent || DEFAULT_USER_AGENT

            // reddit gives oauth clients 100 requests / minute (averaged over 10 minutes), 60 leaves some room
            this.requests_per_minute = snooper_options.api_requests_per_minute || snooper_options.api_requests_per_minuite || 60
            this.limiter = new Limiter(this.requests_per_minute)

            // logged out traffic gets 10 requests / minute (when reddit lets it through at all)
            this.public_limiter = new Limiter(10)

            this.token_expiration = 0
            this.token = null
            this.token_callbacks = null
        }

        // watchers only need an app id + secret, posting as a user also needs username + password
        has_credentials() {
            return !!(snooper_options.app_id && snooper_options.api_secret)
        }

        // Retrieve OAUTH Token (tokens are good for an hour, we grab a new one after 30 mins)
        get_token(cb) {
            if (this.token && Date.now() / 1000 <= this.token_expiration) {
                return cb(null, this.token)
            }

            if (!this.has_credentials()) {
                return cb("reddit api credentials (app_id and api_secret) are needed for this, see the README")
            }

            // only ask reddit once even if a bunch of calls need a token at the same time
            if (this.token_callbacks) {
                return this.token_callbacks.push(cb)
            }
            this.token_callbacks = [cb]

            this._get_token(5, (err, token) => { // 5 retries
                let callbacks = this.token_callbacks
                this.token_callbacks = null
                callbacks.forEach((callback) => callback(err, token))
            })
        }

        _get_token(retries, cb) {
            // script apps can log in as the bot account, otherwise use app only oauth (read only stuff)
            let form = (snooper_options.username && snooper_options.password) ? {
                "grant_type": "password",
                "username":   snooper_options.username,
                "password":   snooper_options.password
            } : {
                "grant_type": "client_credentials"
            }

            http_request({
                url:     endpoints.token,
                method:  "POST",
                form:    form,
                headers: {
                    "Authorization": "Basic " + Buffer.from(snooper_options.app_id + ":" + snooper_options.api_secret).toString("base64"),
                    "User-Agent":    this.user_agent
                }
            }, (err, res) => {
                let retryable = err || res.statusCode === 429 || res.statusCode >= 500
                if (retryable && retries > 0) {
                    let wait = err ? backoff_ms(5 - retries) : retry_after_ms(res.headers, 5 - retries)
                    return setTimeout(() => this._get_token(retries - 1, cb), wait)
                } else if (err) {
                    return cb(err, null)
                }

                let token_info = res.body
                // reddit sends a 200 with {"error": "invalid_grant"} when the password is wrong
                if (res.statusCode !== 200 || !token_info || !token_info.access_token) {
                    let reason = (token_info && (token_info.error || token_info.message)) || "no access_token in response"
                    return cb("could not get an oauth token from reddit (" + res.statusCode + "): " + reason, null)
                }

                this.token_expiration = Date.now() / 1000 + token_info.expires_in / 2
                this.token = token_info.token_type + " " + token_info.access_token

                cb(null, this.token)
            })
        }

        // throttle requests, desired_wait_time_ms delays just this request (it still waits its turn after that)
        schedule_request(api_request, high_priority, desired_wait_time_ms, limiter) {
            limiter = limiter || this.limiter
            if (desired_wait_time_ms) {
                setTimeout(() => limiter.schedule(api_request), desired_wait_time_ms)
            } else {
                limiter.schedule(api_request)
            }
        }

        // authed calls go to oauth.reddit.com, logged out GETs fall back to the public .json pages
        construct_url(path, method) {
            if (!this.has_credentials() && (!method || method === "GET")) {
                let public_url = new URL(path, endpoints.public)
                if (!public_url.pathname.endsWith(".json")) {
                    public_url.pathname = public_url.pathname.replace(/\/+$/, "") + ".json"
                }
                return public_url.toString()
            }

            return (new URL(path, endpoints.oauth)).toString()
        }

        generic_api_call(endpoint, method, data, cb) {
            this._generic_api_call(endpoint, method, data, 3, cb)
        }

        _generic_api_call(endpoint, method, data, retries_left, cb, attempt) {
            attempt = attempt || 0
            let needs_token = endpoint.indexOf(endpoints.oauth) === 0
            let limiter = needs_token ? this.limiter : this.public_limiter

            // back off the whole queue (reddit is struggling or wants us to slow down) then go again
            let retry = (wait_ms, retries) => {
                limiter.backoff(wait_ms)
                this._generic_api_call(endpoint, method, data, retries, cb, attempt + 1)
            }

            this.schedule_request(() => {
                let send = (token) => {
                    let request_options = {
                        url:     endpoint,
                        method:  method,
                        headers: {
                            "User-Agent": this.user_agent
                        }
                    }
                    if (token) request_options.headers["Authorization"] = token

                    // data.raw_json = 1 // dont replace json objects with html escaped <, > and &
                    if (method === "GET") {
                        request_options.qs = data
                    } else if (method === "PATCH" || method === "PUT" || method === "DELETE") {
                        if (data !== undefined && data !== null) request_options.json = data
                    } else if (method === "POST") {
                        request_options.form = data || {}
                    }

                    http_request(request_options, (err, res) => {
                        if (err && retries_left > 0) {
                            return retry(backoff_ms(attempt), retries_left - 1)
                        } else if (err) {
                            return cb(err)
                        }

                        let body = res.body

                        // rate limit info, reddit sends these on every response
                        // x-ratelimit-used: used during period
                        // x-ratelimit-remaining: remaining requests in period
                        // x-ratelimit-reset: seconds until end of period
                        limiter.update(res.headers)

                        // token got revoked or expired early, grab a new one and try again
                        if (res.statusCode === 401 && token && retries_left > 0) {
                            this.token = null
                            this.token_expiration = 0
                            return retry(0, retries_left - 1)
                        }

                        // too many requests, wait however long reddit says and try again
                        if (res.statusCode === 429) {
                            let wait = retry_after_ms(res.headers, attempt)
                            if (retries_left > 0) {
                                return retry(wait, retries_left - 1)
                            }
                            limiter.backoff(wait)
                            return cb(null, res.statusCode, body)
                        }

                        let status_class = Math.floor(res.statusCode / 100)

                        switch (status_class) {
                            case 1: // information
                                cb(null, res.statusCode, body)
                                break

                            case 2: // success
                                // well is it a success...
                                if (body && body.json && body.json.ratelimit) {
                                    if (snooper_options.automatic_retries) {
                                        // this one is per action (commenting etc) so only this request waits
                                        setTimeout(() => {
                                            this._generic_api_call(endpoint, method, data, retries_left, cb, attempt)
                                        }, body.json.ratelimit * 1000)
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
                                if (retries_left > 0) {
                                    retry(backoff_ms(attempt), retries_left - 1)
                                } else {
                                    cb(null, res.statusCode, body)
                                }
                                break

                            default:
                                cb("what happened", res.statusCode, body)
                        }
                    })
                }

                if (!needs_token) return send(null)

                this.get_token((err, token) => {
                    if (err) return cb(err)
                    send(token)
                })
            }, false, 0, limiter)
        }

        get(endpoint, data, cb) {
            this.generic_api_call(this.construct_url(endpoint, "GET"), "GET", data, cb)
        }

        post(endpoint, data, cb) {
            this.generic_api_call(this.construct_url(endpoint, "POST"), "POST", data, cb)
        }

        patch(endpoint, data, cb) {
            this.generic_api_call(this.construct_url(endpoint, "PATCH"), "PATCH", data, cb)
        }

        put(endpoint, data, cb) {
            this.generic_api_call(this.construct_url(endpoint, "PUT"), "PUT", data, cb)
        }

        del(endpoint, data, cb) {
            this.generic_api_call(this.construct_url(endpoint, "DELETE"), "DELETE", data, cb)
        }

        // the README always said snooper.api.delete
        delete(endpoint, data, cb) {
            this.del(endpoint, data, cb)
        }
    }


    return new ApiWrapper(snooper_options)
}

module.exports.DEFAULT_USER_AGENT = DEFAULT_USER_AGENT
