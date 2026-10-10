import type { Evaluator, EvaluatorArgs, Score } from "./types.js";

/** Builds an evaluator from a name and a function (a function's own name is read-only, so this is the way to name one). */
export function evaluator(name: string, fn: (args: EvaluatorArgs) => Score | Score[] | Promise<Score | Score[]>): Evaluator {
  return Object.defineProperty((args: EvaluatorArgs) => fn(args), "name", { value: name }) as Evaluator;
}

const noExpectation = (name: string): Score => ({ name, value: false, dataType: "boolean", comment: "no expected_output to compare" });

/** True if `output` deeply equals `expectedOutput` (false, with a comment, if there is no expectation). */
export const exactMatch = evaluator("exact_match", ({ output, expectedOutput }) =>
  expectedOutput == null
    ? noExpectation("exact_match")
    : { name: "exact_match", value: JSON.stringify(output) === JSON.stringify(expectedOutput), dataType: "boolean" });

/** True if the (stringified) expected output appears in the (stringified) output. */
export const contains = evaluator("contains", ({ output, expectedOutput }) =>
  expectedOutput == null
    ? noExpectation("contains")
    : { name: "contains", value: String(output).includes(String(expectedOutput)), dataType: "boolean" });
