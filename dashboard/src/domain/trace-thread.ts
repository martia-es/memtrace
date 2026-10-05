import type { SpanNodeDto } from "@contract";
import { spanIo, type IoBlock } from "./span-io";

/**
 * The conversation of a trace as ordered message blocks: the root span's own input/output when it has them, otherwise
 * everything the spans below it exchanged, depth first. Shared by the review screen and the trace's Conversation tab.
 */
export function traceThread(roots: SpanNodeDto[]): IoBlock[] {
  const root = roots[0];
  if (!root) return [];
  const io = spanIo(root);
  if (io.input.length || io.output.length) return io.ordered ?? [...io.input, ...io.output];

  const blocks: IoBlock[] = [];
  const collect = (node: SpanNodeDto) => {
    const nodeIo = spanIo(node);
    blocks.push(...(nodeIo.ordered ?? [...nodeIo.input, ...nodeIo.output]));
    for (const child of node.children ?? []) collect(child);
  };
  for (const rootNode of roots) collect(rootNode);
  return blocks;
}
