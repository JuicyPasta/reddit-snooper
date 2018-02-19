"use strict"

var Api = require("./api")
var Watcher = require("./watcher")

module.exports = function (options) {
    // error check options
    options = options || {}
    options.user_agent = options.user_agent || Api.DEFAULT_USER_AGENT

    const api = Api(options)
    const watcher = Watcher(options, api) // watchers share the api's token and rate limit

    return {
        api:     api,
        watcher: watcher
    }
}
