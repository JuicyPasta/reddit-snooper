'use strict';
var request = require('request')

const EventEmitter = require('events');

module.exports = function(snooper_options) {


class RedditWatcher extends EventEmitter {
  constructor(start_page, item_type, options) {
    super()
    this.is_closed = false

    this.item_type = item_type
    this.once('newListener', function(event, listener) {
      if (event == item_type) {
        this._concurrent_item_emitter(start_page, 0, '')
      } else {
        console.log("whats this")
      }
    })
    
  }

  close() {
    this.is_closed = true
  }

  // emits 'item'
  _get_items(start_page, after_name, until_name, cb_first_item) {
      if (this.is_closed)
        return

    let saved_this = this
    request({
        url: start_page,
        qs: { after: after_name }
    }, function (err, res, body_json) {
        if (err) {
          saved_this.emit('error', err)
        } 

        try {
        var body = JSON.parse(body_json)
        } catch (err) {
          saved_this.emit('error', "could not parse input")
          console.log(body)
        }
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

            if (!is_done && until_name) 
              saved_this._get_items(start_page, after_name, until_name, cb_first_item)
            

            if (until_name) {
                children.map(function(comment) {
                    saved_this.emit(saved_this.item_type, comment)
                })
            } 
        } 
    })
  }

  _concurrent_item_emitter(start_page, wait_interval, until_name) {
      if (this.is_closed)
        return
      let saved_this = this

      setTimeout(function() {
          saved_this._get_items(start_page, '', until_name, function(first_comment_retrieved) {
              saved_this._concurrent_item_emitter(start_page, wait_interval, first_comment_retrieved)
          })
      }, wait_interval)
  }

}

function getCommentWatcher(subreddit, options) {
    subreddit = subreddit.trim().replace('/', '')
    let start_page = 'https://reddit.com/r/' + subreddit + '/comments.json'

    return new RedditWatcher(start_page, 'comment', options)
}

function getPostWatcher(subreddit, options) {
    subreddit = subreddit.trim().replace('/', '')
    let start_page = 'https://reddit.com/r/' + subreddit + '/new.json'

    return new RedditWatcher(start_page, 'post', options)
}

return {
  getCommentWatcher: getCommentWatcher,
  getPostWatcher: getPostWatcher
}

}