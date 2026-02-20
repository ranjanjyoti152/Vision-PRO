import React, { useState } from 'react';
import { Box, Typography, Card, CardContent, TextField, IconButton, Paper, Avatar } from '@mui/material';
import { Send, SmartToy, Person } from '@mui/icons-material';
import { assistantApi } from '../services/api';

const AIAssistant: React.FC = () => {
    const [messages, setMessages] = useState<{ role: string; content: string }[]>([
        { role: 'assistant', content: 'Hello! I\'m your AI security assistant. Ask me about events, people, or incidents detected by the system.' }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSend = async () => {
        if (!input.trim() || loading) return;
        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setLoading(true);
        try {
            const res = await assistantApi.chat(userMsg);
            setMessages(prev => [...prev, { role: 'assistant', content: res.data.response }]);
        } catch {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please check LLM settings.' }]);
        }
        setLoading(false);
    };

    return (
        <Box sx={{ height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h4" sx={{ mb: 0.5 }}>AI Assistant</Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>Ask about events, people, and security incidents</Typography>

            <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Messages */}
                <Box sx={{ flex: 1, overflow: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {messages.map((msg, i) => (
                        <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                            <Avatar sx={{ width: 32, height: 32, background: msg.role === 'user' ? 'rgba(79,142,247,0.2)' : 'rgba(124,77,255,0.2)', color: msg.role === 'user' ? '#4F8EF7' : '#7C4DFF' }}>
                                {msg.role === 'user' ? <Person sx={{ fontSize: 18 }} /> : <SmartToy sx={{ fontSize: 18 }} />}
                            </Avatar>
                            <Paper sx={{ p: 1.5, maxWidth: '70%', background: msg.role === 'user' ? 'rgba(79,142,247,0.1)' : 'rgba(255,255,255,0.03)', borderRadius: 2 }}>
                                <Typography variant="body2">{msg.content}</Typography>
                            </Paper>
                        </Box>
                    ))}
                    {loading && <Typography variant="body2" color="text.secondary" sx={{ ml: 5 }}>Thinking...</Typography>}
                </Box>

                {/* Input */}
                <Box sx={{ p: 2, borderTop: '1px solid rgba(148,163,184,0.08)', display: 'flex', gap: 1 }}>
                    <TextField fullWidth placeholder="Ask about events, people, incidents..." value={input}
                        onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()}
                        size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }} />
                    <IconButton onClick={handleSend} disabled={loading} color="primary" sx={{ background: 'rgba(79,142,247,0.1)' }}><Send /></IconButton>
                </Box>
            </Card>
        </Box>
    );
};
export default AIAssistant;
