import type { Env, RunQueueMessage } from "../types";

/**
 * Delivers a queued run ID to the already-initialized run Durable Object.
 * Queue delivery is at-least-once, so the run object must tolerate duplicate
 * start messages.
 */
export async function consumeRunQueue(
	batch: MessageBatch<unknown>,
	env: Env,
): Promise<void> {
	for (const message of batch.messages) {
		const body = message.body as Partial<RunQueueMessage> | null;
		const runId = body?.runId;
		if (typeof runId !== "string" || runId.length === 0) {
			// This is a malformed message produced outside our API. Retrying it
			// would not repair it, so acknowledge it instead of poisoning the queue.
			message.ack();
			continue;
		}

		const objectId = env.RESEARCH_RUNS.idFromName(runId);
		const object = env.RESEARCH_RUNS.get(objectId);
		const response = await object.fetch("https://research-run/start", {
			method: "POST",
		});

		if (response.ok || response.status === 404) {
			// A successful start, or a permanently missing run, should not be
			// delivered again. Transient failures are allowed to retry below.
			message.ack();
		} else {
			message.retry();
		}
	}
}
