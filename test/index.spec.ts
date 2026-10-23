import {
	SELF,
	createExecutionContext,
	createMessageBatch,
	env,
	getQueueResult,
	waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker from "../src";
import { consumeRunQueue } from "../src/queue/run-consumer";
import type { Env } from "../src/types";

describe("research run API", () => {
	it("returns the root response", async () => {
		const response = await SELF.fetch("https://example.com/");

		// The root route confirms that the Worker is reachable.
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ hello: "World" });
	});

	it("processes a run from queued to completed", async () => {
		const createResponse = await SELF.fetch("https://example.com/api/runs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: "https://example.com/products",
				goal: "Find the top five products",
			}),
		});

		// The POST accepts the work and returns a run ID while processing is asynchronous.
		expect(createResponse.status).toBe(202);
		const created = (await createResponse.json()) as {
			runId: string;
			status: string;
			statusUrl: string;
		};
		expect(created.runId).toBeTruthy();
		expect(created.status).toBe("queued");

		// Vitest does not deliver a producer message to the consumer automatically,
		// so this explicitly simulates Cloudflare Queue delivering the run ID.
		const queueBatch = createMessageBatch("cf-web-agent-runs", [
			{
				id: "test-message",
				timestamp: new Date(),
				attempts: 1,
				body: { runId: created.runId },
			},
		]);
		const queueContext = createExecutionContext();
		const queueProcessing = worker.queue(
			queueBatch,
			env as unknown as Env,
			queueContext,
		);
		let queueConsumerSettled = false;
		void queueProcessing.then(() => {
			queueConsumerSettled = true;
		});

		const observedStatuses = new Set<string>();
		let completedRun: Record<string, any> | undefined;

		// Poll until the Durable Object has completed its placeholder processing.
		for (let attempt = 0; attempt < 50; attempt += 1) {
			const getResponse = await SELF.fetch(
				`https://example.com${created.statusUrl}`,
			);
			expect(getResponse.status).toBe(200);
			const savedRun = (await getResponse.json()) as Record<string, any>;
			observedStatuses.add(savedRun.status);
			if (savedRun.status === "running") {
				// The consumer must remain open until the DO finishes the run, so its
				// concurrency slot represents active work rather than only dispatch time.
				expect(queueConsumerSettled).toBe(false);
			}

			if (savedRun.status === "completed") {
				completedRun = savedRun;
				break;
			}

			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		await queueProcessing;
		await waitOnExecutionContext(queueContext);
		const queueResult = await getQueueResult(queueBatch, queueContext);
		expect(queueResult.explicitAcks).toContain("test-message");

		// The run should be observable as active while the queue consumer remains open.
		expect(observedStatuses.has("running")).toBe(true);
		expect(completedRun).toMatchObject({
			runId: created.runId,
			url: "https://example.com/products",
			goal: "Find the top five products",
			status: "completed",
			result: {
				answer: "Placeholder result: browser processing is not connected yet.",
			},
		});
		expect(completedRun?.startedAt).toBeTruthy();
		expect(completedRun?.completedAt).toBeTruthy();
	});

	it("acknowledges a queue message only after the run DO finishes", async () => {
		let resolveStart: (response: Response) => void = () => undefined;
		const startResponse = new Promise<Response>((resolve) => {
			resolveStart = resolve;
		});
		const start = vi.fn(() => startResponse);
		const message = {
			id: "deferred-message",
			timestamp: new Date(),
			attempts: 1,
			body: { runId: "run-under-test" },
			ack: vi.fn(),
			retry: vi.fn(),
		} as unknown as Message<unknown>;
		const batch = {
			messages: [message],
		} as unknown as MessageBatch<unknown>;
		const queueEnv = {
			RESEARCH_RUNS: {
				idFromName: vi.fn(() => ({}) as DurableObjectId),
				get: vi.fn(() => ({ fetch: start })),
			},
		} as unknown as Env;

		// The mock DO response stays pending to represent an active run.
		const consumer = consumeRunQueue(batch, queueEnv);
		expect(start).toHaveBeenCalledOnce();
		expect(message.ack).not.toHaveBeenCalled();
		expect(message.retry).not.toHaveBeenCalled();

		// Once the DO reports completion, the consumer can acknowledge the message.
		resolveStart(Response.json({ status: "completed" }));
		await consumer;
		expect(message.ack).toHaveBeenCalledOnce();
		expect(message.retry).not.toHaveBeenCalled();
	});

	it("rejects malformed JSON", async () => {
		const response = await SELF.fetch("https://example.com/api/runs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json",
		});

		// Invalid JSON cannot be interpreted as a research request.
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "INVALID_JSON",
				message: "Request body must contain valid JSON.",
			},
		});
	});

	it("rejects missing or invalid request fields", async () => {
		const response = await SELF.fetch("https://example.com/api/runs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "https://example.com" }),
		});

		// Both URL and goal are required to create a run.
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "INVALID_REQUEST",
				message: "Request must include a valid URL and non-empty goal.",
			},
		});
	});

	it("rejects non-HTTP URLs", async () => {
		const response = await SELF.fetch("https://example.com/api/runs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: "javascript:alert(1)",
				goal: "Find something",
			}),
		});

		// Research runs are restricted to web pages using HTTP or HTTPS.
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "INVALID_REQUEST",
				message: "Request must include a valid URL and non-empty goal.",
			},
		});
	});

	it("returns 404 for an unknown run", async () => {
		const response = await SELF.fetch(
			"https://example.com/api/runs/run-that-does-not-exist",
		);

		// A run ID with no corresponding Durable Object state should not succeed.
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "Run not found" });
	});
});
