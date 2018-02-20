// fake reddit for the unit tests, records every request and answers with whatever the handler returns
import http from "node:http"
import type {AddressInfo} from "node:net"
import {Snooper, formatId, parseId, type Endpoints, type SnooperOptions} from "../../src/index.ts"

export interface MockRequest {
    method: string
    url: URL
    headers: http.IncomingHttpHeaders
    body: string
    at: number
}

export interface MockReply {
    status?: number
    headers?: Record<string, string>
    body?: unknown
}

export type Handler = (req: MockRequest, n: number) => MockReply | null | undefined | Promise<MockReply | null | undefined>

export interface MockServer {
    url: string
    requests: MockRequest[]
    handler: Handler
    close(): Promise<void>
}

export function mockServer(handler: Handler): Promise<MockServer> {
    const server = http.createServer()
    const mock: MockServer = {
        url:      "",
        requests: [],
        handler:  handler,
        close:    () => new Promise((resolve) => {
            server.closeAllConnections()
            server.close(() => resolve())
        })
    }

    server.on("request", (req, res) => {
        let body = ""
        req.on("data", (chunk) => body += chunk)
        req.on("end", async () => {
            const request: MockRequest = {
                method:  req.method ?? "GET",
                url:     new URL(req.url ?? "/", "http://localhost"),
                headers: req.headers,
                body:    body,
                at:      Date.now()
            }
            mock.requests.push(request)

            const reply = (await mock.handler(request, mock.requests.length)) ?? {status: 404, body: {message: "Not Found", error: 404}}
            const headers = {...reply.headers}
            let text = reply.body
            if (typeof text !== "string") {
                text = JSON.stringify(text ?? {})
                headers["content-type"] = "application/json; charset=UTF-8"
            }
            if (res.destroyed) return
            res.writeHead(reply.status ?? 200, headers)
            res.end(text)
        })
    })

    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
            resolve(mock)
        })
    })
}

export interface MockReddit {
    www: MockServer   // public pages + token endpoint
    oauth: MockServer // oauth.reddit.com
    endpoints: Endpoints
    close(): Promise<void>
}

export async function mockReddit(www: Handler, oauth?: Handler): Promise<MockReddit> {
    const wwwServer = await mockServer(www)
    const oauthServer = await mockServer(oauth ?? (() => null))
    return {
        www:       wwwServer,
        oauth:     oauthServer,
        endpoints: {
            token:  wwwServer.url + "api/v1/access_token",
            public: wwwServer.url,
            oauth:  oauthServer.url
        },
        close: async () => {
            await wwwServer.close()
            await oauthServer.close()
        }
    }
}

export const tokenReply: MockReply = {status: 200, body: {access_token: "abc123", token_type: "bearer", expires_in: 3600, scope: "*"}}

// snooper pointed at the fake reddit with no waiting between requests, logged out unless auth is passed
export function testSnooper(reddit: MockReddit, extra: SnooperOptions = {}): Snooper {
    return new Snooper({
        endpoints:               reddit.endpoints,
        requestsPerMinute:       Infinity,
        publicRequestsPerMinute: Infinity,
        ...extra
    })
}

// a reddit thing, ids are numbers that get turned into base 36 like reddit's
export function thing(kind: "t1" | "t3", n: number | bigint, createdUtc = Date.now() / 1000) {
    const id = formatId(BigInt(n))
    return {
        kind: kind,
        data: {id: id, name: `${kind}_${id}`, author: `user${n}`, title: `post ${n}`, body: `comment ${n}`, created_utc: createdUtc}
    }
}

export function listing(kind: "t1" | "t3", ids: (number | bigint)[], after?: string) {
    return {
        kind: "Listing",
        data: {after: after ?? null, before: null, children: ids.map((n) => thing(kind, n))}
    }
}

export function n36(id: string): number {
    return Number(parseId(id))
}
