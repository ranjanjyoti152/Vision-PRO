import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Box, Typography, TextField, IconButton, Paper, Avatar,
    CircularProgress, Tooltip, Fade, Grow, Collapse,
} from '@mui/material';
import {
    Send, SmartToy, Person, DeleteSweep, ContentCopy,
    AutoAwesome, SecurityOutlined, Analytics, AccessTime,
    DirectionsCar, Face, CameraAlt, TrendingUp,
    Psychology, ExpandMore, ExpandLess,
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { assistantApi } from '../services/api';

/* ── types ───────────────────────────────────────────────────────── */

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    thinking?: string;
    timestamp: Date;
    context?: {
        total_events?: number;
        time_range?: string;
        type_breakdown?: Record<string, number>;
    };
    isStreaming?: boolean;
}

/* ── suggested prompts ───────────────────────────────────────────── */

const SUGGESTIONS = [
    { icon: <Analytics sx={{ fontSize: 16 }} />, text: "Summarize today's events", color: '#4F8EF7' },
    { icon: <DirectionsCar sx={{ fontSize: 16 }} />, text: 'How many vehicles detected?', color: '#10B981' },
    { icon: <Face sx={{ fontSize: 16 }} />, text: 'Any unknown faces recently?', color: '#F59E0B' },
    { icon: <CameraAlt sx={{ fontSize: 16 }} />, text: 'Which camera is most active?', color: '#8B5CF6' },
    { icon: <SecurityOutlined sx={{ fontSize: 16 }} />, text: 'Latest security incidents', color: '#EF4444' },
    { icon: <AccessTime sx={{ fontSize: 16 }} />, text: 'What happened last hour?', color: '#06B6D4' },
    { icon: <TrendingUp sx={{ fontSize: 16 }} />, text: 'Show event trends this week', color: '#EC4899' },
    { icon: <AutoAwesome sx={{ fontSize: 16 }} />, text: 'Show me latest photos', color: '#F97316' },
];

/* ── Markdown renderer ───────────────────────────────────────────── */

const MarkdownContent: React.FC<{ content: string }> = ({ content }) => (
    <ReactMarkdown
        components={{
            code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const codeStr = String(children).replace(/\n$/, '');
                return match ? (
                    <Box sx={{ position: 'relative', my: 1.5, borderRadius: 2, overflow: 'hidden' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 0.5, background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
                            <Typography variant="caption" sx={{ color: 'rgba(148,163,184,0.6)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 1 }}>{match[1]}</Typography>
                            <Tooltip title="Copy code">
                                <IconButton size="small" onClick={() => navigator.clipboard.writeText(codeStr)}
                                    sx={{ opacity: 0.4, '&:hover': { opacity: 1 } }}>
                                    <ContentCopy sx={{ fontSize: 13 }} />
                                </IconButton>
                            </Tooltip>
                        </Box>
                        <SyntaxHighlighter style={oneDark} language={match[1]}
                            customStyle={{ borderRadius: 0, fontSize: '0.78rem', margin: 0, padding: '1rem' }}>
                            {codeStr}
                        </SyntaxHighlighter>
                    </Box>
                ) : (
                    <code style={{
                        background: 'rgba(79,142,247,0.1)', padding: '2px 6px',
                        borderRadius: 4, fontSize: '0.85em', color: '#93C5FD',
                    }} {...props}>{children}</code>
                );
            },
            p: ({ children }) => <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.75, color: 'rgba(255,255,255,0.88)' }}>{children}</Typography>,
            h1: ({ children }) => <Typography variant="h6" sx={{ fontWeight: 700, mt: 1.5, mb: 0.5, background: 'linear-gradient(135deg, #4F8EF7, #7C4DFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{children}</Typography>,
            h2: ({ children }) => <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 1.5, mb: 0.5, color: '#93C5FD' }}>{children}</Typography>,
            h3: ({ children }) => <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1, mb: 0.5, color: 'rgba(255,255,255,0.8)' }}>{children}</Typography>,
            strong: ({ children }) => <strong style={{ color: '#93C5FD' }}>{children}</strong>,
            ul: ({ children }) => <Box component="ul" sx={{ pl: 2.5, mb: 1 }}>{children}</Box>,
            ol: ({ children }) => <Box component="ol" sx={{ pl: 2.5, mb: 1 }}>{children}</Box>,
            li: ({ children }) => <Typography component="li" variant="body2" sx={{ mb: 0.4, lineHeight: 1.65, color: 'rgba(255,255,255,0.82)', '&::marker': { color: '#4F8EF7' } }}>{children}</Typography>,
            blockquote: ({ children }) => (
                <Box sx={{ borderLeft: '3px solid rgba(79,142,247,0.5)', pl: 2, ml: 0, my: 1.5, py: 0.5, background: 'rgba(79,142,247,0.05)', borderRadius: '0 8px 8px 0' }}>
                    {children}
                </Box>
            ),
            table: ({ children }) => (
                <Box sx={{ overflowX: 'auto', my: 1.5, borderRadius: 2, border: '1px solid rgba(148,163,184,0.1)' }}>
                    <Box component="table" sx={{
                        borderCollapse: 'collapse', width: '100%',
                        '& th, & td': { border: '1px solid rgba(148,163,184,0.1)', px: 1.5, py: 0.75, fontSize: '0.8rem' },
                        '& th': { background: 'rgba(79,142,247,0.08)', fontWeight: 600, color: '#93C5FD' },
                        '& tr:hover td': { background: 'rgba(255,255,255,0.02)' },
                    }}>
                        {children}
                    </Box>
                </Box>
            ),
            img: ({ src, alt }) => (
                <Box sx={{ my: 1.5 }}>
                    <Box
                        component="img"
                        src={src}
                        alt={alt || 'Event snapshot'}
                        sx={{
                            maxWidth: '100%', maxHeight: 360, borderRadius: 2,
                            border: '1px solid rgba(79,142,247,0.2)',
                            display: 'block', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                        }}
                    />
                    {alt && (
                        <Typography variant="caption" sx={{ mt: 0.5, display: 'block', fontSize: '0.68rem', color: 'rgba(148,163,184,0.6)', fontStyle: 'italic' }}>
                            📷 {alt}
                        </Typography>
                    )}
                </Box>
            ),
            hr: () => <Box sx={{ my: 2, height: 1, background: 'linear-gradient(90deg, transparent, rgba(79,142,247,0.3), transparent)' }} />,
        }}
    >
        {content}
    </ReactMarkdown>
);

