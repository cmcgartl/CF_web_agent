import { Hono } from "hono";
import type { Env, ResearchRun } from "../types";
import { parseCreateRunRequest } from "../validation";

export const runs = new Hono<{ Bindings: Env }>();

runs.post("/", async (c) => {
	let body: unknown;
	try { body = await c.req.json(); }
	catch { return c.json({ error: { code: "INVALID_JSON", message: "Request body must contain valid JSON." } }, 400); }

	const requestBody = parseCreateRunRequest(body);
	if (!requestBody) {
		return c.json({ error: { code: "INVALID_REQUEST", message: "Request must include a valid URL and non-empty goal." } }, 400);
	}

	const run: ResearchRun = {
		runId: crypto.randomUUID(),
		url: requestBody.url,
		goal: requestBody.goal,
		status: "queued",
		createdAt: new Date().toISOString(),
	};

	const objectId = c.env.RESEARCH_RUNS.idFromName(run.runId);
	const object = c.env.RESEARCH_RUNS.get(objectId);
	await object.fetch("https://research-run/state", {
		method: "POST",
		body: JSON.stringify(run),
		headers: { "Content-Type": "application/json" },
	});

	return c.json({ runId: run.runId, status: run.status, createdAt: run.createdAt, statusUrl: `/api/runs/${run.runId}` }, 202);
});

runs.get("/:runId", async (c) => {
	const objectId = c.env.RESEARCH_RUNS.idFromName(c.req.param("runId"));
	const object = c.env.RESEARCH_RUNS.get(objectId);
	const response = await object.fetch("https://research-run/state");
	return new Response(response.body, response);
});
