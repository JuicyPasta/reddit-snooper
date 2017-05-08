'use strict';
var request = require('request')

const EventEmitter = require('events');

module.exports = function(options) {


class RedditWatcher extends EventEmitter {
  constructor(start_page) {
    super()
    start_page = start_page || 'https://reddit.com/r/all/comments.json'
    this.once('newListener', function(event, listener) {
      if (event == "item") {
        this._concurrent_item_emitter(start_page, 0, '')
      } else {
        console.log("whats this")
      }
    })
    
  }

  // emits 'item'
  _get_items(start_page, after_name, until_name, cb_first_item) {
    let saved_this = this
    request({
        url: start_page,
        qs: { after: after_name }
    }, function (err, res, body_json) {
        if (err) return cb(err)

        var body = JSON.parse(body_json)
        var children = body.data.children

        if (children.length > 0) {
            if (!after_name) {
                cb_first_item(children[0].data.name)
                //console.log(children[0].data.name + " - " + until_name)
            }

            after_name = children[children.length-1].data.name
            let is_done = false

            for (var i = 0; i < children.length; i++) {
                // found the comment we are looking up to
                if (children[i].data.name == until_name) {
                    // we only care about the comments before and we are done looking
                    children = children.slice(0, i)
                    is_done = true
                    break
                }
            }

            if (!is_done && until_name) saved_this._get_items(start_page, after_name, until_name, cb_first_item)
            

            if (until_name) {
                children.map(function(comment) {
                    saved_this.emit('item', comment)
                })
            } 
        } 
    })
  }

  _concurrent_item_emitter(start_page, wait_interval, until_name) {
      let saved_this = this

      setTimeout(function() {
          saved_this._get_items(start_page, '', until_name, function(first_comment_retrieved) {
              saved_this._concurrent_item_emitter(start_page, wait_interval, first_comment_retrieved)
          })
      }, wait_interval)
  }

}


return {
  RedditWatcher: RedditWatcher
}
}