'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import layoutStyles from './layout.module.css';
import { getHealth, HealthResponse } from '@/lib/api';

interface DemoJob {
  job_id: string;
  url: string;
  status: string;
  priority: string;
  created_at: string;
}

export default function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Demo data for showcase
  const demoJobs: DemoJob[] = [
    { job_id: 'job-01HQXYZ123', url: 'https://portal.aetna.com/eligibility', status: 'completed', priority: 'high', created_at: new Date(Date.now() - 120000).toISOString() },
    { job_id: 'job-01HQXYZ456', url: 'https://cigna.com/verify', status: 'running', priority: 'normal', created_at: new Date(Date.now() - 60000).toISOString() },
    { job_id: 'job-01HQXYZ789', url: 'https://uhc.com/provider-portal', status: 'queued', priority: 'low', created_at: new Date(Date.now() - 30000).toISOString() },
  ];

  const stats = {
    total: 142,
    running: 3,
    completed: 128,
    failed: 11,
  };

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setError('API unreachable — start the backend with `docker-compose up`'))
      .finally(() => setLoading(false));
  }, []);

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="fade-in">
      <div className={layoutStyles.pageHeader}>
        <h1 className={layoutStyles.pageTitle}>Monitoring</h1>
        <p className={layoutStyles.pageSubtitle}>System overview and recent activity</p>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {/* Stats */}
      <div className={styles.grid}>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Total Jobs</div>
          <div className={`${styles.statValue} ${styles.statAccent}`}>{stats.total}</div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Running</div>
          <div className={`${styles.statValue} ${styles.statWarning}`}>{stats.running}</div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Completed</div>
          <div className={`${styles.statValue} ${styles.statSuccess}`}>{stats.completed}</div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Failed</div>
          <div className={`${styles.statValue} ${styles.statError}`}>{stats.failed}</div>
        </div>
      </div>

      {/* Monitoring */}
      <div className={styles.healthSection}>
        <div className={styles.sectionTitle}>Service Monitoring</div>
        <div className={styles.healthGrid}>
          {loading ? (
            <div className={styles.loading}>
              <div className={styles.spinner}></div>
              Tracking connectivity...
            </div>
          ) : health ? (
            Object.entries(health.services).map(([name, status]) => (
              <div key={name} className={`card ${styles.healthItem}`}>
                <span className={`${styles.healthDot} ${status === 'ok' ? styles.healthDotOk : styles.healthDotError}`}></span>
                <div>
                  <div className={styles.healthName}>{name.toUpperCase()}</div>
                  <div className={styles.healthStatus}>{status === 'ok' ? 'connected' : status}</div>
                </div>
              </div>
            ))
          ) : (
            <>
              {['SQS', 'DYNAMODB', 'S3'].map(s => (
                <div key={s} className={`card ${styles.healthItem}`}>
                  <span className={`${styles.healthDot} ${styles.healthDotError}`}></span>
                  <div>
                    <div className={styles.healthName}>{s}</div>
                    <div className={styles.healthStatus}>error</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Previous Checks */}
      <div className={styles.recentSection}>
        <div className={styles.sectionTitle}>Previous Check</div>
        <div className="card">
          {demoJobs.map((job) => (
            <Link key={job.job_id} href={`/history/${job.job_id}`}>
              <div className={styles.jobRow}>
                <div className={styles.jobInfo}>
                  <span className={styles.jobId}>{job.job_id.slice(0, 16)}</span>
                  <span className={styles.jobUrl}>{job.url}</span>
                </div>
                <div className={styles.jobMeta}>
                  <span className={`badge badge-${job.status}`}>{job.status}</span>
                  <span className={styles.jobTime}>{formatTime(job.created_at)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
