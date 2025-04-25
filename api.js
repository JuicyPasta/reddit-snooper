"use strict";
const axios = require("axios");
const url = require("url");

module.exports = function (snooper_options) {
  class ApiWrapper {
    constructor(snooper_options) {
      this.requests_per_minuite = 60;
      this.ms_between_requests = (1000 * 60) / this.requests_per_minuite;
      this.last_request = 0;
      this.token_expiration = 0;
      this.token = null;
    }

    get_token(cb) {
      this._get_token(5, cb);
    }

    async _get_token(retries, cb) {
      if (Date.now() / 1000 <= this.token_expiration) {
        return cb(null, this.token);
      }

      try {
        const response = await axios.post(
          "https://www.reddit.com/api/v1/access_token",
          new URLSearchParams({
            grant_type: "password",
            username: snooper_options.username,
            password: snooper_options.password,
          }),
          {
            auth: {
              username: snooper_options.app_id,
              password: snooper_options.api_secret,
            },
            headers: {
              "User-Agent": snooper_options.user_agent,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          }
        );

        const token_info = response.data;
        this.token_expiration = Date.now() / 1000 + token_info.expires_in / 2;
        this.token = `${token_info.token_type} ${token_info.access_token}`;
        cb(null, this.token);
      } catch (err) {
        if (retries <= 0) {
          console.error({ err });
          return cb(err, null);
        }
        this._get_token(retries - 1, cb);
      }
    }

    schedule_request(api_request, high_priority, desired_wait_time_ms) {
      if (desired_wait_time_ms) {
        setTimeout(api_request, desired_wait_time_ms);
      } else {
        const time_diff = Date.now() - this.last_request;
        if (time_diff >= this.ms_between_requests) {
          api_request();
          this.last_request = Date.now();
        } else {
          const wait_time = this.ms_between_requests - time_diff;
          setTimeout(api_request, wait_time);
          this.last_request = Date.now() + wait_time;
        }
      }
    }

    construct_url(path) {
      const oauth_endpoint = "https://api.reddit.com/";
      const endpoint = new url.URL(path, oauth_endpoint).toString();
      return endpoint;
    }

    generic_api_call(endpoint, method, data, cb) {
      this._generic_api_call(endpoint, method, data, 3, cb);
    }

    _generic_api_call(endpoint, method, data, retries_left, cb) {
      this.schedule_request(() => {
        this.get_token(async (err, token) => {
          if (err) return cb(err);

          const headers = {
            Authorization: token,
            "User-Agent": snooper_options.user_agent,
          };

          let axiosConfig = {
            method: method.toLowerCase(),
            url: endpoint,
            headers,
          };

          if (method === "GET") {
            axiosConfig.params = data;
          } else if (["PATCH", "PUT", "DELETE"].includes(method)) {
            axiosConfig.data = data;
          } else if (method === "POST") {
            axiosConfig.headers["Content-Type"] = "application/x-www-form-urlencoded";
            axiosConfig.data = new URLSearchParams(data);
          }

          try {
            const res = await axios(axiosConfig);
            const body = res.data;

            const status_class = Math.floor(res.status / 100);

            switch (status_class) {
              case 1:
              case 2:
                if (body?.json?.ratelimit) {
                  if (snooper_options.automatic_retries) {
                    this.schedule_request(() => {
                      this.generic_api_call(endpoint, method, data, retries_left, cb);
                    }, false, body.json.ratelimit * 1000);
                  } else {
                    cb(`you are doing this too much, try again in: ${body.json.ratelimit} seconds`, res.status, body);
                  }
                } else {
                  cb(null, res.status, body);
                }
                break;
              case 3:
              case 4:
                cb(null, res.status, body);
                break;
              case 5:
                if (retries_left > 0) {
                  this.schedule_request(() => {
                    this.generic_api_call(endpoint, method, data, retries_left - 1, cb);
                  });
                } else {
                  cb(null, res.status, body);
                }
                break;
              default:
                cb("what happened", res.status, body);
            }
          } catch (error) {
            if (retries_left > 0) {
              this._generic_api_call(endpoint, method, data, retries_left - 1, cb);
            } else {
              cb(error);
            }
          }
        });
      });
    }

    get(endpoint, data, cb) {
      this.generic_api_call(this.construct_url(endpoint), "GET", data, cb);
    }

    post(endpoint, data, cb) {
      this.generic_api_call(this.construct_url(endpoint), "POST", data, cb);
    }

    patch(endpoint, data, cb) {
      this.generic_api_call(this.construct_url(endpoint), "PATCH", data, cb);
    }

    put(endpoint, data, cb) {
      this.generic_api_call(this.construct_url(endpoint), "PUT", data, cb);
    }

    del(endpoint, data, cb) {
      this.generic_api_call(this.construct_url(endpoint), "DELETE", data, cb);
    }
  }

  return new ApiWrapper();
};