/* ── Typing indicator ────────────────────────────────────────────── */

const TypingIndicator = () => (
    <Box sx={{ display: 'flex', gap: 1, py: 1.5, px: 1, alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
            <Box key={i} sx={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#7C4DFF',
                animation: 'bounce 1.4s infinite ease-in-out',
                animationDelay: `${i * 0.2}s`,
            }} />
        ))}
    </Box>
);

/* ── Thinking block (collapsible) ────────────────────────────────── */

const ThinkingBlock: React.FC<{ thinking: string; isStreaming?: boolean }> = ({ thinking, isStreaming }) => {
    const [expanded, setExpanded] = useState(false);
    if (!thinking) return null;
    return (
        <Box sx={{ mb: 1.5 }}>
            <Box
                onClick={() => setExpanded(!expanded)}
                sx={{
                    display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
                    px: 1, py: 0.5, borderRadius: 1.5,
                    background: 'rgba(124,77,255,0.06)',
                    border: '1px solid rgba(124,77,255,0.12)',
                    transition: 'all 0.2s',
                    '&:hover': { background: 'rgba(124,77,255,0.1)', borderColor: 'rgba(124,77,255,0.2)' },
                }}
            >
                <Psychology sx={{ fontSize: 14, color: '#B388FF' }} />
                <Typography variant="caption" sx={{ fontSize: '0.68rem', fontWeight: 600, color: '#B388FF', flex: 1 }}>
                    {isStreaming ? 'Thinking...' : 'Thought process'}
                </Typography>
                {isStreaming && <CircularProgress size={10} sx={{ color: '#B388FF' }} />}
                {expanded ? <ExpandLess sx={{ fontSize: 14, color: '#B388FF' }} /> : <ExpandMore sx={{ fontSize: 14, color: '#B388FF' }} />}
            </Box>
            <Collapse in={expanded}>
                <Box sx={{
                    mt: 0.5, px: 1.5, py: 1, borderRadius: 1.5,
                    background: 'rgba(124,77,255,0.03)',
                    border: '1px solid rgba(124,77,255,0.08)',
                    borderTop: 'none',
                    maxHeight: 200, overflow: 'auto',
                    '&::-webkit-scrollbar': { width: 3 },
                    '&::-webkit-scrollbar-thumb': { background: 'rgba(124,77,255,0.15)', borderRadius: 3 },
                }}>
                    <Typography variant="caption" sx={{
                        whiteSpace: 'pre-wrap', fontSize: '0.68rem', lineHeight: 1.6,
                        color: 'rgba(179,136,255,0.6)', fontFamily: 'monospace',
                    }}>
                        {thinking}
                    </Typography>
                </Box>
            </Collapse>
        </Box>
    );
};

