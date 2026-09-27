import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const MOCK_PORT = 3001;

const now = new Date("2026-09-26T12:00:00.000Z");

const ranges = {
    from: "2026-09-26T10:00:00.000Z",
    to: "2026-09-26T12:00:00.000Z",
    bucketSeconds: 600,
};

// --- Identidad (ADR-013/ADR-016) ---------------------------------------

const me = { id: "user-1", email: "dev@memtrace.local", name: "Dev User", image: null };

const organizations = [{ id: "org-1", name: "Acme", myRole: "org_admin" }];

const experiments = [{ id: "exp-1", organizationId: "org-1", name: "Default Experiment", serviceName: "planner", myRole: "org_admin" }];

const orgMembers = {
    "org-1": { members: [{ userId: me.id, email: me.email, name: me.name, role: "org_admin" }], pendingInvitations: [] },
};

const experimentMembers = {
    "exp-1": { members: [{ userId: me.id, email: me.email, name: me.name, role: "org_admin" }], pendingInvitations: [] },
};

const apiKeys = {
    "exp-1": [{ id: "key-1", experimentId: "exp-1", keyPrefix: "mtk_dev1234", createdAt: "2026-09-20T09:00:00.000Z", lastUsedAt: "2026-09-26T08:00:00.000Z" }],
};

