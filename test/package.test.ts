// the built package (npm test builds first): both the esm and cjs entry points work and match
import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {it} from "node:test"

it("ships esm and cjs builds with the same exports", async () => {
    const name = "reddit-snooper" // through package.json "exports", like an installed copy
    const esm = await import(name)
    const cjs = createRequire(import.meta.url)(name)

    assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort())
    for (const build of [esm, cjs]) {
        const snooper = new build.Snooper()
        assert.equal(snooper.api.userAgent, build.DEFAULT_USER_AGENT)
        assert.ok(snooper.watch.posts("all") instanceof build.IdWalker)
        assert.ok(new build.RateLimitError("x", {status: 429, method: "GET", path: "/", retryAfterMs: 1}) instanceof build.ApiError)
    }
})
