'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';
import layoutStyles from '../layout.module.css';
import { submitJob } from '@/lib/api';

export default function NewJobPage() {
    const router = useRouter();
    const [url, setUrl] = useState('');
    const [userId, setUserId] = useState('');
    const [priority, setPriority] = useState('normal');
    const [timeout, setTimeout] = useState(600);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState<{ job_id: string } | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await submitJob({
                url,
                user_id: userId,
                priority: priority as 'high' | 'normal' | 'low',
                timeout_seconds: timeout,
            });
            setSuccess({ job_id: result.job_id });
        } catch (err: any) {
            setError(err.message || 'Failed to submit job');
        } finally {
            setLoading(false);
        }
    }

    if (success) {
        return (
            <div className="fade-in">
                <div className={layoutStyles.pageHeader}>
                    <h1 className={layoutStyles.pageTitle}>Eligibility Check Submitted</h1>
                </div>
                <div className={`card ${styles.successCard}`}>
                    <div className={styles.successIcon}>✓</div>
                    <div className={styles.successTitle}>Check request created successfully</div>
                    <div className={styles.successId}>{success.job_id}</div>
                    <div className={styles.successActions}>
                        <Link href={`/history/${success.job_id}`} className="btn btn-primary">
                            View Status
                        </Link>
                        <button className="btn btn-ghost" onClick={() => { setSuccess(null); setUrl(''); setUserId(''); }}>
                            Submit Another
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fade-in">
            <div className={layoutStyles.pageHeader}>
                <h1 className={layoutStyles.pageTitle}>Eligibility Check</h1>
                <p className={layoutStyles.pageSubtitle}>Submit a new automated patient eligibility verification</p>
            </div>

            <form onSubmit={handleSubmit}>
                <div className={`card ${styles.formCard}`}>
                    {error && <div className={styles.errorMsg}>{error}</div>}

                    <div className={styles.formGroup}>
                        <label className="label" htmlFor="url">Portal URL</label>
                        <input
                            id="url"
                            className="input"
                            type="url"
                            placeholder="https://portal.aetna.com/eligibility"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            required
                        />
                        <div className={styles.helperText}>Provide the insurance portal URL. The agent will capture a screenshot and verify details.</div>
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label" htmlFor="userId">Patient Number / ID</label>
                        <input
                            id="userId"
                            className="input"
                            placeholder="101"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                            required
                        />
                        <div className={styles.helperText}>Used to identify the patient across systems</div>
                    </div>

                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label className="label" htmlFor="priority">Priority</label>
                            <select
                                id="priority"
                                className="input"
                                value={priority}
                                onChange={(e) => setPriority(e.target.value)}
                            >
                                <option value="high">High</option>
                                <option value="normal">Normal</option>
                                <option value="low">Low</option>
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label className="label" htmlFor="timeout">Timeout (seconds)</label>
                            <input
                                id="timeout"
                                className="input"
                                type="number"
                                min={60}
                                max={3600}
                                value={timeout}
                                onChange={(e) => setTimeout(Number(e.target.value))}
                            />
                        </div>
                    </div>

                    <div className={styles.formActions}>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Submitting...' : 'Submit Job'}
                        </button>
                        <Link href="/history" className="btn btn-ghost">Cancel</Link>
                    </div>
                </div>
            </form>
        </div>
    );
}
