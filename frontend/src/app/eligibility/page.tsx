'use client';

import { useState, useRef, useEffect } from 'react';
import styles from './eligibility.module.css';
import { useAuth } from '@/context/AuthContext';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    actions?: string[];
    timestamp: Date;
}

export default function EligibilityPage() {
    const { user } = useAuth();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Show welcome message once user is available
    useEffect(() => {
        if (user && messages.length === 0) {
            setMessages([{
                role: 'system',
                content: `🔒 Logged in as **${user.name}** — **${user.hospital}**`,
                timestamp: new Date(),
            }, {
                role: 'assistant',
                content: `Welcome! I'm your eligibility assistant for **${user.hospital}**.\n\nI can look up patient benefits, coverage details, and verify eligibility.\n\nTry asking:\n• "Check eligibility for patient 101"\n• "What are the benefits for ID 107?"`,
                actions: ['Check Patient 101', 'Check Patient 106', 'Check Patient 111'],
                timestamp: new Date(),
            }]);
        }
    }, [user, messages.length]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    async function sendMessage(text: string) {
        if (!text.trim() || !user) return;

        setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date() }]);
        setInput('');
        setLoading(true);

        try {
            const res = await fetch(`${API_BASE}/get_eligibility_chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Hospital-ID': user.hospital,
                },
                body: JSON.stringify({ message: text, model: 'claude' }),
            });

            if (!res.ok) throw new Error(res.statusText);

            const data = await res.json();
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: data.response || data.detail || 'No response',
                actions: data.suggested_actions,
                timestamp: new Date(),
            }]);
        } catch {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: '⚠️ Failed to connect to the AI service. Please try again later.',
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

    return (
        <div className={styles.chatContainer}>
            {/* Header */}
            <div className={styles.chatHeader}>
                <div className={styles.chatHeaderLeft}>
                    <h2>Eligibility Assistant</h2>
                    {user?.hospital && <span className={styles.hospitalBadge}>{user.hospital}</span>}
                </div>
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
                    autoFocus
                />
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
