/**
 * LLM-as-judge evaluators (ADR-029): a rubric (`buildPrompt`) plus a shared way of calling any `LLMClient` and turning its
 * answer into a `Score`. A malformed answer throws; the runner records that as an error score for just that item.
 */
import { createHash } from "node:crypto";
import type { EvaluatorArgs, LLMClient, LLMReply, Score } from "./types.js";

const RESPONSE_INSTRUCTIONS =
  'Respond with a single JSON object and nothing else, of the shape {"score": true or false, "reasoning": "<one sentence>"}.';

export interface JudgeInput {
  input: unknown;
  output: unknown;
  expectedOutput?: unknown;
  metadata?: Record<string, unknown>;
}

/** Stand-in for `metadata` when fingerprinting a template: any key resolves to `"{key}"`. */
const placeholders = (): Record<string, unknown> => new Proxy({}, { get: (_t, key) => (typeof key === "string" ? `{${key}}` : undefined) });

const text = (value: unknown): string => (value === undefined || value === null ? "None" : typeof value === "string" ? value : JSON.stringify(value));

export abstract class LLMJudgeEvaluator {
  abstract readonly name: string;
  protected readonly client: LLMClient;
  protected readonly model?: string;

  constructor(options: { client: LLMClient; model?: string }) {
    this.client = options.client;
    this.model = options.model;
  }

  /** The rubric-specific user prompt asking the LLM to judge `output`. */
  abstract buildPrompt(args: JudgeInput): string;

  /** Model that judges: the explicit `model`, else the client's default. */
  judgeModel(): string | undefined {
    return this.model ?? this.client.model;
  }

  /** Short, stable fingerprint of the rubric (ADR-043): system prompt plus the template rendered with placeholders. Same value as the Python SDK's. */
  promptHash(): string {
    let skeleton: string;
    try {
      skeleton = this.buildPrompt({ input: "{input}", output: "{output}", expectedOutput: "{expected_output}", metadata: placeholders() });
    } catch {
      skeleton = `<${this.constructor.name}>`;
    }
    return createHash("sha256").update(`${this.systemPrompt()}\x00${skeleton}`).digest("hex").slice(0, 16);
  }

  /** Override to change the judge's persona; keep the JSON response contract. */
  systemPrompt(): string {
    return `You are a strict, impartial evaluator. ${RESPONSE_INSTRUCTIONS}`;
  }

  async evaluate({ input, output, expectedOutput, metadata }: EvaluatorArgs): Promise<Score> {
    const prompt = this.buildPrompt({ input, output, expectedOutput, metadata });
    const raw = await this.client.complete({ system: this.systemPrompt(), prompt, model: this.model });
    const reply: LLMReply = typeof raw === "string" ? { text: raw } : raw;
    const parsed = parseResponse(reply.text);
    return {
      name: this.name,
      value: Boolean(parsed.score),
      dataType: "boolean",
      source: "llm_judge",
      comment: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
      judgeModel: reply.model ?? this.judgeModel(),
      judgePromptHash: this.promptHash(),
    };
  }
}

function parseResponse(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM judge returned non-JSON output: ${JSON.stringify(raw)}`);
  }
  if (typeof parsed !== "object" || parsed === null || !("score" in parsed)) throw new Error(`LLM judge response missing 'score': ${JSON.stringify(raw)}`);
  return parsed as Record<string, unknown>;
}

/** Judges whether `output` is correct by comparing it with `expectedOutput` *semantically*: the wording need not match. */
export class Correctness extends LLMJudgeEvaluator {
  readonly name = "correctness";
  buildPrompt({ input, output, expectedOutput }: JudgeInput): string {
    return (
      `Question:\n${text(input)}\n\n` +
      `Expected answer:\n${text(expectedOutput)}\n\n` +
      `Given answer:\n${text(output)}\n\n` +
      "Is the given answer correct, i.e. does it convey the same meaning as the expected " +
      "answer even if worded differently? Judge correctness only, ignore style."
    );
  }
}

/** Judges whether `output` is grounded in a source context, with no unsupported claims. Needs `metadata: { context }` on the item. */
export class Faithfulness extends LLMJudgeEvaluator {
  readonly name = "faithfulness";
  buildPrompt({ input, output, metadata }: JudgeInput): string {
    const context = metadata?.context;
    if (!context) {
      throw new Error("Faithfulness needs metadata: { context } on the item: the source text the output is supposed to be grounded in.");
    }
    return (
      `Context:\n${text(context)}\n\n` +
      `Question:\n${text(input)}\n\n` +
      `Answer:\n${text(output)}\n\n` +
      "Is every claim in the answer supported by the context, with no invented facts? " +
      "A partially unsupported answer is not faithful."
    );
  }
}
