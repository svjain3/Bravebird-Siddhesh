'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import layoutStyles from '../layout.module.css';
import { getJobs, JobStatusResponse } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const statusFilters = ['all', 'queued', 'running', 'completed', 'failed'];

export default function JobsPage() {
    const { user } = useAuth();
    const [jobs, setJobs] = useState<JobStatusResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (user) {
            getJobs(user.id)
                .then(setJobs)
                .catch(err => console.error('Failed to fetch jobs:', err))
                .finally(() => setLoading(false));
        }
    }, [user]);

    const filtered = jobs.filter(j => {
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
                <p className={layoutStyles.pageSubtitle}>View historical automation tasks and results for {user?.name}</p>
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
                {loading ? (
                    <div style={{ padding: '2rem', textAlign: 'center' }}>Loading jobs...</div>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Request ID</th>
                                <th>Portal URL</th>
                                <th>Status</th>
                                <th>Priority</th>
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
                                        <td className={styles.timeCell}>{formatTime(job.created_at)}</td>
                                    </tr>
                                </Link>
                            ))}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                        No jobs found
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
