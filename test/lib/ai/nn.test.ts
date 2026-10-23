import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  cloneMlp,
  copyMlp,
  createAdam,
  createMlp,
  forward,
  lossAndGradients,
  parseMlp,
  serializeMlp,
  trainBatch,
} from "../../../src/lib/ai/nn.ts";

// mulberry32, so every test is reproducible
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("lossAndGradients", () => {
  test("matches finite differences", () => {
    const rng = seeded(1);
    const net = createMlp([3, 5, 4, 2], rng);
    // Non-zero biases so ReLU kinks are not all at exactly the same point
    for (const b of net.biases) for (let i = 0; i < b.length; i++) b[i] = rng() - 0.5;
    const inputs = [[0.3, -0.7, 1.1], [1.5, 0.2, -0.4], [-1, 0.9, 0.5]];
    // Targets far from the outputs on one side so both Huber regions are exercised
    const targets = [[0.1, 5], [-4, 0.2], [0.5, 0.4]];
    const masks = [[1, 1], [1, 0], [0, 1]];
    const { gradW, gradB } = lossAndGradients(net, inputs, targets, masks);
    const eps = 1e-3;
    const lossOf = (): number => lossAndGradients(net, inputs, targets, masks).loss;

    for (let l = 0; l < net.weights.length; l++) {
      for (const [params, grad] of [[net.weights[l], gradW[l]], [net.biases[l], gradB[l]]] as const) {
        for (let i = 0; i < params.length; i++) {
          const original = params[i];
          params[i] = original + eps;
          const up = lossOf();
          params[i] = original - eps;
          const down = lossOf();
          params[i] = original;
          const numeric = (up - down) / (2 * eps);
          assert.ok(Math.abs(numeric - grad[i]) < 2e-3, `layer ${l} param ${i}: numeric ${numeric} vs analytic ${grad[i]}`);
        }
      }
    }
  });

  test("masked outputs get zero gradient", () => {
    const net = createMlp([2, 4, 3], seeded(2));
    const { gradW, gradB } = lossAndGradients(net, [[1, -1]], [[9, 9, 9]], [[0, 1, 0]]);
    const last = net.weights.length - 1;
    for (const o of [0, 2]) {
      assert.equal(gradB[last][o], 0);
      for (let i = 0; i < net.sizes[last]; i++) assert.equal(gradW[last][o * net.sizes[last] + i], 0);
    }
    assert.notEqual(gradB[last][1], 0);
  });

  test("an all-zero mask gives zero loss", () => {
    const net = createMlp([2, 3, 2], seeded(3));
    assert.equal(lossAndGradients(net, [[1, 2]], [[5, 5]], [[0, 0]]).loss, 0);
  });
});

describe("trainBatch", () => {
  test("learns XOR", () => {
    const net = createMlp([2, 8, 1], seeded(4));
    const adam = createAdam(net);
    const inputs = [[0, 0], [0, 1], [1, 0], [1, 1]];
    const targets = [[0], [1], [1], [0]];
    const masks = [[1], [1], [1], [1]];
    let loss = Infinity;
    for (let i = 0; i < 3000; i++) loss = trainBatch(net, adam, inputs, targets, masks, 0.01);
    assert.ok(loss < 0.01, `final loss ${loss}`);
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(forward(net, inputs[i])[0] - targets[i][0]) < 0.15);
  });
});

describe("copy and clone", () => {
  test("copyMlp copies values, cloneMlp is independent", () => {
    const a = createMlp([2, 3, 2], seeded(5));
    const b = createMlp([2, 3, 2], seeded(6));
    copyMlp(a, b);
    assert.deepEqual(b.weights, a.weights);
    assert.deepEqual(b.biases, a.biases);
    const c = cloneMlp(a);
    c.weights[0][0] += 1;
    assert.notEqual(c.weights[0][0], a.weights[0][0]);
  });
});

describe("serializeMlp / parseMlp", () => {
  test("round trip keeps the outputs (within rounding)", () => {
    const net = createMlp([3, 4, 2], seeded(7));
    const copy = parseMlp(JSON.parse(JSON.stringify(serializeMlp(net))));
    assert.ok(copy);
    const x = [0.5, -1, 2];
    const a = forward(net, x);
    const b = forward(copy, x);
    for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-3);
  });

  test("rejects malformed input", () => {
    const good = serializeMlp(createMlp([2, 3, 2], seeded(8)));
    assert.ok(parseMlp(good));
    assert.equal(parseMlp(null), null);
    assert.equal(parseMlp("x"), null);
    assert.equal(parseMlp({ ...good, sizes: [2] }), null);
    assert.equal(parseMlp({ ...good, sizes: [2, 0, 2] }), null);
    assert.equal(parseMlp({ ...good, sizes: [2, 1.5, 2] }), null);
    assert.equal(parseMlp({ ...good, weights: [good.weights[0]] }), null);
    assert.equal(parseMlp({ ...good, weights: [good.weights[0].slice(1), good.weights[1]] }), null);
    assert.equal(parseMlp({ ...good, biases: [good.biases[0], [1]] }), null);
    const withNaN = good.weights.map((w) => w.slice());
    withNaN[0][0] = NaN;
    assert.equal(parseMlp({ ...good, weights: withNaN }), null);
    const withString = good.biases.map((b) => b.slice() as unknown[]);
    withString[1][0] = "1";
    assert.equal(parseMlp({ ...good, biases: withString }), null);
  });
});
