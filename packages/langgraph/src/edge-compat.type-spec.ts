/**
 * Type-level tests for `defineEdges` state-slice compatibility. Compiled by tsc
 * (see type-safety.spec.ts). Each `@ts-expect-error` asserts a genuine compile
 * error; if the rejection stopped working, tsc would flag the unused directive
 * and the test would fail.
 */
import { defineEdges, START, END, route, as } from "./index";
import type { NodeHandler } from "./index";

interface WideState {
  a: string;
  b: number;
}
interface NarrowState {
  a: string;
}

class WideNode implements NodeHandler<WideState> {
  run(_s: WideState) {
    return {};
  }
}
class NarrowNode implements NodeHandler<NarrowState> {
  run(_s: NarrowState) {
    return {};
  }
}
class ForeignNode implements NodeHandler<{ z: boolean }> {
  run(_s: { z: boolean }) {
    return {};
  }
}

/* --- accepted cases (no error) --- */

// Reuse: a narrow-slice node is valid in a wider graph.
defineEdges<WideState>([
  { from: START, to: NarrowNode },
  { from: NarrowNode, to: END },
]);

// Exact match.
defineEdges<WideState>([
  { from: START, to: WideNode },
  { from: WideNode, to: END },
]);

// route + alias with a compatible node.
defineEdges<WideState>([
  { from: START, to: route<WideState>(() => NarrowNode, [NarrowNode]) },
  { from: as("dup", NarrowNode), to: END },
]);

/* --- rejected cases (must error) --- */

defineEdges<NarrowState>([
  // @ts-expect-error WideNode requires 'b' which NarrowState does not provide.
  { from: START, to: WideNode },
]);

defineEdges<WideState>([
  // @ts-expect-error ForeignNode touches unrelated state 'z'.
  { from: START, to: ForeignNode },
]);

defineEdges<NarrowState>([
  // @ts-expect-error alias of an incompatible node is also rejected.
  { from: START, to: as("x", WideNode) },
]);

export {};
