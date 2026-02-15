'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import layoutStyles from '../layout.module.css';

interface DemoJob {
    job_id: string;
    url: string;
    status: string;
    priority: string;
    user_id: string;
    created_at: string;
}

const allJobs: DemoJob[] = [
    { job_id: 'job-01HQXYZ123', url: 'https://portal.aetna.com/eligibility', status: 'completed', priority: 'high', user_id: 'admin', created_at: new Date(Date.now() - 7200000).toISOString() },
    { job_id: 'job-01HQXYZ456', url: 'https://cigna.com/verify', status: 'running', priority: 'normal', user_id: 'admin', created_at: new Date(Date.now() - 3600000).toISOString() },
    { job_id: 'job-01HQXYZ789', url: 'https://uhc.com/provider-portal', status: 'queued', priority: 'low', user_id: 'ops-team', created_at: new Date(Date.now() - 1800000).toISOString() },
    { job_id: 'job-01HQXYZ012', url: 'https://anthem.com/check', status: 'failed', priority: 'high', user_id: 'admin', created_at: new Date(Date.now() - 900000).toISOString() },
    { job_id: 'job-01HQXYZ345', url: 'https://humana.com/portal', status: 'completed', priority: 'normal', user_id: 'dev', created_at: new Date(Date.now() - 600000).toISOString() },
    { job_id: 'job-01HQXYZ678', url: 'https://bcbs.com/eligibility/verify', status: 'completed', priority: 'high', user_id: 'admin', created_at: new Date(Date.now() - 300000).toISOString() },
    { job_id: 'job-01HQXYZ901', url: 'https://kaiser.com/member/check', status: 'running', priority: 'normal', user_id: 'ops-team', created_at: new Date(Date.now() - 120000).toISOString() },
    { job_id: 'job-01HQXYZ234', url: 'https://medicaid.gov/verify', status: 'cancelled', priority: 'low', user_id: 'dev', created_at: new Date(Date.now() - 60000).toISOString() },
];

const statusFilters = ['all', 'queued', 'running', 'completed', 'failed'];

export default function JobsPage() {
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');

    const filtered = allJobs.filter(j => {
        if (filter !== 'all' && j.status !== filter) return false;
        if (search && !j.url.toLowerCase().includes(search.toLowerCase()) && !j.job_id.includes(search)) return false;
        return true;
    });

    function formatTime(iso: string) {
        return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function priorityClass(p: string) {
        switch (p) {
            case 'high': return styles.priorityHigh;
            case 'low': return styles.priorityLow;
            default: return styles.priorityNormal;
        }
    }

    return (
        <div className="fade-in">
            <div className={layoutStyles.pageHeader}>
                <h1 className={layoutStyles.pageTitle}>Previous Checks</h1>
                <p className={layoutStyles.pageSubtitle}>View historical automation tasks and results</p>
            </div>

            <div className={styles.toolbar}>
                <div className={styles.searchBox}>
                    <span className={styles.searchIcon}>🔍</span>
                    <input
                        className={`input ${styles.searchInput}`}
                        placeholder="Search by URL or ID..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className={styles.filters}>
                    {statusFilters.map(s => (
                        <button
                            key={s}
                            className={`${styles.filterBtn} ${filter === s ? styles.filterActive : ''}`}
                            onClick={() => setFilter(s)}
                        >
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            <div className={`card ${styles.tableWrap}`}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Request ID</th>
                            <th>Portal URL</th>
                            <th>Status</th>
                            <th>Priority</th>
                            <th>Submitted By</th>
                            <th>Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(job => (
                            <Link key={job.job_id} href={`/history/${job.job_id}`} style={{ display: 'contents' }}>
                                <tr>
                                    <td className={styles.idCell}>{job.job_id.slice(0, 16)}</td>
                                    <td className={styles.urlCell}>{job.url}</td>
                                    <td><span className={`badge badge-${job.status}`}>{job.status}</span></td>
                                    <td className={priorityClass(job.priority)}>{job.priority}</td>
                                    <td>{job.user_id}</td>
                                    <td className={styles.timeCell}>{formatTime(job.created_at)}</td>
                                </tr>
                            </Link>
                        ))}
                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                    No jobs found
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
