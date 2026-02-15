'use client';

import { useState, useRef, useEffect } from 'react';
import styles from './eligibility.module.css';

const API_BASE = '';

const HOSPITALS = [
    { id: 'Mercy General', label: 'Mercy General', icon: '🏥' },
    { id: 'St. Jude Medical', label: 'St. Jude Medical', icon: '⚕️' },
    { id: 'City Hope Clinic', label: 'City Hope Clinic', icon: '🩺' },
];

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    actions?: string[];
    timestamp: Date;
}

export default function EligibilityPage() {
    const [hospital, setHospital] = useState('');
    const [loggedIn, setLoggedIn] = useState(false);
    const [loginStep, setLoginStep] = useState<'hospital-select' | 'credential-entry'>('hospital-select');
    const [userId, setUserId] = useState('');
    const [password, setPassword] = useState('');
    const [authError, setAuthError] = useState('');

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [model, setModel] = useState('claude');
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    function handleHospitalSelect(hospitalId: string) {
        setHospital(hospitalId);
        setLoginStep('credential-entry');
        setAuthError('');
    }

    function handleCredentialSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!userId || !password) {
            setAuthError('Please enter both User ID and Password');
            return;
        }

        // MOCK AUTH: In a real app, this would be an API call
        setLoggedIn(true);
        setMessages([{
            role: 'system',
            content: `Authenticated as **${userId}** at **${hospital}**. Secure session established.`,
            timestamp: new Date(),
        }, {
            role: 'assistant',
            content: `Welcome! I'm your eligibility assistant for **${hospital}**. I can look up patient benefits, coverage details, and verify eligibility.\n\nTry asking:\n• "Check eligibility for patient 101"\n• "What are the benefits for ID 107?"`,
            actions: ['Check Patient 101', 'Check Patient 106', 'Check Patient 111'],
            timestamp: new Date(),
        }]);
    }

    function handleLogout() {
        setLoggedIn(false);
        setLoginStep('hospital-select');
        setHospital('');
        setUserId('');
        setPassword('');
        setMessages([]);
    }

    async function sendMessage(text: string) {
        // ... (sendMessage body remains same)
        if (!text.trim()) return;
        const userMsg: ChatMessage = { role: 'user', content: text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        try {
            const res = await fetch(`${API_BASE}/get_eligibility_chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Hospital-ID': hospital,
                },
                body: JSON.stringify({ message: text, model }),
            });
            const data = await res.json();
            const assistantMsg: ChatMessage = {
                role: 'assistant',
                content: data.response || data.detail || 'No response',
                actions: data.suggested_actions,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, assistantMsg]);
        } catch (err) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: '⚠️ Failed to connect to the API. Make sure the backend is running.',
                timestamp: new Date(),
            }]);
        } finally {
            setLoading(false);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    }

    // LOGIN SCREEN
    if (!loggedIn) {
        return (
            <div className={styles.loginContainer}>
                <div className={styles.loginCard}>
                    <div className={styles.loginHeader}>
                        <div className={styles.loginLogo}>B</div>
                        <h1>Bravebird Eligibility</h1>
                        <p>{loginStep === 'hospital-select' ? 'Select your hospital to sign in' : `Login to ${hospital}`}</p>
                    </div>

                    {loginStep === 'hospital-select' ? (
                        <div className={styles.hospitalSelectionContainer}>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>Select Your Facility</label>
                                <div className={styles.dropdownWrapper}>
                                    <span className={styles.dropdownIcon}>🏥</span>
                                    <select
                                        className={styles.hospitalDropdown}
                                        value={hospital}
                                        onChange={(e) => setHospital(e.target.value)}
                                    >
                                        <option value="" disabled>Choose a hospital...</option>
                                        {HOSPITALS.map(h => (
                                            <option key={h.id} value={h.id}>
                                                {h.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <button
                                className={styles.loginBtn}
                                disabled={!hospital}
                                onClick={() => setLoginStep('credential-entry')}
                            >
                                Continue
                            </button>
                        </div>
                    ) : (
                        <form className={styles.credentialForm} onSubmit={handleCredentialSubmit}>
                            <button type="button" className={styles.backBtn} onClick={() => setLoginStep('hospital-select')}>
                                ← Back to hospital selection
                            </button>

                            <div className={styles.formGroup}>
                                <label>User ID</label>
                                <input
                                    className={styles.inputField}
                                    type="text"
                                    placeholder="Enter your ID"
                                    value={userId}
                                    onChange={(e) => setUserId(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Password</label>
                                <input
                                    className={styles.inputField}
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>

                            {authError && <div className={styles.errorMsg}>{authError}</div>}

                            <button type="submit" className={styles.loginBtn}>
                                Sign In
                            </button>
                        </form>
                    )}

                    <p className={styles.loginFooter}>
                        Each hospital can only access their own patient records.
                    </p>
                </div>
            </div>
        );
    }

    // CHAT SCREEN
    return (
        <div className={styles.chatContainer}>
            {/* Header */}
            <div className={styles.chatHeader}>
                <div className={styles.chatHeaderLeft}>
                    <h2>Eligibility Assistant</h2>
                    <span className={styles.hospitalBadge}>{hospital}</span>
                </div>
                <button className={styles.logoutBtn} onClick={handleLogout}>
                    Sign Out
                </button>
            </div>

            {/* Messages */}
            <div className={styles.chatMessages}>
                {messages.map((msg, i) => (
                    <div key={i} className={`${styles.message} ${styles[`message_${msg.role}`]}`}>
                        {msg.role === 'assistant' && <div className={styles.avatar}>🤖</div>}
                        {msg.role === 'system' && <div className={styles.avatar}>🔒</div>}
                        <div className={styles.messageBody}>
                            <div className={styles.messageContent}
                                dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }}
                            />
                            {msg.actions && (
                                <div className={styles.actionButtons}>
                                    {msg.actions.map((action, j) => (
                                        <button key={j} className={styles.actionBtn}
                                            onClick={() => sendMessage(action)}>
                                            {action}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <span className={styles.messageTime}>
                                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                        {msg.role === 'user' && <div className={styles.avatar}>👤</div>}
                    </div>
                ))}
                {loading && (
                    <div className={`${styles.message} ${styles.message_assistant}`}>
                        <div className={styles.avatar}>🤖</div>
                        <div className={styles.messageBody}>
                            <div className={styles.typingIndicator}>
                                <span></span><span></span><span></span>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className={styles.chatInput}>
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about patient eligibility..."
                    disabled={loading}
                />
                <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className={styles.modelSelectInput}
                >
                    <option value="claude">Claude 3</option>
                    <option value="titan">Titan</option>
                </select>
                <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()}>
                    Send
                </button>
            </div>
        </div>
    );
}

function formatMarkdown(text: string): string {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br/>');
}
