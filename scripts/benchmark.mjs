import { createRuntime, defineAction, defineModule } from "../packages/core/dist/index.js";

const iterations = Number(process.env.ACTION_FLOW_BENCH_ITERATIONS ?? 10_000);
if (!Number.isSafeInteger(iterations) || iterations < 1) {
  throw new TypeError("ACTION_FLOW_BENCH_ITERATIONS must be a positive integer.");
}
const increment = (value) => value + 1;
const runtime = createRuntime({
  providers: {},
  modules: [defineModule("bench", { increment: defineAction({ handler: increment }) })],
});
const traced = createRuntime({
  providers: {}, trace: { maxRecords: 1_000 },
  modules: [defineModule("bench", { increment: defineAction({ handler: increment }) })],
});
const cases = {
  "awaited function": async (value) => await increment(value),
  "runtime dispatch": (value) => runtime.dispatch("bench.increment", value),
  "dispatch with structural traces": (value) => traced.dispatch("bench.increment", value),
};
const results = [];
for (const [name, run] of Object.entries(cases)) {
  for (let i = 0; i < 1_000; i++) await run(i);
  const samples = [];
  for (let sample = 0; sample < 5; sample++) {
    let checksum = 0;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) checksum += await run(i);
    samples.push(performance.now() - start);
    if (checksum !== iterations * (iterations + 1) / 2) throw new Error("Incorrect benchmark result.");
  }
  samples.sort((left, right) => left - right);
  results.push({ name, iterations, samples: samples.length, medianMs: samples[2], minMs: samples[0], maxMs: samples.at(-1) });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, results, traceRetention: { size: traced.trace.size, droppedRecords: traced.trace.droppedRecords } }, null, 2));
