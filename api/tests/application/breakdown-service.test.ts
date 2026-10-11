import { describe, expect, it, vi } from "vitest";
import { BreakdownService } from "@/application/breakdown-service";
import type { BreakdownRepository } from "@/application/ports/breakdown-repository";
import { ValidationError } from "@/domain/errors";
import { toPricingCatalog } from "@/domain/pricing";

const scope = { serviceName: "agent" } as never;
const repo = () => ({ rowsFor: vi.fn().mockResolvedValue({ groups: [], tokens: [], days: [] }) }) satisfies BreakdownRepository;
const service = (r: BreakdownRepository) => new BreakdownService(r, async () => toPricingCatalog([]), () => 10 * 86_400_000);

describe("BreakdownService", () => {
  it("asks the repository for the chosen grouping over the resolved range", async () => {
    const r = repo();
    const a = await service(r).breakdown(scope, { groupBy: "environment" });
    expect(r.rowsFor).toHaveBeenCalledWith(expect.objectContaining({ groupBy: "environment", scope }));
    expect(a.groupBy).toBe("environment");
    expect(a.items).toEqual([]);
  });

  it("rejects an inverted range before touching the store", async () => {
    const r = repo();
    await expect(service(r).breakdown(scope, { groupBy: "prompt_version", from: new Date(5000), to: new Date(1000) })).rejects.toBeInstanceOf(ValidationError);
    expect(r.rowsFor).not.toHaveBeenCalled();
  });
});
