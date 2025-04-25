import Snooper from './watcher.js'
const snooper = new Snooper({
  automatic_retries: true, // automatically handles condition when reddit says 'you are doing this too much'
  api_requests_per_minute: 60, // api requests will be spread out in order to play nicely with Reddit
  // app_id: process.env.REDDIT_APP_ID,
  // api_secret: process.env.REDDIT_API_SECRET,
});

snooper.getListingWatcher('funny+pics', {
    listing: 'hot',
    limit: 15,

  })
  .on('item', (item) => {
    console.log('item', item);
  })
  .on('error', (err) => {
    console.error('Error:', err);
  });