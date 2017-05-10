const credentials = require("../secrets/reddit-credentials")

const Snooper = require("../reddit-snooper"),
    snooper = new Snooper(credentials)


snooper.api.post("api/comment", {
    api_type: "json",
    text:     "another_test",
    thing_id: "t1_dhavp8p"
}, function (err, statusCode, data) {
    console.log(data)
})

snooper.api.get("api/v1/me/karma", {}, function (err, data) {
    console.log(err)
    console.log(data)
})

// I highly doubt your bot is over 18 years of age
snooper.api.patch("/api/v1/me/prefs/", {
    "over_18": false
}, function (err, data) {

})