/* ── Context badge ───────────────────────────────────────────────── */

const ContextBadge: React.FC<{ context?: Message['context'] }> = ({ context }) => {
    if (!context?.total_events) return null;
    const parts: string[] = [];
    parts.push(`📊 ${context.total_events.toLocaleString()} events`);
    if (context.time_range) parts.push(`⏱ ${context.time_range}`);
    if (context.type_breakdown) {
        const types = Object.entries(context.type_breakdown)
            .map(([t, c]) => `${t}: ${c}`)
            .join(' · ');
        parts.push(types);
    }
    return (
        <Typography variant="caption" sx={{
            display: 'block', mt: 1.5, pt: 1,
            borderTop: '1px solid rgba(148,163,184,0.06)',
            fontSize: '0.62rem', color: 'rgba(148,163,184,0.4)',
            letterSpacing: '0.02em',
        }}>
            {parts.join('  •  ')}
        </Typography>
    );
};

/* ── component ───────────────────────────────────────────────────── */

const WELCOME_MSG: Message = {
    role: 'assistant',
    content: 'Hello! I\'m your **AI security assistant** powered by real-time event data. I can:\n\n- 📊 **Analyze events** — summaries, trends, and breakdowns\n- 📷 **Show snapshots** — view event photos directly in chat\n- 🔍 **Query cameras** — activity per camera\n- ⏰ **Time-based queries** — "last hour", "today", "this week"\n\nPick a suggestion below or ask anything! 👇',
    timestamp: new Date(),
};

