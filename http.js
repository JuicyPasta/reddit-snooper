"use strict"

// tiny wrapper around node's built in fetch (node 18+), replaces the request module

// options: url, method, headers, qs, form, json, timeout_ms
// cb(err, res) where res = { statusCode, headers, body }
// body is parsed json when reddit sends json, otherwise the raw text
function http_request(options, cb) {
    let url = new URL(options.url)
    let headers = Object.assign({}, options.headers)
    let body

    if (options.qs) {
        for (let key of Object.keys(options.qs)) {
            let value = options.qs[key]
            if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value)
        }
    }

    if (options.form) {
        body = new URLSearchParams(options.form).toString()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    } else if (options.json !== undefined) {
        body = JSON.stringify(options.json)
        headers["Content-Type"] = "application/json"
    }

    fetch(url, {
        method:   options.method || "GET",
        headers:  headers,
        body:     body,
        redirect: "manual", // reddit redirects missing subreddits to search, we want to see that
        signal:   AbortSignal.timeout(options.timeout_ms || 30000)
    }).then((res) => {
        return res.text().then((text) => {
            let res_headers = {}
            res.headers.forEach((value, key) => res_headers[key] = value)

            let parsed = text
            if (/json/.test(res_headers["content-type"] || "") || /^\s*[{[]/.test(text)) {
                try {
                    parsed = JSON.parse(text)
                } catch (_err) {
                    // leave it as text
                }
            }

            return { statusCode: res.status, headers: res_headers, body: parsed }
        })
    }).then(
        // call back outside the promise so errors thrown in callbacks act like normal errors
        (res) => process.nextTick(cb, null, res),
        (err) => process.nextTick(cb, err)
    )
}

// spaces requests out so we stay under reddit's limits, everything goes through one queue
// so a bunch of retries firing at once cant blow through the limit
class Limiter {
    constructor(requests_per_minute) {
        this.ms_between_requests = (1000 * 60) / requests_per_minute
        this.next_slot = 0
        this.blocked_until = 0
        this.queue = []
        this.timer = null
    }

    schedule(fn) {
        this.queue.push(fn)
        this._drain()
    }

    // wait at least ms before sending anything else
    backoff(ms) {
        this.blocked_until = Math.max(this.blocked_until, Date.now() + ms)
    }

    // reddit tells us how many requests are left in the current window
    update(headers) {
        let remaining = parseFloat(headers["x-ratelimit-remaining"])
        let reset = parseFloat(headers["x-ratelimit-reset"])
        if (!isNaN(remaining) && !isNaN(reset) && remaining < 1) {
            this.backoff(reset * 1000)
        }
    }

    _drain() {
        if (this.timer || this.queue.length === 0) return

        let wait = Math.max(this.next_slot, this.blocked_until) - Date.now()
        if (wait > 0) {
            this.timer = setTimeout(() => {
                this.timer = null
                this._drain()
            }, wait)
            return
        }

        this.next_slot = Date.now() + this.ms_between_requests
        let fn = this.queue.shift()
        fn()
        this._drain()
    }
}

// how long to wait after a 429, reddit sends retry-after and/or x-ratelimit-reset (both in seconds)
function retry_after_ms(headers, attempt) {
    let retry_after = parseFloat(headers["retry-after"])
    if (retry_after > 0) return retry_after * 1000

    let reset = parseFloat(headers["x-ratelimit-reset"])
    if (reset > 0) return reset * 1000

    return backoff_ms(attempt)
}

// 1s, 2s, 4s, 8s... capped at a minute
function backoff_ms(attempt) {
    return Math.min(1000 * Math.pow(2, attempt), 60 * 1000)
}

module.exports = { http_request, Limiter, retry_after_ms, backoff_ms }
