import { describe, expect, it } from "vitest";
import { z } from "zod";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseQueryOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { approvalRuleQuery } from "@/adapters/inbound/http/prompt-schemas";
import { ValidationError } from "@/domain/errors";

const req = (query: string) => new Request(`http://localhost/api/v1/x${query}`);

describe("parseQueryOrThrow", () => {
  it("returns the parsed query", () => {
    expect(parseQueryOrThrow(approvalRuleQuery, req("?action=promote&stage=pro"))).toEqual({ action: "promote", stage: "pro" });
    expect(parseQueryOrThrow(approvalRuleQuery, req("?action=publish"))).toEqual({ action: "publish", stage: "" });
  });

  it("turns an invalid parameter into a ValidationError with the reason per field", () => {
    try {
      parseQueryOrThrow(approvalRuleQuery, req("?action=deploy"));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(Object.keys((error as ValidationError).fields ?? {})).toEqual(["action"]);
    }
  });

  it("is answered as a 400, not a 500, by the identity guard", async () => {
    const response = await identityGuard(async () => {
      parseQueryOrThrow(z.object({ n: z.coerce.number().int() }), req("?n=abc"));
      return new Response("ok");
    });
    expect(response.status).toBe(400);
  });
});
