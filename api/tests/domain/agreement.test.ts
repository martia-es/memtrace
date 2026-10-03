import { describe, expect, it } from "vitest";
import {
  cohenKappa,
  computeInterAnnotator,
  computeJudgeHuman,
  parseValue,
  pearson,
  ranks,
  spearman,
  type HumanLabel,
  type JudgeLabel,
} from "@/domain/agreement";

/** Repite una pareja (juez, humano) `count` veces con objetivos nuevos. */
function pairs(spec: Array<[judge: string, human: string, count: number]>): { judge: JudgeLabel[]; human: HumanLabel[] } {
  const judge: JudgeLabel[] = [];
  const human: HumanLabel[] = [];
  let id = 0;
  for (const [j, h, count] of spec) {
    for (let i = 0; i < count; i++) {
      const target = `t${id++}`;
      judge.push({ target, value: j });
      human.push({ target, annotatorId: "u1", value: h });
    }
  }
  return { judge, human };
}

describe("cohenKappa", () => {
  it("matches the textbook example (po 0.7, pe 0.5 → 0.4)", () => {
    const a: string[] = [];
    const b: string[] = [];
    const add = (x: string, y: string, count: number) => {
      for (let i = 0; i < count; i++) {
        a.push(x);
        b.push(y);
      }
    };
    add("yes", "yes", 20);
    add("yes", "no", 5);
    add("no", "yes", 10);
    add("no", "no", 15);
    expect(cohenKappa(a, b)).toBeCloseTo(0.4, 10);
  });

  it("is 1 for perfect agreement with variance and 0 for agreement at chance level", () => {
    expect(cohenKappa(["a", "b", "a", "b"], ["a", "b", "a", "b"])).toBe(1);
    expect(cohenKappa(["a", "a", "b", "b"], ["a", "b", "a", "b"])).toBeCloseTo(0, 10);
  });

  it("is null (never NaN) when both sides are constant and equal", () => {
    expect(cohenKappa(["a", "a", "a"], ["a", "a", "a"])).toBeNull();
  });

  it("is 0, not null, when both are constant but different", () => {
    expect(cohenKappa(["a", "a"], ["b", "b"])).toBe(0);
  });

  it("is null for empty or mismatched input", () => {
    expect(cohenKappa([], [])).toBeNull();
    expect(cohenKappa(["a"], [])).toBeNull();
  });
});

describe("correlations", () => {
  it("ranks give the mean rank to ties", () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("pearson and spearman on a perfect monotonic (non-linear) relation", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [1, 4, 9, 16, 25];
    expect(spearman(x, y)).toBeCloseTo(1, 10);
    expect(pearson(x, y)!).toBeLessThan(1);
    expect(pearson(x, y)!).toBeGreaterThan(0.95);
  });

  it("are null with no variance or fewer than two points", () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2, 3], [4, 4, 4])).toBeNull();
    expect(pearson([1], [1])).toBeNull();
  });
});

describe("parseValue", () => {
  it("rejects malformed values instead of coercing", () => {
    expect(parseValue("numeric", "abc")).toBeNull();
    expect(parseValue("numeric", "")).toBeNull();
    expect(parseValue("numeric", "Infinity")).toBeNull();
    expect(parseValue("numeric", " 3.5 ")).toBe(3.5);
    expect(parseValue("boolean", "True")).toBeNull();
    expect(parseValue("boolean", "true")).toBe("true");
    expect(parseValue("categorical", "")).toBeNull();
  });
});

