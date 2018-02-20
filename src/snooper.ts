import {RedditApi, type SnooperOptions} from "./api.ts"
import {Watch} from "./watch.ts"

export class Snooper {
    readonly api: RedditApi
    readonly watch: Watch

    constructor(options: SnooperOptions = {}) {
        this.api = new RedditApi(options)
        this.watch = new Watch(this.api) // watchers share the api's token and rate limit
    }
}
