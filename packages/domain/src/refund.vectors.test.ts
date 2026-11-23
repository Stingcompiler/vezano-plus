import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DomainError } from "./money";
import {
  allocateInvoiceDiscount,
  refundSplit,
  returnLineValueMinor,
  returnValueCapMinor,
} from "./refund";

interface Channels {
  credit: string;
  bank: string;
  cash: string;
}
interface Vectors {
  allocate: { lines: [string, string][]; discount: string; net?: string[]; error?: string }[];
  line_value: {
    net: string;
    sold: string;
    prior: string;
    qty: string;
    value?: string;
    error?: string;
  }[];
  cumulative: { net: string; sold: string; steps: string[]; values: string[] }[];
  split: { total: string; paid: Channels; refunded: Channels; split?: Channels; error?: string }[];
}

const V = JSON.parse(
  readFileSync(resolve(__dirname, "../vectors/refund.json"), "utf-8"),
) as Vectors;

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return "no_error";
};
const ch = (c: Channels) => ({
  creditMinor: BigInt(c.credit),
  bankMinor: BigInt(c.bank),
  cashMinor: BigInt(c.cash),
});

describe("refund vectors (S-01/S-02 — مشتركة مع pytest)", () => {
  it.each(V.allocate)("allocate %#", (c) => {
    const run = () =>
      allocateInvoiceDiscount(
        c.lines.map(([key, t]) => ({ key, totalMinor: BigInt(t) })),
        BigInt(c.discount),
      );
    if (c.error) return expect(code(run)).toBe(c.error);
    const net = run();
    expect(net.map(String)).toEqual(c.net);
    // كل نصيب بين صفر وسطره، ومجموع الصافي = المجموع − الخصم بالضبط
    const subtotal = c.lines.reduce((a, [, t]) => a + BigInt(t), 0n);
    expect(net.reduce((a, b) => a + b, 0n)).toBe(subtotal - BigInt(c.discount));
    net.forEach((n, i) => {
      expect(n >= 0n && n <= BigInt(c.lines[i]![1])).toBe(true);
    });
  });

  it.each(V.line_value)("line value %#", (c) => {
    const run = () =>
      returnLineValueMinor(BigInt(c.net), BigInt(c.sold), BigInt(c.prior), BigInt(c.qty));
    if (c.error) return expect(code(run)).toBe(c.error);
    expect(run().toString()).toBe(c.value);
  });

  it.each(V.cumulative)("cumulative partial returns never exceed what was paid %#", (c) => {
    let prior = 0n;
    let sum = 0n;
    const got: string[] = [];
    for (const s of c.steps) {
      const v = returnLineValueMinor(BigInt(c.net), BigInt(c.sold), prior, BigInt(s));
      prior += BigInt(s);
      sum += v;
      expect(sum <= returnValueCapMinor(BigInt(c.net), BigInt(c.sold), prior)).toBe(true);
      got.push(v.toString());
    }
    expect(got).toEqual(c.values);
    if (prior === BigInt(c.sold)) expect(sum).toBe(BigInt(c.net));
  });

  it.each(V.split)("split %#", (c) => {
    const run = () => refundSplit(BigInt(c.total), ch(c.paid), ch(c.refunded));
    if (c.error) return expect(code(run)).toBe(c.error);
    const s = run();
    expect({
      credit: s.creditMinor.toString(),
      bank: s.bankMinor.toString(),
      cash: s.cashMinor.toString(),
    }).toEqual(c.split);
  });

  it("exhaustive: any sequence of partial returns sums to at most the line's net (S-01)", () => {
    for (const net of [0n, 1n, 7n, 999n, 2080000n])
      for (const sold of [1n, 3n, 1000n, 1500n, 3000n, 7000n]) {
        const steps = [sold / 3n, sold / 2n, sold].map((x) => (x > 0n ? x : 1n));
        let prior = 0n;
        let sum = 0n;
        for (const s of steps) {
          const q = prior + s > sold ? sold - prior : s;
          if (q <= 0n) break;
          sum += returnLineValueMinor(net, sold, prior, q);
          prior += q;
          expect(sum).toBe(returnValueCapMinor(net, sold, prior));
          expect(sum <= net).toBe(true);
        }
      }
  });
});