describe("computeJudgeHuman — boolean", () => {
  it("returns agreement, kappa, binary confusion with the human as reference", () => {
    // juez, humano: 20 TP, 5 FP (juez true, humano false), 10 FN (juez false, humano true), 15 TN
    const { judge, human } = pairs([
      ["true", "true", 20],
      ["true", "false", 5],
      ["false", "true", 10],
      ["false", "false", 15],
    ]);
    const m = computeJudgeHuman({ name: "ok", judgeDataType: "boolean", humanDataType: "boolean", judge, human });
    expect(m.status).toBe("ok");
    expect(m.n).toBe(50);
    expect(m.percentAgreement).toBeCloseTo(0.7, 10);
    expect(m.kappa).toBeCloseTo(0.4, 10);
    expect(m.binary).toEqual({ tp: 20, fp: 5, fn: 10, tn: 15 });
    expect(m.confusion).toEqual({ labels: ["true", "false"], matrix: [[20, 10], [5, 15]] });
    expect(m.lowSample).toBe(false);
    expect(m.disagreements).toHaveLength(15);
  });

  it("a judge that always says true on skewed data: high agreement, kappa 0", () => {
    const { judge, human } = pairs([
      ["true", "true", 19],
      ["true", "false", 1],
    ]);
    const m = computeJudgeHuman({ name: "ok", judgeDataType: "boolean", humanDataType: "boolean", judge, human });
    expect(m.percentAgreement).toBeCloseTo(0.95, 10);
    expect(m.kappa).toBeCloseTo(0, 10);
  });

  it("reports no_variance when both sides are constant and equal", () => {
    const { judge, human } = pairs([["true", "true", 25]]);
    const m = computeJudgeHuman({ name: "ok", judgeDataType: "boolean", humanDataType: "boolean", judge, human });
    expect(m.kappa).toBeNull();
    expect(m.kappaReason).toBe("no_variance");
    expect(m.percentAgreement).toBe(1);
  });

  it("flags low sample below the default minimum of 20 but still returns numbers", () => {
    const { judge, human } = pairs([
      ["true", "true", 3],
      ["false", "true", 1],
    ]);
    const m = computeJudgeHuman({ name: "ok", judgeDataType: "boolean", humanDataType: "boolean", judge, human });
    expect(m.lowSample).toBe(true);
    expect(m.n).toBe(4);
    expect(m.percentAgreement).toBe(0.75);
    expect(computeJudgeHuman({ name: "ok", judgeDataType: "boolean", humanDataType: "boolean", judge, human, minSample: 4 }).lowSample).toBe(false);
  });

  it("uses the majority of several annotators, excludes ties and counts them", () => {
    const judge: JudgeLabel[] = [
      { target: "a", value: "true" },
      { target: "b", value: "true" },
      { target: "c", value: "true" },
    ];
    const human: HumanLabel[] = [
      { target: "a", annotatorId: "u1", value: "true" },
      { target: "a", annotatorId: "u2", value: "true" },
      { target: "a", annotatorId: "u3", value: "false" }, // mayoría true
      { target: "b", annotatorId: "u1", value: "true" },
      { target: "b", annotatorId: "u2", value: "false" }, // empate
    ];
    const m = computeJudgeHuman({ name: "ok", judgeDataType: "boolean", humanDataType: "boolean", judge, human });
    expect(m.n).toBe(1);
    expect(m.excluded).toEqual({ ties: 1, noHuman: 1, noJudge: 0, invalid: 0 });
    expect(m.percentAgreement).toBe(1);
  });

  it("counts targets present on only one side", () => {
    const m = computeJudgeHuman({
      name: "ok",
      judgeDataType: "boolean",
      humanDataType: "boolean",
      judge: [{ target: "a", value: "true" }],
      human: [{ target: "z", annotatorId: "u1", value: "true" }],
    });
    expect(m.n).toBe(0);
    expect(m.excluded).toMatchObject({ noHuman: 1, noJudge: 1 });
    expect(m.percentAgreement).toBeNull();
  });

  it("counts malformed values as invalid and never lets them through", () => {
    const m = computeJudgeHuman({
      name: "ok",
      judgeDataType: "boolean",
      humanDataType: "boolean",
      judge: [{ target: "a", value: "yes" }, { target: "b", value: "true" }],
      human: [{ target: "a", annotatorId: "u1", value: "true" }, { target: "b", annotatorId: "u1", value: "true" }],
    });
    expect(m.excluded.invalid).toBe(1);
    expect(m.n).toBe(1);
  });
});

describe("computeJudgeHuman — categorical", () => {
  it("builds the full confusion matrix with sorted labels", () => {
    const { judge, human } = pairs([
      ["good", "good", 10],
      ["bad", "good", 2],
      ["ok", "bad", 3],
      ["bad", "bad", 5],
    ]);
    const m = computeJudgeHuman({ name: "q", judgeDataType: "categorical", humanDataType: "categorical", judge, human });
    expect(m.confusion!.labels).toEqual(["bad", "good", "ok"]);
    // filas = humano, columnas = juez
    expect(m.confusion!.matrix).toEqual([
      [5, 0, 3],
      [2, 10, 0],
      [0, 0, 0],
    ]);
    expect(m.percentAgreement).toBeCloseTo(15 / 20, 10);
    expect(m.binary).toBeUndefined();
  });
});

