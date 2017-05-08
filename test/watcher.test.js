
const RedditWatcher = require('../watcher');
const EventEmitter = require('events').EventEmitter;
const should = require('should');

/*
describe('RedditWatcher', () => {

  it('RedditWatcher should exist', () => should.exist(RedditWatcher));

  let emitter = RedditWatcher.getEmitter();

  it('should be able to get the emitter', () => {
    should.exist(emitter);
    emitter.should.be.an.instanceof(EventEmitter);
    emitter.on.should.be.a.Function();
  });
  
  
})
*/


/*
get_api("user/juicypasta/comments", {type:'links', limit: 1}, function(err, data) {
    //console.log(data)
    console.log(JSON.parse(data).data.children.length) // THIS SHOULD BE 1
})

post_api("api/search_reddit_names", {exact:true, query:'wallstreetbets'}, function(err, data) {
    console.log(data)
    //data.names.should.be("wallstreetbets")
}) 

get_comments('wallstreetbets', 914, function(err, data) {
    //console.log(err)
    //console.log(data.length) // SHOULD BE 914
})

get_comments_after_time("wallstreetbets", 1000, Date.now()/1000 - 100, function(err, comments) {
    console.log(err)
    console.log(comments.length)
    comments.map(function(data) {
        console.log(data.data.id)
    })
})

get_comments_until_id("wallstreetbets", 1000, "dh7vz0r", function(err, comments) {
    console.log(err)
    console.log(comments.length)
    comments.map(function(data) {
        console.log(data.data.id)
    })
})
*/