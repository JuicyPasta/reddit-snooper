// reddit ids are base 36 counters: posts are t3_<id>, comments are t1_<id>
// bigint so the math stays exact however big they get, and zz + 1 carries to 100

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"

// takes an id ("dhavp8p") or a fullname ("t1_dhavp8p")
export function parseId(id: string): bigint {
    const raw = id.slice(id.indexOf("_") + 1).toLowerCase()
    if (!/^[0-9a-z]+$/.test(raw)) {
        throw new TypeError(`not a reddit id: ${JSON.stringify(id)}`)
    }

    let n = 0n
    for (const char of raw) n = n * 36n + BigInt(DIGITS.indexOf(char))
    return n
}

export function formatId(n: bigint): string {
    if (n < 0n) throw new RangeError(`reddit ids can't be negative: ${n}`)

    let id = ""
    do {
        id = DIGITS[Number(n % 36n)] + id
        n /= 36n
    } while (n > 0n)
    return id
}

export function toFullname(kind: string, n: bigint): string {
    return `${kind}_${formatId(n)}`
}
