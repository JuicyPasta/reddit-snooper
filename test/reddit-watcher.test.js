
const RedditWatcher = require('../reddit-watcher.js');
const EventEmitter = require('events').EventEmitter;
const should = require('should');

describe('RedditWatcher', () => {

  it('RedditWatcher should exist', () => should.exist(RedditWatcher));

  let emitter = RedditWatcher.getEmitter();

  it('should be able to get the emitter', () => {
    should.exist(emitter);
    emitter.should.be.an.instanceof(EventEmitter);
    emitter.on.should.be.a.Function();
  });
  
  
})

