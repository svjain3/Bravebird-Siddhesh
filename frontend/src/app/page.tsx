'use client';


import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import layoutStyles from './layout.module.css';
import { getHealth, getJobs, HealthResponse, JobStatusResponse } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [jobs, setJobs] = useState<JobStatusResponse[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [healthData, jobsData] = await Promise.all([
          getHealth(),
          getJobs(user?.id)
        ]);
        setHealth(healthData);
        setJobs(jobsData);
      } catch (err) {
        setError('API unreachable — start the backend with `docker-compose up`');
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      fetchData();
    }
  }, [user]);

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const stats = {
    total: jobs.length,
    running: jobs.filter(j => j.status === 'running').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed' || j.status === 'timeout').length,
  };

  return (
    <div className="fade-in">
      <div className={layoutStyles.pageHeader}>
        <h1 className={layoutStyles.pageTitle}>Monitoring</h1>
        <p className={layoutStyles.pageSubtitle}>System overview and recent activity for {user?.name}</p>
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
        <div className={styles.sectionTitle}>Recent Activity</div>
        <div className="card">
          {jobs.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              No jobs found. Submit a new job to get started.
            </div>
          ) : (
            jobs.slice(0, 10).map((job) => (
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
