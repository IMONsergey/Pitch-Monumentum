import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPitchMcpNext5Server } from "../../pitch-mcp-next5/src/server.js";
import { ReviewWorkspaceRuntime } from "../../review/src/runtime.js";
import { reviewDeliveryGate } from "../../../packages/review-engine/src/delivery.js";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as any };
}

const anchor = z.object({
  scope: z.enum(["deck", "slide", "element"]),
  slideId: z.string().optional(),
  elementId: z.string().optional(),
  point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
});

export function createPitchMcpNext6Server(projectRoot: string) {
  const root = resolve(projectRoot);
  const server = createPitchMcpNext5Server(root);
  const review = new ReviewWorkspaceRuntime(root);
  const codexAuthor = { kind: "codex" as const, id: "pitch-codex", displayName: "Codex" };

  server.registerTool("pitch_review_state", {
    title: "Read Pitch comments and approvals",
    description: "Read branch-local review threads, anchor validity, approvals/current-vs-stale states, review history and unresolved blocking review. Codex may read human approvals but cannot grant/revoke them or resolve/reopen threads.",
    inputSchema: {},
  }, async () => {
    const state = await review.state();
    const deck = await review.service.state();
    return result({ ...state, delivery: reviewDeliveryGate(deck.deck, state.document) });
  });

  server.registerTool("pitch_review_add", {
    title: "Add Codex review thread",
    description: "Add a Codex-authored comment, question or change request anchored to deck, slide or stable element. Use this for critique/review notes, not for silently editing the deck.",
    inputSchema: {
      anchor,
      type: z.enum(["comment", "changeRequest", "question"]).optional(),
      priority: z.enum(["nit", "normal", "blocking"]).optional(),
      body: z.string().min(1).max(20_000),
      threadId: z.string().optional(),
      expectedDeckHash: z.string().optional(),
      expectedReviewHash: z.string().optional(),
    },
  }, async (args) => result(await review.command({ command: "addThread", anchor: args.anchor as any, type: args.type, priority: args.priority, body: args.body, threadId: args.threadId, author: codexAuthor, expectedDeckHash: args.expectedDeckHash, expectedReviewHash: args.expectedReviewHash })));

  server.registerTool("pitch_review_reply", {
    title: "Reply to Pitch review thread",
    description: "Add a Codex-authored reply to an existing review thread. A reply may explain a proposed/fixed change, but Codex cannot resolve the thread itself.",
    inputSchema: { threadId: z.string().min(1), body: z.string().min(1).max(20_000), messageId: z.string().optional(), expectedDeckHash: z.string().optional(), expectedReviewHash: z.string().optional() },
  }, async (args) => result(await review.command({ command: "reply", threadId: args.threadId, body: args.body, messageId: args.messageId, author: codexAuthor, expectedDeckHash: args.expectedDeckHash, expectedReviewHash: args.expectedReviewHash })));

  server.registerTool("pitch_review_edit_own_message", {
    title: "Edit Codex review message",
    description: "Edit one Codex-authored review message. The review engine rejects edits to another author's message.",
    inputSchema: { threadId: z.string().min(1), messageId: z.string().min(1), body: z.string().min(1).max(20_000), expectedDeckHash: z.string().optional(), expectedReviewHash: z.string().optional() },
  }, async (args) => result(await review.command({ command: "editMessage", threadId: args.threadId, messageId: args.messageId, body: args.body, author: codexAuthor, expectedDeckHash: args.expectedDeckHash, expectedReviewHash: args.expectedReviewHash })));

  server.registerTool("pitch_review_delivery_gate", {
    title: "Check Pitch delivery review gate",
    description: "Check whether unresolved blocking review or stale/missing required approvals block delivery. This is read-only; only a human reviewer can grant approval or resolve review authority.",
    inputSchema: { requireDeckApproval: z.boolean().optional(), requireSlideApprovalIds: z.array(z.string()).optional(), blockOnOrphanedBlockingThreads: z.boolean().optional() },
  }, async (policy) => {
    const state = await review.state();
    const deck = await review.service.state();
    return result(reviewDeliveryGate(deck.deck, state.document, policy));
  });

  return server;
}

export async function runPitchMcpNext6Server(projectRoot: string): Promise<void> {
  await createPitchMcpNext6Server(projectRoot).connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) runPitchMcpNext6Server(process.argv[2] ?? ".pitch-demo").catch((error) => { console.error(error); process.exitCode = 1; });
