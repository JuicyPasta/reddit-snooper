"use strict"

// fake reddit for the unit tests, records every request and answers with whatever handler returns
const http = require("http")

function mock_server(handler, cb) {
    let mock = {requests: [], handler: handler}

    mock.server = http.createServer((req, res) => {
        let body = ""
        req.on("data", (chunk) => body += chunk)
        req.on("end", () => {
            let request = {
                method:  req.method,
                url:     new URL(req.url, "http://localhost"),
                headers: req.headers,
                body:    body
            }
            mock.requests.push(request)

            let reply = mock.handler(request, mock.requests.length) || {status: 404, body: {message: "Not Found", error: 404}}
            let headers = Object.assign({}, reply.headers)
            let text = reply.body
            if (typeof text !== "string") {
                text = JSON.stringify(text)
                headers["content-type"] = "application/json; charset=UTF-8"
            }
            res.writeHead(reply.status || 200, headers)
            res.end(text)
        })
    })

    mock.server.listen(0, "127.0.0.1", () => {
        mock.url = "http://127.0.0.1:" + mock.server.address().port + "/"
        cb(mock)
    })

    mock.close = (done) => mock.server.close(done)
    return mock
}

// www.reddit.com (public pages + token endpoint) and oauth.reddit.com
function mock_reddit(www_handler, oauth_handler, cb) {
    mock_server(www_handler, (www) => {
        mock_server(oauth_handler || (() => null), (oauth) => {
            cb({
                www:   www,
                oauth: oauth,
                endpoints: {
                    token:  www.url + "api/v1/access_token",
                    public: www.url,
                    oauth:  oauth.url
                },
                close: (done) => www.close(() => oauth.close(done))
            })
        })
    })
}

// a reddit listing, ids are numbers that get turned into base 36 like reddit's
function listing(kind, ids, after) {
    return {
        kind: "Listing",
        data: {
            after:    after || null,
            children: ids.map((n) => {
                let id = n.toString(36)
                return {kind: kind, data: {id: id, name: kind + "_" + id, author: "user" + n, title: "post " + n, body: "comment " + n}}
            })
        }
    }
}

// no waiting between requests in tests
function no_throttle(api) {
    api.limiter.ms_between_requests = 0
    api.public_limiter.ms_between_requests = 0
    return api
}

module.exports = {mock_reddit, listing, no_throttle}
