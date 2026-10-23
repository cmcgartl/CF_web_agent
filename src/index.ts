import { Hono } from "hono";
import { runs } from "./routes/runs";
import { ResearchRunObject } from "./durable-objects/research-run";
import { consumeRunQueue } from "./queue/run-consumer";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.json({ hello: "World" }));
app.route("/api/runs", runs);

export { ResearchRunObject };

export default {
	fetch: app.fetch,
	queue: consumeRunQueue,
} satisfies ExportedHandler<Env>;
