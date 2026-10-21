import type { CreateRunRequest } from "./types";

export function parseCreateRunRequest(value: unknown): CreateRunRequest | null {
	if (typeof value !== "object" || value === null) return null;
	const body = value as Record<string, unknown>;
	if (typeof body.url !== "string" || typeof body.goal !== "string") return null;
	try {
		const parsedUrl = new URL(body.url);
		if (!["http:", "https:"].includes(parsedUrl.protocol)) return null;
	} catch { return null; }
	if (body.goal.trim().length === 0) return null;
	return { url: body.url, goal: body.goal.trim() };
}