// --- Trazas / conversaciones (ADR-013, scoped por experimento) ----------

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
        input: "Pregunta de ejemplo 1: ¿puedes resumir el estado del proyecto?",
        output: "Respuesta de ejemplo 1: el proyecto avanza según lo previsto.",
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
        input: "Pregunta de ejemplo 2: ¿puedes resumir el estado del proyecto?",
        output: "Respuesta de ejemplo 2: el proyecto avanza según lo previsto.",
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
        input: "Pregunta de ejemplo 3: ¿puedes resumir el estado del proyecto?",
        output: "Respuesta de ejemplo 3: el proyecto avanza según lo previsto.",
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
        framework: "langchain",
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
                framework: "langchain",
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
        framework: "langchain",
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
                framework: "langchain",
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
        framework: null,
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
    byModel: [{ model: "gpt-5.4-mini", calls: 3, inputTokens: 2800, outputTokens: 1680, p95Ms: 966 }],
    byTool: [
        { tool: "search", calls: 15, errors: 2, p95Ms: 310 },
        { tool: "database_query", calls: 12, errors: 0, p95Ms: 280 },
        { tool: "api_call", calls: 8, errors: 1, p95Ms: 450 },
        { tool: "email_send", calls: 5, errors: 0, p95Ms: 120 },
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

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function handleExperimentScoped(res, experimentId, subpath, url) {
    if (subpath === "/traces") return json(res, 200, slicePage(traces, url.searchParams.get("cursor"), Number(url.searchParams.get("limit") ?? 50)));
    if (subpath === "/spans") return json(res, 200, slicePage(spans, url.searchParams.get("cursor"), Number(url.searchParams.get("limit") ?? 50)));
    if (subpath === "/metrics/overview") return json(res, 200, overview);
    if (subpath === "/conversations") return json(res, 200, slicePage(conversations, url.searchParams.get("cursor"), Number(url.searchParams.get("limit") ?? 50)));

    const traceMatch = subpath.match(/^\/traces\/([^/]+)$/);
    if (traceMatch) {
        const detail = detailByTrace[decodeURIComponent(traceMatch[1])];
        if (!detail) return problem(res, 404, "Not Found", `Trace ${traceMatch[1]} not found`);
        return json(res, 200, detail);
    }

    const treeMatch = subpath.match(/^\/conversations\/([^/]+)\/tree$/);
    if (treeMatch) {
        const id = decodeURIComponent(treeMatch[1]);
        if (!transcripts[id]) return problem(res, 404, "Not Found", `Conversation ${id} not found`);
        const items = traces.filter((trace) => trace.conversationId === id).map((trace) => detailByTrace[trace.traceId]);
        return json(res, 200, { items, nextCursor: null });
    }

    const transcriptMatch = subpath.match(/^\/conversations\/([^/]+)\/transcript$/);
    if (transcriptMatch) {
        const transcript = transcripts[decodeURIComponent(transcriptMatch[1])];
        if (!transcript) return problem(res, 404, "Not Found", `Conversation ${transcriptMatch[1]} not found`);
        return json(res, 200, transcript);
    }

    const conversationMatch = subpath.match(/^\/conversations\/([^/]+)$/);
    if (conversationMatch) {
        const id = decodeURIComponent(conversationMatch[1]);
        const conversation = conversations.find((item) => item.conversationId === id);
        if (!conversation) return problem(res, 404, "Not Found", `Conversation ${id} not found`);
        const turns = slicePage(traces.filter((trace) => trace.conversationId === id), url.searchParams.get("cursor"), Number(url.searchParams.get("limit") ?? 50));
        return json(res, 200, { ...conversation, turns });
    }

    return null;
}

async function handleIdentity(req, res, method, path, url) {
    if (path === "/me" && method === "GET") return json(res, 200, me);

    if (path === "/organizations" && method === "GET") return json(res, 200, { items: organizations });
    if (path === "/organizations" && method === "POST") {
        const { name } = await readJsonBody(req);
        const organization = { id: `org-${organizations.length + 1}`, name, myRole: "org_admin" };
        organizations.push(organization);
        orgMembers[organization.id] = { members: [{ userId: me.id, email: me.email, name: me.name, role: "org_admin" }], pendingInvitations: [] };
        return json(res, 201, organization);
    }

    const orgMembersMatch = path.match(/^\/organizations\/([^/]+)\/members$/);
    if (orgMembersMatch) {
        const organizationId = decodeURIComponent(orgMembersMatch[1]);
        if (method === "GET") {
            const record = orgMembers[organizationId];
            if (!record) return problem(res, 404, "Not Found", `Organization ${organizationId} not found`);
            return json(res, 200, record);
        }
        if (method === "POST") {
            const { email } = await readJsonBody(req);
            const record = orgMembers[organizationId] ?? { members: [], pendingInvitations: [] };
            record.pendingInvitations.push({ id: crypto.randomUUID(), email, role: "org_admin", createdAt: new Date().toISOString() });
            orgMembers[organizationId] = record;
            return json(res, 202, { organizationId, email, role: "org_admin", status: "pending" });
        }
    }

    const orgExperimentsMatch = path.match(/^\/organizations\/([^/]+)\/experiments$/);
    if (orgExperimentsMatch && method === "POST") {
        const organizationId = decodeURIComponent(orgExperimentsMatch[1]);
        const { name, serviceName } = await readJsonBody(req);
        const experiment = { id: `exp-${experiments.length + 1}`, organizationId, name, serviceName, myRole: "org_admin" };
        experiments.push(experiment);
        experimentMembers[experiment.id] = { members: [{ userId: me.id, email: me.email, name: me.name, role: "org_admin" }], pendingInvitations: [] };
        apiKeys[experiment.id] = [];
        return json(res, 201, experiment);
    }

    if (path === "/experiments" && method === "GET") return json(res, 200, { items: experiments });

    const expMembersMatch = path.match(/^\/experiments\/([^/]+)\/members$/);
    if (expMembersMatch) {
        const experimentId = decodeURIComponent(expMembersMatch[1]);
        if (method === "GET") {
            const record = experimentMembers[experimentId];
            if (!record) return problem(res, 404, "Not Found", `Experiment ${experimentId} not found`);
            return json(res, 200, record);
        }
        if (method === "POST") {
            const { email, role } = await readJsonBody(req);
            const record = experimentMembers[experimentId] ?? { members: [], pendingInvitations: [] };
            record.pendingInvitations.push({ id: crypto.randomUUID(), email, role, createdAt: new Date().toISOString() });
            experimentMembers[experimentId] = record;
            return json(res, 202, { experimentId, email, role, status: "pending" });
        }
    }

    const apiKeysMatch = path.match(/^\/experiments\/([^/]+)\/api-keys$/);
    if (apiKeysMatch) {
        const experimentId = decodeURIComponent(apiKeysMatch[1]);
        if (method === "GET") return json(res, 200, { items: apiKeys[experimentId] ?? [] });
        if (method === "POST") {
            const key = {
                id: crypto.randomUUID(),
                experimentId,
                keyPrefix: `mtk_${crypto.randomBytes(4).toString("hex")}`,
                createdAt: new Date().toISOString(),
                lastUsedAt: null,
            };
            apiKeys[experimentId] = [...(apiKeys[experimentId] ?? []), key];
            return json(res, 201, { ...key, plaintext: `${key.keyPrefix}_${crypto.randomBytes(16).toString("hex")}` });
        }
    }

    const apiKeyMatch = path.match(/^\/experiments\/([^/]+)\/api-keys\/([^/]+)$/);
    if (apiKeyMatch && method === "DELETE") {
        const [, experimentId, keyId] = apiKeyMatch;
        apiKeys[experimentId] = (apiKeys[experimentId] ?? []).filter((key) => key.id !== decodeURIComponent(keyId));
        return json(res, 200, { revoked: true });
    }

    return null;
}

async function handler(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (!url.pathname.startsWith("/api/v1")) {
        problem(res, 404, "Not Found");
        return;
    }

    const path = url.pathname.slice("/api/v1".length);
    const method = req.method ?? "GET";

    try {
        if (path === "/services" && method === "GET") return json(res, 200, services);

        const experimentScopedMatch = path.match(/^\/experiments\/([^/]+)(\/.*)$/);
        if (experimentScopedMatch && method === "GET") {
            const [, experimentId, subpath] = experimentScopedMatch;
            const handled = handleExperimentScoped(res, decodeURIComponent(experimentId), subpath, url);
            if (handled !== null) return;
        }

        const identityHandled = await handleIdentity(req, res, method, path, url);
        if (identityHandled !== null) return;

        problem(res, 404, "Not Found");
    } catch (error) {
        problem(res, 400, "Bad Request", error instanceof Error ? error.message : String(error));
    }
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
