import { describe, expect, it } from "vitest";
import { interAnnotatorAgreementQuery, judgeHumanAgreementQuery } from "@/adapters/inbound/http/schemas";

const uuid = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("judgeHumanAgreementQuery (ADR-040)", () => {
  it("accepts exactly one of datasetRunId or queueId, with an optional name", () => {
    expect(judgeHumanAgreementQuery.safeParse({ datasetRunId: uuid }).success).toBe(true);
    expect(judgeHumanAgreementQuery.safeParse({ queueId: uuid, name: "correctness" }).success).toBe(true);
  });

  it("rejects an unbounded scope, both scopes at once and malformed ids", () => {
    expect(judgeHumanAgreementQuery.safeParse({}).success).toBe(false);
    expect(judgeHumanAgreementQuery.safeParse({ name: "correctness" }).success).toBe(false);
    expect(judgeHumanAgreementQuery.safeParse({ datasetRunId: uuid, queueId: other }).success).toBe(false);
    expect(judgeHumanAgreementQuery.safeParse({ datasetRunId: "nope" }).success).toBe(false);
    expect(judgeHumanAgreementQuery.safeParse({ datasetRunId: uuid, name: "" }).success).toBe(false);
  });
});

describe("interAnnotatorAgreementQuery", () => {
  it("requires a queue", () => {
    expect(interAnnotatorAgreementQuery.safeParse({ queueId: uuid }).success).toBe(true);
    expect(interAnnotatorAgreementQuery.safeParse({}).success).toBe(false);
  });
});
