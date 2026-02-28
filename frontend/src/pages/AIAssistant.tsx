import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Box, Typography, Card, TextField, IconButton, Paper, Avatar,
    CircularProgress, Chip, Stack, Tooltip,
} from '@mui/material';
import {
    Send, SmartToy, Person, DeleteSweep, ContentCopy,
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { assistantApi } from '../services/api';

/* ── types ───────────────────────────────────────────────────────── */

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
}

/* ── suggested prompts ───────────────────────────────────────────── */

const SUGGESTIONS = [
    '📊 Summarize today\'s events',
    '🚗 How many vehicles were detected?',
    '👤 Any unknown faces recently?',
    '📈 Which camera has the most activity?',
    '🔍 Describe the latest security incidents',
    '⏰ What happened in the last hour?',
];

/* ── Markdown renderer ───────────────────────────────────────────── */

const MarkdownContent: React.FC<{ content: string }> = ({ content }) => (
    <ReactMarkdown
        components={{
            code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const codeStr = String(children).replace(/\n$/, '');
                return match ? (
                    <Box sx={{ position: 'relative', my: 1 }}>
                        <Tooltip title="Copy">
                            <IconButton size="small" onClick={() => navigator.clipboard.writeText(codeStr)}
                                sx={{ position: 'absolute', top: 4, right: 4, zIndex: 1, opacity: 0.5, '&:hover': { opacity: 1 } }}>
                                <ContentCopy sx={{ fontSize: 14 }} />
                            </IconButton>
                        </Tooltip>
                        <SyntaxHighlighter style={oneDark} language={match[1]}
                            customStyle={{ borderRadius: 8, fontSize: '0.8rem', margin: 0, padding: '1rem' }}>
                            {codeStr}
                        </SyntaxHighlighter>
                    </Box>
                ) : (
                    <code style={{
                        background: 'rgba(255,255,255,0.06)', padding: '2px 6px',
                        borderRadius: 4, fontSize: '0.85em',
                    }} {...props}>{children}</code>
                );
            },
            p: ({ children }) => <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.7 }}>{children}</Typography>,
            h1: ({ children }) => <Typography variant="h6" sx={{ fontWeight: 700, mt: 1, mb: 0.5 }}>{children}</Typography>,
            h2: ({ children }) => <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 1, mb: 0.5 }}>{children}</Typography>,
            h3: ({ children }) => <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1, mb: 0.5 }}>{children}</Typography>,
            ul: ({ children }) => <Box component="ul" sx={{ pl: 2.5, mb: 1 }}>{children}</Box>,
            ol: ({ children }) => <Box component="ol" sx={{ pl: 2.5, mb: 1 }}>{children}</Box>,
            li: ({ children }) => <Typography component="li" variant="body2" sx={{ mb: 0.3, lineHeight: 1.6 }}>{children}</Typography>,
            blockquote: ({ children }) => (
                <Box sx={{ borderLeft: '3px solid rgba(79,142,247,0.4)', pl: 2, ml: 0, my: 1, color: 'text.secondary' }}>
                    {children}
                </Box>
            ),
            table: ({ children }) => (
                <Box sx={{ overflowX: 'auto', my: 1 }}>
                    <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', '& th, & td': { border: '1px solid rgba(148,163,184,0.15)', px: 1.5, py: 0.75, fontSize: '0.8rem' }, '& th': { background: 'rgba(255,255,255,0.04)', fontWeight: 600 } }}>
                        {children}
                    </Box>
                </Box>
            ),
        }}
    >
        {content}
    </ReactMarkdown>
);

/* ── Typing indicator ────────────────────────────────────────────── */

const TypingIndicator = () => (
    <Box sx={{ display: 'flex', gap: 0.5, py: 1, px: 0.5 }}>
        {[0, 1, 2].map(i => (
            <Box key={i} sx={{
                width: 7, height: 7, borderRadius: '50%',
                background: '#7C4DFF',
                animation: 'typing 1.2s infinite ease-in-out',
                animationDelay: `${i * 0.15}s`,
            }} />
        ))}
    </Box>
);

/* ── component ───────────────────────────────────────────────────── */

