import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {formatId, parseId} from "../src/index.ts"

describe("ids", () => {
    it("counts in base 36 and carries", () => {
        assert.equal(parseId("zz"), 1295n)
        assert.equal(formatId(parseId("zz") + 1n), "100")
        assert.equal(formatId(parseId("1zzzzzz") + 1n), "2000000")
        assert.equal(formatId(parseId("9") + 1n), "a")
        assert.equal(formatId(0n), "0")
        // way past what a js number holds exactly
        assert.equal(formatId(parseId("zzzzzzzzzzzzzz") + 1n), "100000000000000")
    })

    it("takes ids or fullnames", () => {
        assert.equal(parseId("t1_dhavp8p"), parseId("dhavp8p"))
        assert.equal(parseId("t3_6arf2r"), 380_872_467n)
        assert.equal(parseId("T3_ABC"), parseId("abc"))
    })

    it("rejects junk", () => {
        assert.throws(() => parseId(""), TypeError)
        assert.throws(() => parseId("t3_"), TypeError)
        assert.throws(() => parseId("t3_ab-c"), TypeError)
        assert.throws(() => formatId(-1n), RangeError)
    })
})
