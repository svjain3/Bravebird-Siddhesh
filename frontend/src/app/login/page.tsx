'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import styles from './page.module.css';

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const { login } = useAuth();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (login(username, password)) {
            setError('');
        } else {
            setError('Not authenticated');
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <h1 className={styles.title}>Hospital Portal</h1>
                <p className={styles.subtitle}>Secure Access Login</p>

                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.inputGroup}>
                        <label htmlFor="username">Username</label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter username"
                            className={styles.input}
                        />
                    </div>

                    <div className={styles.inputGroup}>
                        <label htmlFor="password">Password</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter password"
                            className={styles.input}
                        />
                    </div>

                    {error && <div className={styles.error}>{error}</div>}

                    <button type="submit" className={styles.button}>
                        Sign In
                    </button>
                </form>

                <div className={styles.hint}>
                    <p>Demo Accounts:</p>
                    <ul>
                        <li>🏥 <strong>mercy_admin</strong> / Mercy@123 → <em>Mercy General</em></li>
                        <li>⚕️ <strong>stjude_admin</strong> / StJude@123 → <em>St. Jude Medical</em></li>
                        <li>🩺 <strong>cityhope_admin</strong> / CityHope@123 → <em>City Hope Clinic</em></li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
