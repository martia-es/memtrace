import { describe, expect, it, vi } from "vitest";
import { AnalyticsService } from "@/application/analytics-service";
import type { AnalyticsRepository } from "@/application/ports/analytics-repository";
import { ValidationError } from "@/domain/errors";
import { toPricingCatalog } from "@/domain/pricing";

const scope = { serviceName: "agent" } as never;
const repo = () => ({ rowsFor: vi.fn().mockResolvedValue({ groups: [], tokens: [], days: [] }) }) satisfies AnalyticsRepository;
const service = (r: AnalyticsRepository) => new AnalyticsService(r, async () => toPricingCatalog([]), () => 10 * 86_400_000);

describe("AnalyticsService", () => {
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
