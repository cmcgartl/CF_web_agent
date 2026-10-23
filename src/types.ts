export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface CreateRunRequest {
	url: string;
	goal: string;
}

export interface ResearchRun {
	runId: string;
	url: string;
	goal: string;
	status: RunStatus;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
	result?: {
		answer: string;
	};
	error?: string;
}

export interface RunQueueMessage {
	runId: string;
}

export interface Env {
	RESEARCH_RUNS: DurableObjectNamespace;
	RUN_QUEUE: Queue<RunQueueMessage>;
}
