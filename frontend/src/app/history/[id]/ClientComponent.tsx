'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import styles from './page.module.css';
import layoutStyles from '../../layout.module.css';
import { getJobStatus, cancelJob, connectLogs, JobStatusResponse } from '@/lib/api';

interface LogEntry {
    timestamp?: number;
    message: string;
    status?: string;
}

export default function JobDetailClient() {
    const params = useParams();
    const jobId = params.id as string;

    const [job, setJob] = useState<JobStatusResponse | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const logRef = useRef<HTMLDivElement>(null);

    // Demo fallback
    const demoJob: JobStatusResponse = {
        job_id: jobId || 'demo',
        url: 'https://portal.aetna.com/eligibility',
        status: 'running',
        priority: 'high',
        created_at: new Date(Date.now() - 120000).toISOString(),
        started_at: new Date(Date.now() - 60000).toISOString(),
    };

    useEffect(() => {
        if (!jobId) return;
        getJobStatus(jobId)
            .then(setJob)
            .catch(() => setJob(demoJob))
            .finally(() => setLoading(false));
    }, [jobId]);

    // Poll for status updates
    useEffect(() => {
        if (!job) return;
        if (['completed', 'failed', 'cancelled', 'timeout'].includes(job.status)) return;

        const interval = setInterval(() => {
            getJobStatus(jobId)
                .then(setJob)
                .catch(() => { });
        }, 3000);

        return () => clearInterval(interval);
    }, [job?.status, jobId]);

    // WebSocket logs
    useEffect(() => {
        if (!job) return;
        if (['completed', 'failed', 'cancelled', 'timeout'].includes(job.status)) return;

        try {
            const ws = connectLogs(jobId, (data: LogEntry) => {
                setLogs(prev => [...prev, data]);
            }, () => { });

            return () => ws.close();
        } catch {
            // WebSocket might not be available in dev
        }
    }, [job?.status, jobId]);

    // Scroll logs
    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logs]);

    async function handleCancel() {
        try {
            await cancelJob(jobId);
            setJob(prev => prev ? { ...prev, status: 'cancelled' } : prev);
        } catch (err: any) {
            setError(err.message);
        }
    }

    function formatTime(iso?: string) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function getTimelineSteps() {
        const steps = [
            { label: 'Created', time: job?.created_at, done: true },
            { label: 'Queued', time: job?.created_at, done: ['queued', 'running', 'completed'].includes(job?.status || '') },
            { label: 'Running', time: job?.started_at, active: job?.status === 'running', done: ['completed'].includes(job?.status || '') },
            { label: job?.status === 'failed' ? 'Failed' : job?.status === 'cancelled' ? 'Cancelled' : 'Completed', time: job?.completed_at, done: ['completed', 'failed', 'cancelled'].includes(job?.status || ''), failed: job?.status === 'failed' },
        ];
        return steps;
    }

    if (loading) {
        return (
            <div className={styles.loadingPage}>
                <div className={styles.spinner}></div>
                Loading job details...
            </div>
        );
    }

    const currentJob = job || demoJob;

    return (
        <div className="fade-in">
            <div className={layoutStyles.pageHeader}>
                <h1 className={layoutStyles.pageTitle}>Job Detail</h1>
                <p className={layoutStyles.pageSubtitle}>{currentJob.job_id}</p>
            </div>

            <div className={styles.actionBar}>
                <Link href="/history" className="btn btn-ghost">← Back to Previous Checks</Link>
                {!['completed', 'failed', 'cancelled', 'timeout'].includes(currentJob.status) && (
                    <button className="btn btn-danger" onClick={handleCancel}>Cancel Job</button>
                )}
            </div>

            <div className={styles.detailGrid}>
                <div className={styles.mainCol}>
                    {/* Job Info */}
                    <div className={`card ${styles.infoCard}`} style={{ marginBottom: 20 }}>
                        <div className={styles.infoHeader}>
                            <span className={styles.infoTitle}>Job Information</span>
                            <span className={`badge badge-${currentJob.status}`}>{currentJob.status}</span>
                        </div>
                        <div className={styles.infoGrid}>
                            <div className={styles.infoItem}>
                                <span className={styles.infoLabel}>Job ID</span>
                                <span className={styles.infoValueMono}>{currentJob.job_id}</span>
                            </div>
                            <div className={styles.infoItem}>
                                <span className={styles.infoLabel}>Priority</span>
                                <span className={styles.infoValue}>{currentJob.priority}</span>
                            </div>
                            <div className={`${styles.infoItem} ${styles.urlValue}`}>
                                <span className={styles.infoLabel}>Target URL</span>
                                <span className={styles.infoValue}>{currentJob.url}</span>
                            </div>
                            <div className={styles.infoItem}>
                                <span className={styles.infoLabel}>Created</span>
                                <span className={styles.infoValue}>{formatTime(currentJob.created_at)}</span>
                            </div>
                            <div className={styles.infoItem}>
                                <span className={styles.infoLabel}>Started</span>
                                <span className={styles.infoValue}>{formatTime(currentJob.started_at)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Logs */}
                    <div className={`card ${styles.logCard}`}>
                        <div className={styles.logHeader}>
                            <div className={styles.logTitle}>
                                {currentJob.status === 'running' && <span className={styles.logLive}></span>}
                                Live Logs
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{logs.length} entries</span>
                        </div>
                        <div className={styles.logBody} ref={logRef}>
                            {logs.length === 0 ? (
                                <div className={styles.logEmpty}>
                                    {currentJob.status === 'running' ? 'Waiting for log output...' : 'No logs available'}
                                </div>
                            ) : (
                                logs.map((entry, i) => (
                                    <div key={i} className={styles.logLine}>
                                        {entry.timestamp && (
                                            <span className={styles.logTimestamp}>
                                                {new Date(entry.timestamp).toLocaleTimeString()}
                                            </span>
                                        )}
                                        <span className={styles.logMessage}>{entry.message}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                <div className={styles.sideCol}>
                    {/* Timeline */}
                    <div className={`card ${styles.timelineCard}`}>
                        <div className={styles.timelineTitle}>Progress</div>
                        <div className={styles.timeline}>
                            {getTimelineSteps().map((step, i) => (
                                <div key={i} className={styles.timelineStep}>
                                    <div className={`${styles.timelineDot} ${step.active ? styles.timelineDotActive :
                                        step.failed ? styles.timelineDotFailed :
                                            step.done ? styles.timelineDotDone : ''
                                        }`}></div>
                                    <div className={styles.timelineStepLabel}>{step.label}</div>
                                    <div className={styles.timelineStepTime}>{formatTime(step.time)}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Result */}
                    {currentJob.result && (
                        <div className={`card ${styles.resultCard}`}>
                            <div className={styles.resultTitle}>Result</div>
                            <div className={styles.screenshotPreview}>
                                {currentJob.result.screenshot_url ? (
                                    <img src={currentJob.result.screenshot_url} alt="Screenshot" />
                                ) : (
                                    <div className={styles.screenshotPlaceholder}>No screenshot available</div>
                                )}
                            </div>
                            {currentJob.result.screenshot_url && (
                                <a
                                    href={currentJob.result.screenshot_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.downloadBtn}
                                    download={`screenshot-${currentJob.job_id}.png`}
                                >
                                    <span>📸</span> Download Screenshot
                                </a>
                            )}
                            {currentJob.result.error_message && (
                                <div style={{ marginTop: 12, color: 'var(--error)', fontSize: '0.875rem' }}>
                                    {currentJob.result.error_message}
                                </div>
                            )}
                            {currentJob.result.duration_seconds && (
                                <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    Duration: {currentJob.result.duration_seconds.toFixed(1)}s
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
