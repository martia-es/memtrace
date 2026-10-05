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
        title: "Plan the next step for the Lisbon trip",
        costUsd: 0.0412,
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
        title: null,
        costUsd: null,
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

// --- Evaluación, revisión y precios (ADR-031/039/025/049): lo justo para recorrer todas las pantallas -----------------

overview.byTopic = [];
overview.totals.costUsd = 12.34;
overview.byModel[0].costUsd = 12.34;

const scoreConfigs = [
    { id: "cfg-1", name: "Helpfulness", dataType: "numeric", minValue: 1, maxValue: 5, categories: null, description: "How useful the reply is", createdAt: "2026-09-20T09:00:00.000Z", updatedAt: "2026-09-20T09:00:00.000Z", archivedAt: null },
];
const queues = [
    { id: "q1", name: "Support answers · weekly QA", instructions: "Judge only what the reply says.", requiredAnnotations: 2, reviewerIds: ["u1", "u2"], rubric: [{ configId: "cfg-1", required: true }], createdAt: "2026-10-01T10:00:00.000Z", archivedAt: null, progress: { pending: 16, completed: 8, skipped: 0 } },
    { id: "q2", name: "Low-rated by users", instructions: null, requiredAnnotations: 1, reviewerIds: ["u1", "u2"], rubric: [{ configId: "cfg-1", required: true }], createdAt: "2026-10-02T10:00:00.000Z", archivedAt: null, progress: { pending: 8, completed: 3, skipped: 0 } },
    { id: "q3", name: "Sensitive data check", instructions: null, requiredAnnotations: 1, reviewerIds: ["u1", "u2"], rubric: [{ configId: "cfg-1", required: true }], createdAt: "2026-09-20T10:00:00.000Z", archivedAt: null, progress: { pending: 0, completed: 40, skipped: 0 } },
];
const mockLabel = (userId, name, value, comment = null) => ({ userId, name, value, comment, createdAt: "2026-10-04T10:00:00.000Z", isReviewer: true });
const queueResults = {
    configs: scoreConfigs.slice(0, 1),
    total: 2,
    items: [
        { id: "ri1", targetType: "trace", traceId: traces[0]?.traceId ?? "t1", datasetRunId: null, itemIndex: null, status: "completed", population: "manual", addedAt: "2026-10-04T09:00:00.000Z", completedAt: "2026-10-04T10:00:00.000Z", needsResolution: false, promotedTo: [{ datasetId: "d1", datasetName: "Refund questions", version: "1.3" }], criteria: [{ configId: scoreConfigs[0]?.id ?? "cfg-1", status: "consensus", labels: [mockLabel("u1", "Ana", "4"), mockLabel("u2", "Luis", "5")], resolution: null }] },
        { id: "ri2", targetType: "trace", traceId: traces[1]?.traceId ?? "t2", datasetRunId: null, itemIndex: null, status: "completed", population: "manual", addedAt: "2026-10-04T09:00:00.000Z", completedAt: "2026-10-04T10:05:00.000Z", needsResolution: true, promotedTo: [], criteria: [{ configId: scoreConfigs[0]?.id ?? "cfg-1", status: "disagreement", labels: [mockLabel("u1", "Ana", "1", "Wrong hour"), mockLabel("u2", "Luis", "5")], resolution: null }] },
    ],
};
const aggregate = (average) => ({ name: "accuracy", dataType: "numeric", passRate: null, average, count: 120, judges: [] });
const runs = [
    { id: "r1", name: "prompt-v7 vs prompt-v6", versionMajor: 1, versionMinor: 2, itemCount: 120, status: "completed", createdAt: "2026-10-04T09:14:00.000Z", aggregates: [aggregate(0.902)], datasetId: "d1", datasetName: "Refund questions" },
    { id: "r2", name: "prompt-v6 baseline", versionMajor: 1, versionMinor: 2, itemCount: 120, status: "completed", createdAt: "2026-10-03T17:22:00.000Z", aggregates: [aggregate(0.861)], datasetId: "d1", datasetName: "Refund questions" },
    { id: "r3", name: "Prompt v8 draft", versionMajor: 1, versionMinor: 3, itemCount: 31, status: "running", createdAt: "2026-10-04T10:00:00.000Z", aggregates: [], datasetId: "d1", datasetName: "Refund questions" },
];
const datasets = [
    { id: "d1", name: "Refund questions", createdAt: "2026-09-18T09:00:00.000Z", runCount: 3, versionCount: 3, latestVersionMajor: 1, latestVersionMinor: 3, lastRun: null },
    { id: "d2", name: "Weather basics", createdAt: "2026-09-10T09:00:00.000Z", runCount: 0, versionCount: 1, latestVersionMajor: 2, latestVersionMinor: 0, lastRun: null },
];
const modelPricing = [
    { modelId: "gpt-5.4-mini", provider: "openai", inputPricePerToken: 0.00000025, outputPricePerToken: 0.000002, source: "litellm", updatedAt: "2026-10-04T03:00:00.000Z" },
    { modelId: "claude-haiku-4-5", provider: "anthropic", inputPricePerToken: 0.000001, outputPricePerToken: 0.000005, source: "litellm", updatedAt: "2026-10-04T03:00:00.000Z" },
];
const versionsOf = (datasetId) => [
    { id: `${datasetId}-v3`, major: 1, minor: 2, note: "Edited 2 items", createdByEmail: me.email, createdAt: "2026-10-02T09:00:00.000Z", itemCount: 3, addedCount: 0, modifiedCount: 2, removedCount: 0 },
    { id: `${datasetId}-v2`, major: 1, minor: 1, note: "Added an item", createdByEmail: me.email, createdAt: "2026-09-25T09:00:00.000Z", itemCount: 3, addedCount: 1, modifiedCount: 0, removedCount: 0 },
    { id: `${datasetId}-v1`, major: 1, minor: 0, note: null, createdByEmail: me.email, createdAt: "2026-09-18T09:00:00.000Z", itemCount: 2, addedCount: 2, modifiedCount: 0, removedCount: 0 },
];
const datasetItems = (datasetId) => ["Refund for a cancelled flight", "How long do refunds take?", "Can I change my seat?"].map((input, i) => ({
    id: `${datasetId}-item-${i + 1}`, datasetVersionId: `${datasetId}-v3`, input, expectedOutput: "Refunds arrive within 14 business days.", metadata: null,
    createdByEmail: me.email, createdAt: "2026-09-18T09:00:00.000Z", updatedByEmail: null, updatedAt: null, deletedByEmail: null, deletedAt: null,
}));
const runDetail = (runId) => ({
    dataset: { id: "d1", name: "Refund questions" },
    run: runs.find((r) => r.id === runId) ?? runs[0],
    items: [
        { itemIndex: 0, input: "Refund for a cancelled flight", expectedOutput: "Within 14 business days", output: "Within 14 business days", traceId: null, error: null, telemetry: { latencyMs: 1200, inputTokens: 800, outputTokens: 90, costUsd: 0.002 }, scores: [{ name: "accuracy", value: "1", dataType: "numeric", source: "code", comment: null }] },
        { itemIndex: 1, input: "How long do refunds take?", expectedOutput: "Within 14 business days", output: "About a week", traceId: null, error: null, telemetry: { latencyMs: 4800, inputTokens: 900, outputTokens: 60, costUsd: 0.003 }, scores: [{ name: "accuracy", value: "0", dataType: "numeric", source: "code", comment: null }] },
    ],
});
const queueDetail = (queueId) => ({
    ...(queues.find((q) => q.id === queueId) ?? queues[0]),
    configs: scoreConfigs,
    reviewers: [{ userId: me.id, name: me.name, completed: 8, skipped: 0, inProgress: 1 }],
});
const nextQueueItem = { item: { id: "qi-1", targetType: "trace", traceId: "t-000222222222222222222222222222", datasetRunId: null, itemIndex: null, status: "pending", population: "manual", addedAt: "2026-10-03T10:00:00.000Z", completedAt: null } };
const lowRated = { count: 3, items: [{ traceId: "t-000222222222222222222222222222", configName: "Helpfulness", value: "1", createdAt: "2026-09-26T11:40:00.000Z" }] };

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
    if (subpath === "/annotation-queues") return json(res, 200, { items: queues.map((q) => ({ ...q, isReviewer: true })) });
    if (subpath === "/annotations/low-rated") return json(res, 200, lowRated);
    if (subpath === "/score-configs") return json(res, 200, { items: scoreConfigs });
    if (subpath === "/runs") return json(res, 200, { items: runs });
    if (subpath === "/reports") return json(res, 200, { items: [] });
    if (subpath === "/datasets") return json(res, 200, { items: datasets });
    const resultsMatch = subpath.match(/^\/annotation-queues\/([^/]+)\/results$/);
    if (resultsMatch) return json(res, 200, queueResults);
    const traceQueuesMatch = subpath.match(/^\/traces\/([^/]+)\/queues$/);
    if (traceQueuesMatch) return json(res, 200, { items: [{ queueId: "q1", queueName: "Support answers · weekly QA", archived: false, itemStatus: "completed" }] });
    const queueMatch = subpath.match(/^\/annotation-queues\/([^/]+)$/);
    if (queueMatch) return json(res, 200, queueDetail(decodeURIComponent(queueMatch[1])));
    const datasetMatch = subpath.match(/^\/datasets\/([^/]+)(\/.*)?$/);
    if (datasetMatch) {
        const datasetId = decodeURIComponent(datasetMatch[1]);
        const rest = datasetMatch[2] ?? "";
        const dataset = datasets.find((d) => d.id === datasetId);
        if (!dataset) return problem(res, 404, "Not Found", `Dataset ${datasetId} not found`);
        if (rest === "") return json(res, 200, dataset);
        if (rest === "/versions") return json(res, 200, { items: versionsOf(datasetId) });
        if (rest === "/items" || rest.endsWith("/items")) return json(res, 200, { items: datasetItems(datasetId) });
        if (rest === "/runs") return json(res, 200, { items: runs.filter((r) => r.datasetId === datasetId) });
        const runMatch = rest.match(/^\/runs\/([^/]+)$/);
        if (runMatch) return json(res, 200, runDetail(decodeURIComponent(runMatch[1])));
    }
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
        if (path === "/model-pricing" && method === "GET") return json(res, 200, { items: modelPricing });

        const experimentScopedMatch = path.match(/^\/experiments\/([^/]+)(\/.*)$/);
        if (experimentScopedMatch && method === "GET") {
            const [, experimentId, subpath] = experimentScopedMatch;
            const handled = handleExperimentScoped(res, decodeURIComponent(experimentId), subpath, url);
            if (handled !== null) return;
        }

        const nextMatch = path.match(/^\/experiments\/[^/]+\/annotation-queues\/[^/]+\/next$/);
        if (nextMatch && method === "POST") return json(res, 200, nextQueueItem);

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
