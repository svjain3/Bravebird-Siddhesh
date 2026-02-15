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

const MODELS = [
    { id: 'haiku', label: 'Claude 3 Haiku', desc: 'Fast' },
    { id: 'sonnet', label: 'Claude 3 Sonnet', desc: 'Balanced' },
    { id: 'sonnet35', label: 'Claude 3.5 Sonnet', desc: 'Best' },
];

const STORAGE_KEY_PREFIX = 'bravebird_chat_';
const MAX_STORED_MESSAGES = 100;

export default function EligibilityPage() {
    const { user } = useAuth();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [model, setModel] = useState('haiku');
    const [initialized, setInitialized] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Load chat history from localStorage on mount
    useEffect(() => {
        if (!user) return;
        const key = STORAGE_KEY_PREFIX + user.id;
        try {
            const stored = localStorage.getItem(key);
            if (stored) {
                const parsed = JSON.parse(stored) as ChatMessage[];
                // Restore Date objects from ISO strings
                const restored = parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
                setMessages(restored);
                setInitialized(true);
                return;
            }
        } catch { /* ignore corrupt data */ }

        // First visit — show welcome
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
        setInitialized(true);
    }, [user]);

    // Persist messages to localStorage whenever they change
    useEffect(() => {
        if (!user || !initialized || messages.length === 0) return;
        const key = STORAGE_KEY_PREFIX + user.id;
        // Cap stored messages to prevent localStorage bloat
        const toStore = messages.slice(-MAX_STORED_MESSAGES);
        localStorage.setItem(key, JSON.stringify(toStore));
    }, [messages, user, initialized]);

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
                body: JSON.stringify({ message: text, model }),
            });

            if (!res.ok) throw new Error(res.statusText);

            const data = await res.json();
            const modelLabel = MODELS.find(m => m.id === model)?.label || model;
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `${data.response || data.detail || 'No response'}\n\n_via ${modelLabel}_`,
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

    function clearChat() {
        if (!user) return;
        localStorage.removeItem(STORAGE_KEY_PREFIX + user.id);
        setMessages([{
            role: 'assistant',
            content: `Chat cleared. How can I help you with **${user.hospital}** patient eligibility?`,
            actions: ['Check Patient 101', 'Check Patient 106'],
            timestamp: new Date(),
        }]);
    }

    return (
        <div className={styles.chatContainer}>
            {/* Header */}
            <div className={styles.chatHeader}>
                <div className={styles.chatHeaderLeft}>
                    <h2>Eligibility Assistant</h2>
                    {user?.hospital && <span className={styles.hospitalBadge}>{user.hospital}</span>}
                </div>
                <button className={styles.clearBtn} onClick={clearChat} title="Clear conversation">
                    🗑️ Clear Chat
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
                    autoFocus
                />
                <select
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className={styles.modelSelectInput}
                >
                    {MODELS.map(m => (
                        <option key={m.id} value={m.id}>{m.label} ({m.desc})</option>
                    ))}
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
        .replace(/_(.*?)_/g, '<em>$1</em>')
        .replace(/\n/g, '<br/>');
}
