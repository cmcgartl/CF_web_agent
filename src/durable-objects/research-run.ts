import { DurableObject } from "cloudflare:workers";
import type { Env, ResearchRun } from "../types";

const RUN_KEY = "run";

export class ResearchRunObject extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (path !== "/state") return new Response("Not found", { status: 404 });

		if (request.method === "POST") {
			const run = (await request.json()) as ResearchRun;
			await this.ctx.storage.put(RUN_KEY, run);
			return Response.json(run, { status: 201 });
		}

		if (request.method === "GET") {
			const run = await this.ctx.storage.get<ResearchRun>(RUN_KEY);
			return run
				? Response.json(run)
				: Response.json({ error: "Run not found" }, { status: 404 });
		}

		return new Response("Method not allowed", { status: 405 });
	}
}
