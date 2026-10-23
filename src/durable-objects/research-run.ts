import { DurableObject } from "cloudflare:workers";
import type { Env, ResearchRun } from "../types";

const RUN_KEY = "run";

export class ResearchRunObject extends DurableObject<Env> {
	private async processRun(runningRun: ResearchRun): Promise<ResearchRun> {
		try {
			// Placeholder for the future Browser Run and model workflow.
			await new Promise((resolve) => setTimeout(resolve, 10));
			const completedRun: ResearchRun = {
				...runningRun,
				status: "completed",
				completedAt: new Date().toISOString(),
				result: {
					answer: "Placeholder result: browser processing is not connected yet.",
				},
			};
			await this.ctx.storage.put(RUN_KEY, completedRun);
			return completedRun;
		} catch (error) {
			const failedRun: ResearchRun = {
				...runningRun,
				status: "failed",
				error: error instanceof Error ? error.message : "Run processing failed.",
			};
			await this.ctx.storage.put(RUN_KEY, failedRun);
			return failedRun;
		}
	}

	async fetch(request: Request): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (path !== "/state" && path !== "/start") {
			return new Response("Not found", { status: 404 });
		}

		if (request.method === "POST" && path === "/state") {
			const run = (await request.json()) as ResearchRun;
			await this.ctx.storage.put(RUN_KEY, run);

			return Response.json(run, { status: 201 });
		}

		if (request.method === "POST" && path === "/start") {
			const startResult = await this.ctx.storage.transaction(async (transaction) => {
				const run = await transaction.get<ResearchRun>(RUN_KEY);
				if (!run || run.status !== "queued") {
					return { run, started: false };
				}

				const runningRun: ResearchRun = {
					...run,
					status: "running",
					startedAt: new Date().toISOString(),
				};
				await transaction.put(RUN_KEY, runningRun);
				return { run: runningRun, started: true };
			});

			if (!startResult.run) {
				return Response.json({ error: "Run not found" }, { status: 404 });
			}

			// Queue delivery is the wake-up signal. The transaction makes the
			// queued-to-running transition atomic, so duplicate deliveries cannot
			// start the same run twice.
			if (startResult.started) {
				// Keep the queue consumer invocation open until processing finishes.
				// This makes Queue max_concurrency reflect active runs rather than
				// merely limiting how quickly runs are dispatched.
				const completedRun = await this.processRun(startResult.run);
				return Response.json(completedRun);
			}

			// A duplicate delivery is safe to acknowledge: the original delivery
			// owns the active processing request, or this run is already terminal.
			return Response.json(startResult.run);
		}

		if (request.method === "GET" && path === "/state") {
			const run = await this.ctx.storage.get<ResearchRun>(RUN_KEY);
			return run
				? Response.json(run)
				: Response.json({ error: "Run not found" }, { status: 404 });
		}

		return new Response("Method not allowed", { status: 405 });
	}
}