const AIAssistant: React.FC = () => {
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', content: 'Hello! I\'m your **AI security assistant**. I can help you analyze events, identify patterns, and answer questions about your surveillance system.\n\nTry asking me something, or pick a suggestion below! 👇', timestamp: new Date() }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => { scrollToBottom(); }, [messages, loading, scrollToBottom]);

    const handleSend = async (text?: string) => {
        const msg = (text || input).trim();
        if (!msg || loading) return;
        setInput('');

        const userMsg: Message = { role: 'user', content: msg, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setLoading(true);

        try {
            const res = await assistantApi.chat(msg);
            const assistantMsg: Message = {
                role: 'assistant',
                content: res.data.response || 'No response received.',
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, assistantMsg]);
        } catch {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: '⚠️ Sorry, I couldn\'t connect to the LLM service. Please check:\n- LLM provider is configured in Settings\n- API key is set correctly\n- Backend is running',
                timestamp: new Date(),
            }]);
        }
        setLoading(false);
        inputRef.current?.focus();
    };

    const clearChat = () => {
        setMessages([{
            role: 'assistant',
            content: 'Chat cleared. How can I help you?',
            timestamp: new Date(),
        }]);
    };

    const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
        <Box sx={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>AI Assistant</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Ask about events, people, and security incidents
                    </Typography>
                </Box>
                <Tooltip title="Clear chat">
                    <IconButton onClick={clearChat} sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}>
                        <DeleteSweep />
                    </IconButton>
                </Tooltip>
            </Box>

            {/* Chat area */}
            <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Messages */}
                <Box sx={{
                    flex: 1, overflow: 'auto', p: 3,
                    display: 'flex', flexDirection: 'column', gap: 2.5,
                    '&::-webkit-scrollbar': { width: 6 },
                    '&::-webkit-scrollbar-thumb': { background: 'rgba(148,163,184,0.15)', borderRadius: 3 },
                }}>
                    {messages.map((msg, i) => (
                        <Box key={i} sx={{
                            display: 'flex', gap: 1.5, alignItems: 'flex-start',
                            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                        }}>
                            <Avatar sx={{
                                width: 36, height: 36, mt: 0.5,
                                background: msg.role === 'user'
                                    ? 'linear-gradient(135deg, #4F8EF7, #2563EB)'
                                    : 'linear-gradient(135deg, #7C4DFF, #651FFF)',
                                boxShadow: msg.role === 'user'
                                    ? '0 2px 8px rgba(79,142,247,0.3)'
                                    : '0 2px 8px rgba(124,77,255,0.3)',
                            }}>
                                {msg.role === 'user' ? <Person sx={{ fontSize: 20 }} /> : <SmartToy sx={{ fontSize: 20 }} />}
                            </Avatar>
                            <Box sx={{ maxWidth: '75%' }}>
                                <Paper sx={{
                                    p: 2,
                                    background: msg.role === 'user'
                                        ? 'linear-gradient(135deg, rgba(79,142,247,0.15), rgba(37,99,235,0.1))'
                                        : 'rgba(255,255,255,0.03)',
                                    border: msg.role === 'user'
                                        ? '1px solid rgba(79,142,247,0.2)'
                                        : '1px solid rgba(148,163,184,0.06)',
                                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                                }}>
                                    {msg.role === 'assistant' ? (
                                        <MarkdownContent content={msg.content} />
                                    ) : (
                                        <Typography variant="body2" sx={{ lineHeight: 1.7 }}>{msg.content}</Typography>
                                    )}
                                </Paper>
                                <Typography variant="caption" color="text.secondary" sx={{
                                    display: 'block', mt: 0.5, px: 0.5,
                                    textAlign: msg.role === 'user' ? 'right' : 'left',
                                    fontSize: '0.65rem',
                                }}>
                                    {formatTime(msg.timestamp)}
                                </Typography>
                            </Box>
                        </Box>
                    ))}

                    {/* Typing indicator */}
                    {loading && (
                        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                            <Avatar sx={{
                                width: 36, height: 36,
                                background: 'linear-gradient(135deg, #7C4DFF, #651FFF)',
                                boxShadow: '0 2px 8px rgba(124,77,255,0.3)',
                            }}>
                                <SmartToy sx={{ fontSize: 20 }} />
                            </Avatar>
                            <Paper sx={{
                                p: 1.5, background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(148,163,184,0.06)',
                                borderRadius: '16px 16px 16px 4px',
                            }}>
                                <TypingIndicator />
                            </Paper>
                        </Box>
                    )}

                    <div ref={messagesEndRef} />
                </Box>

                {/* Suggestions — only show when few messages */}
                {messages.length <= 2 && !loading && (
                    <Box sx={{ px: 3, pb: 1.5 }}>
                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                            {SUGGESTIONS.map(s => (
                                <Chip
                                    key={s}
                                    label={s}
                                    size="small"
                                    onClick={() => handleSend(s)}
                                    sx={{
                                        cursor: 'pointer',
                                        borderRadius: 3,
                                        border: '1px solid rgba(148,163,184,0.1)',
                                        background: 'rgba(255,255,255,0.03)',
                                        transition: 'all 0.15s',
                                        '&:hover': {
                                            background: 'rgba(79,142,247,0.1)',
                                            borderColor: 'rgba(79,142,247,0.3)',
                                        },
                                    }}
                                />
                            ))}
                        </Stack>
                    </Box>
                )}

                {/* Input */}
                <Box sx={{
                    p: 2, borderTop: '1px solid rgba(148,163,184,0.08)',
                    display: 'flex', gap: 1, alignItems: 'center',
                }}>
                    <TextField
                        inputRef={inputRef}
                        fullWidth
                        placeholder="Ask about events, people, incidents..."
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                        size="small"
                        multiline
                        maxRows={4}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                borderRadius: 3,
                                background: 'rgba(255,255,255,0.02)',
                            },
                        }}
                    />
                    <IconButton
                        onClick={() => handleSend()}
                        disabled={loading || !input.trim()}
                        sx={{
                            width: 44, height: 44,
                            background: input.trim() ? 'linear-gradient(135deg, #4F8EF7, #2563EB)' : 'rgba(255,255,255,0.05)',
                            boxShadow: input.trim() ? '0 2px 12px rgba(79,142,247,0.3)' : 'none',
                            transition: 'all 0.2s',
                            '&:hover': { background: 'linear-gradient(135deg, #2563EB, #1D4ED8)' },
                            '&.Mui-disabled': { background: 'rgba(255,255,255,0.05)' },
                        }}
                    >
                        {loading ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : <Send sx={{ fontSize: 20, color: '#fff' }} />}
                    </IconButton>
                </Box>
            </Card>

            {/* Typing animation CSS */}
            <style>{`
                @keyframes typing {
                    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
                    30% { transform: translateY(-4px); opacity: 1; }
                }
            `}</style>
        </Box>
    );
};
export default AIAssistant;
