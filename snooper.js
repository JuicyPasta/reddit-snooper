'use strict'

var Api = require('./api')
var Watcher = require('./watcher')

module.exports = function(options) {
    // error check options
    options.user_agent = options.user_agent || "Snooper/0.1 by /u/juicypasta"

    const api = Api(options)
    const watcher = Watcher(options) 

    return {
        api: api,
        watcher: watcher
    }
}



