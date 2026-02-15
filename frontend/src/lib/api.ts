const API_BASE = ''; // Use relative paths to leverage CloudFront proxying and avoid mixed-content issues

export interface JobInput {
    url: string;
    user_id: string;
    priority?: 'high' | 'normal' | 'low';
    timeout_seconds?: number;
    metadata?: Record<string, any>;
}

export interface JobResult {
    screenshot_url?: string;
    logs_url?: string;
    exit_code?: number;
    error_message?: string;
    duration_seconds?: number;
}

export interface JobSubmitResponse {
    job_id: string;
    status: string;
}

export interface JobStatusResponse {
    job_id: string;
    status: string;
    url: string;
    priority: string;
    created_at: string;
    started_at?: string;
    completed_at?: string;
    result?: JobResult;
}

export interface HealthResponse {
    status: string;
    version: string;
    services: Record<string, string>;
}

export async function submitJob(input: JobInput): Promise<JobSubmitResponse> {
    const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Failed to submit job');
    }
    return res.json();
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const res = await fetch(`${API_BASE}/jobs/${jobId}`);
    if (!res.ok) {
        throw new Error(`Job ${jobId} not found`);
    }
    return res.json();
}

export async function cancelJob(jobId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/jobs/${jobId}`, { method: 'DELETE' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Failed to cancel job');
    }
}

export async function getHealth(): Promise<HealthResponse> {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error('Health check failed');
    return res.json();
}

export function connectLogs(jobId: string, onMessage: (data: any) => void, onClose?: () => void): WebSocket {
    const wsBase = API_BASE.replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsBase}/jobs/${jobId}/logs`);
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => onClose?.();
    return ws;
}
