import http from "node:http";
import { spawn } from "node:child_process";

const MOCK_PORT = 3001;
const VITE_PORT = 5173;

const now = new Date("2026-09-26T12:00:00.000Z");

const ranges = {
    from: "2026-09-26T10:00:00.000Z",
    to: "2026-09-26T12:00:00.000Z",
    bucketSeconds: 600,
};

const conversations = [
    {
        conversationId: "conv-1",
        serviceNames: ["planner", "tools"],
        startTime: "2026-09-26T11:10:00.000Z",
        lastActivity: "2026-09-26T11:24:00.000Z",
        turnCount: 3,
        errorTurns: 1,
        failedSpans: 1,
        totalTokens: 18340,
        activeMs: 162000,
    },
    {
        conversationId: "conv-2",
        serviceNames: ["research"],
        startTime: "2026-09-26T10:40:00.000Z",
        lastActivity: "2026-09-26T10:51:00.000Z",
        turnCount: 2,
        errorTurns: 0,
        failedSpans: 0,
        totalTokens: 7420,
        activeMs: 82000,
    },
];

const traces = [
    {
        traceId: "t-0001".padEnd(32, "1"),
        rootSpanName: "assistant.turn",
        serviceName: "planner",
        startTime: "2026-09-26T11:12:00.000Z",
        durationMs: 790,
        status: "ok",
        spanCount: 8,
        errorCount: 0,
        totalTokens: 4180,
        conversationId: "conv-1",
    },
    {
        traceId: "t-0002".padEnd(32, "2"),
        rootSpanName: "assistant.turn",
        serviceName: "tools",
        startTime: "2026-09-26T11:16:00.000Z",
        durationMs: 1010,
        status: "error",
        spanCount: 7,
        errorCount: 1,
        totalTokens: 5270,
        conversationId: "conv-1",
    },
    {
        traceId: "t-0003".padEnd(32, "3"),
        rootSpanName: "assistant.turn",
        serviceName: "research",
        startTime: "2026-09-26T10:42:00.000Z",
        durationMs: 620,
        status: "ok",
        spanCount: 5,
        errorCount: 0,
        totalTokens: 3140,
        conversationId: "conv-2",
    },
];

const spans = [
    {
        spanId: "span-1",
        traceId: traces[0].traceId,
        parentSpanId: null,
        conversationId: "conv-1",
        name: "assistant.turn",
        kind: "agent",
        serviceName: "planner",
        startTime: "2026-09-26T11:12:00.000Z",
        durationMs: 790,
        status: "ok",
        model: "gpt-5.4-mini",
        totalTokens: 4180,
        input: "Planifica el siguiente paso.",
        output: "Claro, aquí va un plan.",
    },
    {
        spanId: "span-2",
        traceId: traces[1].traceId,
        parentSpanId: null,
        conversationId: "conv-1",
        name: "tool.search",
        kind: "tool",
        serviceName: "tools",
        startTime: "2026-09-26T11:16:00.000Z",
        durationMs: 310,
        status: "error",
        model: null,
        totalTokens: null,
        input: "Buscar en base de conocimiento",
        output: "Timeout",
    },
    {
        spanId: "span-3",
        traceId: traces[2].traceId,
        parentSpanId: null,
        conversationId: "conv-2",
        name: "assistant.turn",
        kind: "agent",
        serviceName: "research",
        startTime: "2026-09-26T10:42:00.000Z",
        durationMs: 620,
        status: "ok",
        model: "gpt-5.4-mini",
        totalTokens: 3140,
        input: "Resume el problema.",
        output: "Resumen preparado.",
    },
];