describe("computeJudgeHuman — numeric", () => {
  it("returns MAE, correlations and within ±1", () => {
    const humanValues = [1, 2, 3, 4, 5];
    const judgeValues = [1, 3, 3, 5, 2];
    const judge = judgeValues.map((v, i) => ({ target: `t${i}`, value: String(v) }));
    const human = humanValues.map((v, i) => ({ target: `t${i}`, annotatorId: "u1", value: String(v) }));
    const m = computeJudgeHuman({ name: "score", judgeDataType: "numeric", humanDataType: "numeric", judge, human });
    expect(m.mae).toBeCloseTo((0 + 1 + 0 + 1 + 3) / 5, 10);
    expect(m.withinOne).toBeCloseTo(4 / 5, 10);
    expect(m.percentAgreement).toBeCloseTo(2 / 5, 10);
    expect(m.pearson).not.toBeNull();
    expect(m.spearman).not.toBeNull();
    expect(m.disagreements).toEqual([{ target: "t4", judge: "2", human: "5" }]);
  });

  it("averages several annotators instead of voting", () => {
    const m = computeJudgeHuman({
      name: "score",
      judgeDataType: "numeric",
      humanDataType: "numeric",
      judge: [{ target: "a", value: "4" }],
      human: [
        { target: "a", annotatorId: "u1", value: "3" },
        { target: "a", annotatorId: "u2", value: "5" },
      ],
    });
    expect(m.mae).toBe(0);
    expect(m.excluded.ties).toBe(0);
  });

  it("leaves correlations null when one side has no variance", () => {
    const judge = [1, 2, 3].map((v, i) => ({ target: `t${i}`, value: String(v) }));
    const human = [3, 3, 3].map((v, i) => ({ target: `t${i}`, annotatorId: "u1", value: String(v) }));
    const m = computeJudgeHuman({ name: "score", judgeDataType: "numeric", humanDataType: "numeric", judge, human });
    expect(m.pearson).toBeNull();
    expect(m.spearman).toBeNull();
    expect(m.mae).toBeCloseTo(1, 10);
  });
});

describe("computeJudgeHuman — incomparable", () => {
  it("does not compute when the data types differ", () => {
    const m = computeJudgeHuman({
      name: "x",
      judgeDataType: "boolean",
      humanDataType: "numeric",
      judge: [{ target: "a", value: "true" }],
      human: [{ target: "a", annotatorId: "u1", value: "1" }],
    });
    expect(m.status).toBe("incomparable");
    expect(m.reason).toContain("boolean");
    expect(m.n).toBe(0);
    expect(m.kappa).toBeNull();
  });
});

describe("computeInterAnnotator", () => {
  it("averages pairwise kappa across annotator pairs", () => {
    // u1 y u2 coinciden siempre; u3 es el opuesto de u1 en todos
    const labels: HumanLabel[] = [];
    const values = ["true", "false", "true", "false"];
    values.forEach((v, i) => {
      labels.push({ target: `t${i}`, annotatorId: "u1", value: v });
      labels.push({ target: `t${i}`, annotatorId: "u2", value: v });
      labels.push({ target: `t${i}`, annotatorId: "u3", value: v === "true" ? "false" : "true" });
    });
    const m = computeInterAnnotator({ name: "ok", dataType: "boolean", labels });
    expect(m.annotators).toBe(3);
    expect(m.n).toBe(4);
    expect(m.pairs).toBe(3);
    // pares: (u1,u2)=1, (u1,u3)=-1, (u2,u3)=-1
    expect(m.meanPairwiseKappa).toBeCloseTo(-1 / 3, 10);
    expect(m.lowSample).toBe(true);
  });

  it("uses Spearman for numeric labels", () => {
    const labels: HumanLabel[] = [];
    [1, 2, 3, 4].forEach((v, i) => {
      labels.push({ target: `t${i}`, annotatorId: "u1", value: String(v) });
      labels.push({ target: `t${i}`, annotatorId: "u2", value: String(v * 10) });
    });
    const m = computeInterAnnotator({ name: "s", dataType: "numeric", labels, minSample: 4 });
    expect(m.meanPairwiseSpearman).toBeCloseTo(1, 10);
    expect(m.meanPairwiseKappa).toBeUndefined();
    expect(m.lowSample).toBe(false);
  });

  it("returns a null mean when no pair shares a target or has variance", () => {
    const m = computeInterAnnotator({
      name: "ok",
      dataType: "boolean",
      labels: [
        { target: "a", annotatorId: "u1", value: "true" },
        { target: "b", annotatorId: "u2", value: "true" },
      ],
    });
    expect(m.annotators).toBe(2);
    expect(m.n).toBe(0);
    expect(m.pairs).toBe(0);
    expect(m.meanPairwiseKappa).toBeNull();
  });

  it("ignores invalid values and keeps the last label of a repeated target", () => {
    const m = computeInterAnnotator({
      name: "ok",
      dataType: "boolean",
      labels: [
        { target: "a", annotatorId: "u1", value: "nope" },
        { target: "a", annotatorId: "u2", value: "true" },
      ],
    });
    expect(m.annotators).toBe(1);
    expect(m.n).toBe(0);
  });
});
