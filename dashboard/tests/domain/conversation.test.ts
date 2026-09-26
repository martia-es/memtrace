import { describe, expect, it } from "vitest";
import { withGaps } from "@/domain/conversation";
import { summary } from "../fakes";

const turn = (start: string, durationMs: number) => summary({ traceId: start.padEnd(32, "0"), startTime: start, durationMs });

describe("withGaps", () => {
  it("numbers turns and computes the wait after the previous turn ends", () => {
    const turns = withGaps([
      turn("2026-01-01T10:00:00.000Z", 2000), // termina 10:00:02
      turn("2026-01-01T10:00:10.000Z", 500), // espera 8 s
      turn("2026-01-01T10:00:10.200Z", 100), // empieza antes de que acabe el anterior => solapa
    ]);
    expect(turns.map((t) => t.index)).toEqual([1, 2, 3]);
    expect(turns[0]!.gapMs).toBeNull();
    expect(turns[1]!.gapMs).toBe(8000);
    expect(turns[2]!.gapMs).toBeLessThan(0);
  });

  it("handles an empty list", () => expect(withGaps([])).toEqual([]));
});