const detailByTrace = {
    [traces[0].traceId]: {
        traceId: traces[0].traceId,
        startTime: traces[0].startTime,
        durationMs: traces[0].durationMs,
        status: traces[0].status,
        spanCount: traces[0].spanCount,
        errorCount: traces[0].errorCount,
        totalTokens: traces[0].totalTokens,
        truncated: false,
        conversationId: "conv-1",
        roots: [
            {
                spanId: "root-1",
                parentSpanId: null,
                name: "assistant.turn",
                kind: "agent",
                serviceName: "planner",
                startTime: traces[0].startTime,
                offsetMs: 0,
                durationMs: 790,
                status: { code: "ok", message: null },
                orphan: false,
                genAi: {
                    operation: "chat",
                    provider: "openai",
                    requestModel: "gpt-5.4-mini",
                    responseModel: "gpt-5.4-mini",
                    inputTokens: 1200,
                    outputTokens: 980,
                    totalTokens: 2180,
                    finishReasons: ["stop"],
                    temperature: 0.2,
                    maxTokens: 4096,
                    toolName: null,
                    toolCallId: null,
                },
                content: { inputMessages: [{ role: "user", content: "Planifica el siguiente paso." }], outputMessages: [{ role: "assistant", content: "Claro." }] },
                attributes: { "gen_ai.operation": "chat" },
                events: [{ name: "start", time: traces[0].startTime, attributes: {} }],
                children: [],
            },
        ],
    },
    [traces[1].traceId]: {
        traceId: traces[1].traceId,
        startTime: traces[1].startTime,
        durationMs: traces[1].durationMs,
        status: traces[1].status,
        spanCount: traces[1].spanCount,
        errorCount: traces[1].errorCount,
        totalTokens: traces[1].totalTokens,
        truncated: false,
        conversationId: "conv-1",
        roots: [
            {
                spanId: "root-2",
                parentSpanId: null,
                name: "tool.search",
                kind: "tool",
                serviceName: "tools",
                startTime: traces[1].startTime,
                offsetMs: 0,
                durationMs: 310,
                status: { code: "error", message: "Timeout" },
                orphan: false,
                genAi: {
                    operation: "tool",
                    provider: null,
                    requestModel: null,
                    responseModel: null,
                    inputTokens: null,
                    outputTokens: null,
                    totalTokens: null,
                    finishReasons: [],
                    temperature: null,
                    maxTokens: null,
                    toolName: "search",
                    toolCallId: "call-1",
                },
                content: { toolArguments: { query: "Buscar en base de conocimiento" }, toolResult: { error: "Timeout" } },
                attributes: {},
                events: [{ name: "error", time: traces[1].startTime, attributes: { message: "Timeout" } }],
                children: [],
            },
        ],
    },
    [traces[2].traceId]: {
        traceId: traces[2].traceId,
        startTime: traces[2].startTime,
        durationMs: traces[2].durationMs,
        status: traces[2].status,
        spanCount: traces[2].spanCount,
        errorCount: traces[2].errorCount,
        totalTokens: traces[2].totalTokens,
        truncated: false,
        conversationId: "conv-2",
        roots: [],
    },
};

const transcripts = {
    "conv-1": {
        conversationId: "conv-1",
        contentCaptured: true,
        truncated: false,
        turns: [
            { traceId: traces[0].traceId, startTime: traces[0].startTime, model: "gpt-5.4-mini", user: "Planifica el siguiente paso.", assistant: "Claro, aquí va un plan." },
            { traceId: traces[1].traceId, startTime: traces[1].startTime, model: "gpt-5.4-mini", user: "Busca la información.", assistant: null },
        ],
    },
    "conv-2": {
        conversationId: "conv-2",
        contentCaptured: true,
        truncated: false,
        turns: [{ traceId: traces[2].traceId, startTime: traces[2].startTime, model: "gpt-5.4-mini", user: "Resume el problema.", assistant: "Resumen preparado." }],
    },
};

