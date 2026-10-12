export { initTracer, flush, annotateCurrent, onShutdown, shutdown, session, currentSessionId, user, currentUserId, currentTraceId, withStep, traceStep, traceLlmCall, recordRetrievedChunks, isTracing, startRun, endRun, annotateRun, expireStaleRuns, activeRuns, capture, capturesContent } from "./tracer.js";
export type { InitOptions, Step, LlmCallOptions, StartRunOptions } from "./tracer.js";
export { sc } from "./semconv.js";
export type { StepType } from "./semconv.js";
export { REDACTED } from "./redaction.js";
export type { RedactHook } from "./redaction.js";
export { feedback, retractFeedback } from "./feedback.js";
export type { FeedbackOptions, Rating } from "./feedback.js";
export { MemTraceHttpError } from "./http/client.js";
export * as prompts from "./prompts/index.js";
export { runExperiment, ResultsUploadError } from "./eval/runExperiment.js";
export type { DataInput, RunExperimentOptions } from "./eval/runExperiment.js";
export { evaluator, exactMatch, contains } from "./eval/builtins.js";
export { RecallAtK, MRR, HitRate, recallAtK, reciprocalRank } from "./eval/retrievalMetrics.js";
export { Correctness, Faithfulness, LLMJudgeEvaluator } from "./eval/judges.js";
export { InMemoryDatasetSource, LocalFileDatasetSource, MemTraceDatasetSource } from "./eval/datasets.js";
export { MemTraceResultsSink } from "./eval/sink.js";
export { ExperimentResult } from "./eval/types.js";
export type {
  DatasetSource, EvalItem, EvalItemResult, Evaluator, EvaluatorArgs, EvaluatorLike, IncrementalResultsSink, LLMClient, LLMReply,
  ResultsSink, RetrievedChunk, Score, ScoreDataType, ScoreSource, ScoreSummary, TaskFunction,
} from "./eval/types.js";
export { presidioRedactor, textHook, maskRanges, DEFAULT_ENTITIES } from "./pii.js";
export type { PresidioOptions } from "./pii.js";
// building blocks for integrations (`@memtrace-ai/sdk/langchain`, `@memtrace-ai/sdk/openai-agents`, or your own)
export { llmAttributes, retrievedChunks, sanitize as sanitizeAttributes } from "./attributes.js";
export type { Attributes, LlmCall } from "./attributes.js";
export { noteRetrieved } from "./eval/retrievalScope.js";