const AIAssistant: React.FC = () => {
    const [messages, setMessages] = useState<Message[]>([WELCOME_MSG]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const cancelRef = useRef<{ cancel: () => void } | null>(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => { scrollToBottom(); }, [messages, loading, scrollToBottom]);

    // Load chat history on mount
    useEffect(() => {
        (async () => {
            try {
                const res = await assistantApi.history(1, 200);
                const history = res.data?.messages || [];
                if (history.length > 0) {
                    const loaded: Message[] = [WELCOME_MSG];
                    for (const m of history) {
                        loaded.push({
                            role: m.role,
                            content: m.content || '',
                            thinking: m.thinking || '',
                            timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
                            context: m.context,
                        });
                    }
                    setMessages(loaded);
                }
            } catch { /* ignore */ }
            setHistoryLoaded(true);
        })();
    }, []);

    const handleSend = async (text?: string) => {
        const msg = (text || input).trim();
        if (!msg || loading) return;
        setInput('');

        const userMsg: Message = { role: 'user', content: msg, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setLoading(true);

        // Create a placeholder assistant message for streaming
        const streamMsgId = Date.now();
        const streamMsg: Message = {
            role: 'assistant',
            content: '',
            thinking: '',
            timestamp: new Date(),
            isStreaming: true,
        };
        setMessages(prev => [...prev, streamMsg]);

        let accContent = '';
        let accThinking = '';
        let accContext: Message['context'] | undefined;

        cancelRef.current = assistantApi.chatStream(msg, (chunk) => {
            if (chunk.type === 'context') {
                accContext = chunk.context;
                setMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last.role === 'assistant' && last.isStreaming) {
                        msgs[msgs.length - 1] = { ...last, context: accContext };
                    }
                    return msgs;
                });
            } else if (chunk.type === 'thinking') {
                accThinking += chunk.text;
                setMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last.role === 'assistant' && last.isStreaming) {
                        msgs[msgs.length - 1] = { ...last, thinking: accThinking };
                    }
                    return msgs;
                });
            } else if (chunk.type === 'content') {
                accContent += chunk.text;
                setMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last.role === 'assistant' && last.isStreaming) {
                        msgs[msgs.length - 1] = { ...last, content: accContent };
                    }
                    return msgs;
                });
            } else if (chunk.type === 'error') {
                accContent += chunk.text;
                setMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last.role === 'assistant' && last.isStreaming) {
                        msgs[msgs.length - 1] = { ...last, content: accContent || '⚠️ Error communicating with AI.' };
                    }
                    return msgs;
                });
            } else if (chunk.type === 'done') {
                setMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last.role === 'assistant' && last.isStreaming) {
                        msgs[msgs.length - 1] = {
                            ...last,
                            isStreaming: false,
                            content: accContent || 'No response received.',
                        };
                    }
                    return msgs;
                });
                setLoading(false);
                cancelRef.current = null;
                inputRef.current?.focus();
            }
        });
    };

    const clearChat = async () => {
        try { await assistantApi.clearHistory(); } catch { /* ignore */ }
        setMessages([WELCOME_MSG]);
    };

    const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const showSuggestions = messages.length <= 1 && !loading && historyLoaded;

    return (
        <Box sx={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* ── Header ────────────────────────────────────────── */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{
                        width: 48, height: 48, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'linear-gradient(135deg, #7C4DFF, #4F8EF7)',
                        boxShadow: '0 4px 20px rgba(124,77,255,0.3)',
                    }}>
                        <SmartToy sx={{ fontSize: 26, color: '#fff' }} />
                    </Box>
                    <Box>
                        <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
                            AI Assistant
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'rgba(148,163,184,0.6)', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', animation: 'pulse 2s infinite' }} />
                            Connected to event database
                        </Typography>
                    </Box>
                </Box>
                <Tooltip title="Clear conversation">
                    <IconButton onClick={clearChat} sx={{
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.08)',
                        borderRadius: 2, '&:hover': { background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)' },
                    }}>
                        <DeleteSweep sx={{ fontSize: 20 }} />
                    </IconButton>
                </Tooltip>
            </Box>

            {/* ── Chat container ─────────────────────────────────── */}
            <Box sx={{
                flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
                borderRadius: 3, border: '1px solid rgba(148,163,184,0.08)',
                background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(20px)',
            }}>
                {/* ── Messages ──────────────────────────────────── */}
                <Box sx={{
                    flex: 1, overflow: 'auto', p: { xs: 2, md: 3 },
                    display: 'flex', flexDirection: 'column', gap: 2,
                    '&::-webkit-scrollbar': { width: 5 },
                    '&::-webkit-scrollbar-thumb': { background: 'rgba(148,163,184,0.1)', borderRadius: 3 },
                }}>
                    {messages.map((msg, i) => (
                        <Grow in key={i} timeout={300}>
                            <Box sx={{
                                display: 'flex', gap: 1.5, alignItems: 'flex-start',
                                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                            }}>
                                {/* Avatar */}
                                <Avatar sx={{
                                    width: 34, height: 34, mt: 0.3,
                                    background: msg.role === 'user'
                                        ? 'linear-gradient(135deg, #4F8EF7, #2563EB)'
                                        : 'linear-gradient(135deg, #7C4DFF, #651FFF)',
                                    boxShadow: msg.role === 'user'
                                        ? '0 2px 10px rgba(79,142,247,0.25)'
                                        : '0 2px 10px rgba(124,77,255,0.25)',
                                    border: '2px solid rgba(255,255,255,0.06)',
                                }}>
                                    {msg.role === 'user' ? <Person sx={{ fontSize: 18 }} /> : <AutoAwesome sx={{ fontSize: 18 }} />}
                                </Avatar>

                                {/* Message bubble */}
                                <Box sx={{ maxWidth: { xs: '85%', md: '70%' } }}>
                                    <Paper elevation={0} sx={{
                                        p: 2, position: 'relative',
                                        background: msg.role === 'user'
                                            ? 'linear-gradient(135deg, rgba(79,142,247,0.12), rgba(37,99,235,0.08))'
                                            : 'rgba(255,255,255,0.025)',
                                        border: msg.role === 'user'
                                            ? '1px solid rgba(79,142,247,0.18)'
                                            : '1px solid rgba(148,163,184,0.06)',
                                        borderRadius: msg.role === 'user'
                                            ? '18px 18px 4px 18px'
                                            : '18px 18px 18px 4px',
                                        transition: 'all 0.2s',
                                        '&:hover': { borderColor: msg.role === 'user' ? 'rgba(79,142,247,0.3)' : 'rgba(148,163,184,0.12)' },
                                    }}>
                                        {msg.role === 'assistant' ? (
                                            <>
                                                <ThinkingBlock thinking={msg.thinking || ''} isStreaming={msg.isStreaming && !msg.content} />
                                                <MarkdownContent content={msg.content + (msg.isStreaming ? '▍' : '')} />
                                            </>
                                        ) : (
                                            <Typography variant="body2" sx={{ lineHeight: 1.75, color: 'rgba(255,255,255,0.92)' }}>{msg.content}</Typography>
                                        )}
                                        {msg.role === 'assistant' && <ContextBadge context={msg.context} />}
                                    </Paper>
                                    <Typography variant="caption" sx={{
                                        display: 'block', mt: 0.4, px: 0.5,
                                        textAlign: msg.role === 'user' ? 'right' : 'left',
                                        fontSize: '0.6rem', color: 'rgba(148,163,184,0.35)',
                                    }}>
                                        {formatTime(msg.timestamp)}
                                    </Typography>
                                </Box>
                            </Box>
                        </Grow>
                    ))}

                    <div ref={messagesEndRef} />
                </Box>

                {/* ── Suggestions grid ──────────────────────────── */}
                {showSuggestions && (
                    <Box sx={{ px: { xs: 2, md: 3 }, pb: 2 }}>
                        <Box sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr 1fr', md: '1fr 1fr 1fr 1fr' },
                            gap: 1,
                        }}>
                            {SUGGESTIONS.map(s => (
                                <Box
                                    key={s.text}
                                    onClick={() => handleSend(s.text)}
                                    sx={{
                                        display: 'flex', alignItems: 'center', gap: 1,
                                        px: 1.5, py: 1.2, borderRadius: 2, cursor: 'pointer',
                                        border: '1px solid rgba(148,163,184,0.08)',
                                        background: 'rgba(255,255,255,0.02)',
                                        transition: 'all 0.2s ease',
                                        '&:hover': {
                                            background: `${s.color}12`,
                                            borderColor: `${s.color}30`,
                                            transform: 'translateY(-1px)',
                                            boxShadow: `0 4px 12px ${s.color}15`,
                                        },
                                    }}
                                >
                                    <Box sx={{ color: s.color, display: 'flex' }}>{s.icon}</Box>
                                    <Typography variant="caption" sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.3 }}>
                                        {s.text}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                )}

                {/* ── Input area ────────────────────────────────── */}
                <Box sx={{
                    p: 2, borderTop: '1px solid rgba(148,163,184,0.06)',
                    background: 'rgba(15,23,42,0.4)',
                }}>
                    <Box sx={{
                        display: 'flex', gap: 1, alignItems: 'flex-end',
                        p: 0.5, borderRadius: 3,
                        border: '1px solid rgba(148,163,184,0.1)',
                        background: 'rgba(255,255,255,0.02)',
                        transition: 'border-color 0.2s',
                        '&:focus-within': {
                            borderColor: 'rgba(79,142,247,0.3)',
                            boxShadow: '0 0 0 3px rgba(79,142,247,0.05)',
                        },
                    }}>
                        <TextField
                            inputRef={inputRef}
                            fullWidth
                            placeholder="Ask about events, cameras, security incidents..."
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                            size="small"
                            multiline
                            maxRows={4}
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    border: 'none', borderRadius: 2.5,
                                    background: 'transparent',
                                    '& fieldset': { border: 'none' },
                                    '& input, & textarea': { fontSize: '0.88rem' },
                                },
                            }}
                        />
                        <IconButton
                            onClick={() => handleSend()}
                            disabled={loading || !input.trim()}
                            sx={{
                                width: 40, height: 40, mb: 0.3, mr: 0.3,
                                borderRadius: 2.5,
                                background: input.trim()
                                    ? 'linear-gradient(135deg, #4F8EF7, #7C4DFF)'
                                    : 'rgba(255,255,255,0.04)',
                                boxShadow: input.trim() ? '0 2px 12px rgba(79,142,247,0.3)' : 'none',
                                transition: 'all 0.25s ease',
                                '&:hover': {
                                    background: 'linear-gradient(135deg, #2563EB, #651FFF)',
                                    transform: 'scale(1.05)',
                                },
                                '&.Mui-disabled': { background: 'rgba(255,255,255,0.03)' },
                            }}
                        >
                            {loading ? (
                                <CircularProgress size={18} sx={{ color: 'rgba(255,255,255,0.5)' }} />
                            ) : (
                                <Send sx={{ fontSize: 18, color: input.trim() ? '#fff' : 'rgba(255,255,255,0.2)' }} />
                            )}
                        </IconButton>
                    </Box>
                    <Typography variant="caption" sx={{
                        display: 'block', textAlign: 'center', mt: 1,
                        color: 'rgba(148,163,184,0.3)', fontSize: '0.6rem',
                    }}>
                        AI responses are based on your surveillance event data • Press Enter to send
                    </Typography>
                </Box>
            </Box>

            {/* ── CSS Animations ─────────────────────────────────── */}
            <style>{`
                @keyframes typing {
                    0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
                    30% { transform: translateY(-5px); opacity: 1; }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
                @keyframes blink {
                    0%, 50% { opacity: 1; }
                    51%, 100% { opacity: 0; }
                }
            `}</style>
        </Box>
    );
};

export default AIAssistant;