const overview = {
    range: ranges,
    totals: {
        traces: 3,
        spans: 20,
        conversations: 2,
        errorTraces: 1,
        errorRate: 1 / 3,
        inputTokens: 2800,
        outputTokens: 1680,
        totalTokens: 4480,
    },
    latencyMs: { p50: 790, p95: 966, p99: 1000 },
    timeseries: [
        { bucketStart: "2026-09-26T10:00:00.000Z", traces: 0, errorTraces: 0, p95Ms: 0, totalTokens: 0 },
        { bucketStart: "2026-09-26T10:30:00.000Z", traces: 1, errorTraces: 0, p95Ms: 620, totalTokens: 3140 },
        { bucketStart: "2026-09-26T11:00:00.000Z", traces: 2, errorTraces: 1, p95Ms: 966, totalTokens: 4180 },
        { bucketStart: "2026-09-26T11:30:00.000Z", traces: 0, errorTraces: 0, p95Ms: 0, totalTokens: 0 },
    ],
    byModel: [
        { model: "gpt-5.4-mini", calls: 3, inputTokens: 2800, outputTokens: 1680, p95Ms: 966 },
    ],
    byTool: [
        { tool: "search", calls: 1, errors: 1, p95Ms: 310 },
    ],
};

const services = { items: ["planner", "research", "tools"] };

function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
    res.end(payload);
}

function problem(res, status, title, detail = undefined) {
    json(res, status, { type: "about:blank", title, status, detail });
}

function slicePage(items, cursor, limit = 50) {
    const start = cursor ? Number(cursor) : 0;
    const page = items.slice(start, start + limit);
    const nextCursor = start + limit < items.length ? String(start + limit) : null;
    return { items: page, nextCursor };
}

function handler(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (!url.pathname.startsWith("/api/v1")) {
        problem(res, 404, "Not Found");
        return;
    }

    const path = url.pathname.slice("/api/v1".length);
    const method = req.method ?? "GET";

    if (method !== "GET") {
        problem(res, 405, "Method Not Allowed");
        return;
    }

    if (path === "/services") return json(res, 200, services);
    if (path === "/metrics/overview") return json(res, 200, overview);
    if (path === "/traces") return json(res, 200, slicePage(traces, url.searchParams.get("cursor"), Number(url.searchParams.get("limit") ?? 50)));
    if (path === "/spans") return json(res, 200, slicePage(spans, url.searchParams.get("cursor"), Number(url.searchParams.get("limit") ?? 50)));
    if (path === "/conversations") return json(res, 200, slicePage(conversations, url.searchParams.get("cursor"), Number(url.searchParams.get("limit") ?? 50)));

    const conversationMatch = path.match(/^\/conversations\/([^/]+)(\/transcript)?$/);
    if (conversationMatch) {
        const id = decodeURIComponent(conversationMatch[1]);
        if (conversationMatch[2] === "/transcript") {
            const transcript = transcripts[id];
            if (!transcript) return problem(res, 404, "Not Found", `Conversation ${id} not found`);
            return json(res, 200, transcript);
        }
        const conversation = conversations.find((item) => item.conversationId === id);
        const detail = conversation ? { ...conversation, turns: slicePage(traces.filter((trace) => trace.conversationId === id), url.searchParams.get("cursor"), Number(url.searchParams.get("limit") ?? 50)) } : null;
        if (!detail) return problem(res, 404, "Not Found", `Conversation ${id} not found`);
        return json(res, 200, detail);
    }

    const traceMatch = path.match(/^\/traces\/([^/]+)$/);
    if (traceMatch) {
        const traceId = decodeURIComponent(traceMatch[1]);
        const detail = detailByTrace[traceId];
        if (!detail) return problem(res, 404, "Not Found", `Trace ${traceId} not found`);
        return json(res, 200, detail);
    }

    problem(res, 404, "Not Found");
}

const apiServer = http.createServer(handler);
apiServer.listen(MOCK_PORT, () => {
    console.log(`[mock-api] listening on http://localhost:${MOCK_PORT}`);
});

const vite = spawn("npm", ["run", "dev"], {
    stdio: "inherit",
    env: { ...process.env, MEMTRACE_API_URL: `http://localhost:${MOCK_PORT}` },
});

function shutdown(signal) {
    console.log(`\n[dev-mock] shutting down after ${signal}`);
    apiServer.close();
    vite.kill(signal);
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
vite.on("exit", (code) => {
    apiServer.close();
    process.exit(code ?? 0);
});
