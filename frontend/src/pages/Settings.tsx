import React, { useEffect, useState, useCallback } from 'react';
import {
    Box, Typography, Card, CardContent, TextField, Button, Switch,
    FormControlLabel, Select, MenuItem, FormControl,
    Tabs, Tab, Stack, Alert, Snackbar, CircularProgress, Chip,
    IconButton, InputAdornment, Autocomplete, Grid,
} from '@mui/material';
import {
    Storage, Notifications, SmartToy, Save, Send, Refresh,
    Telegram, Email, WhatsApp, Visibility, VisibilityOff,
    FolderOpen, Timer,
} from '@mui/icons-material';
import { settingsApi } from '../services/api';

/* ── Brand SVG icons ───────────────────────────────────────────── */

const OllamaIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14c-2.67 0-5.02-1.35-6.41-3.41C7.18 14.13 9.55 13 12 13s4.82 1.13 6.41 2.59C17.02 17.65 14.67 19 12 19z" />
    </svg>
);

const OpenAIIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.28 9.37a5.99 5.99 0 00-.52-4.93 6.07 6.07 0 00-6.54-2.88A5.99 5.99 0 0010.68 0a6.07 6.07 0 00-5.8 4.27 5.99 5.99 0 00-4 2.9 6.07 6.07 0 00.74 7.11 5.99 5.99 0 00.52 4.93 6.07 6.07 0 006.54 2.88A5.99 5.99 0 0013.32 24a6.07 6.07 0 005.8-4.27 5.99 5.99 0 004-2.9 6.07 6.07 0 00-.74-7.11zM13.32 22.5a4.49 4.49 0 01-2.88-1.05l.14-.08 4.79-2.77a.78.78 0 00.39-.67v-6.76l2.02 1.17a.07.07 0 01.04.06v5.59a4.5 4.5 0 01-4.5 4.51zM3.62 18.37a4.49 4.49 0 01-.54-3.01l.14.09 4.79 2.77a.78.78 0 00.78 0l5.85-3.38v2.33a.07.07 0 01-.03.06l-4.84 2.8a4.5 4.5 0 01-6.15-1.66zM2.34 7.87a4.49 4.49 0 012.36-1.97v5.7a.78.78 0 00.39.67l5.85 3.38-2.02 1.17a.07.07 0 01-.07 0l-4.84-2.8A4.5 4.5 0 012.34 7.87zm17.36 4.04l-5.85-3.38 2.02-1.17a.07.07 0 01.07 0l4.84 2.8a4.5 4.5 0 01-.69 7.87v-5.7a.78.78 0 00-.39-.42zm2.01-3.03l-.14-.09-4.79-2.77a.78.78 0 00-.78 0l-5.85 3.38V7.07a.07.07 0 01.03-.06l4.84-2.8a4.5 4.5 0 016.69 4.67zM9.61 14.36l-2.02-1.17a.07.07 0 01-.04-.06V7.54a4.5 4.5 0 017.38-3.46l-.14.08-4.79 2.77a.78.78 0 00-.39.67v6.76zm1.1-2.37l2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3z" />
    </svg>
);

const GeminiIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C12 6.627 17.373 12 24 12C17.373 12 12 17.373 12 24C12 17.373 6.627 12 0 12C6.627 12 12 6.627 12 0Z" />
    </svg>
);

const OpenRouterIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        <path d="M2 17l10 5 10-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 12l10 5 10-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 7l10 5 10-5-10-5-10 5z" fill="currentColor" />
    </svg>
);

/* ── Tab panel helper ──────────────────────────────────────────── */

const TabPanel: React.FC<{ value: number; index: number; children: React.ReactNode }> = ({ value, index, children }) => (
    <Box role="tabpanel" hidden={value !== index} sx={{ pt: 3 }}>
        {value === index && children}
    </Box>
);

/* ── Section card wrapper ───────────────────────────────────────── */

const SectionCard: React.FC<{
    icon: React.ReactNode; title: string; subtitle?: string;
    color: string; badge?: React.ReactNode; children: React.ReactNode;
}> = ({ icon, title, subtitle, color, badge, children }) => (
    <Card sx={{ border: `1px solid ${color}20`, mb: 2.5 }}>
        <CardContent sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
                <Box sx={{
                    width: 36, height: 36, borderRadius: 2, background: `${color}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0,
                }}>
                    {icon}
                </Box>
                <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>{title}</Typography>
                    {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
                </Box>
                {badge}
            </Box>
            {children}
        </CardContent>
    </Card>
);

/* ── component ───────────────────────────────────────────────────── */

const Settings: React.FC = () => {
    const [tab, setTab] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'info' });
    const showSnack = (message: string, severity: 'success' | 'error' | 'info' = 'success') => setSnack({ open: true, message, severity });

    const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
    const togglePassword = (key: string) => setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));

    const [providerModels, setProviderModels] = useState<Record<string, string[]>>({
        ollama: [], openai: [], gemini: [], openrouter: [],
    });
    const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});

    const [storage, setStorage] = useState({ recording_path: './recordings', retention_days: 30, auto_delete: true });

    const [notif, setNotif] = useState({
        telegram_enabled: false, telegram_bot_token: '', telegram_chat_id: '',
        whatsapp_enabled: false, whatsapp_api_url: '', whatsapp_api_key: '', whatsapp_phone_number: '',
        email_enabled: false, email_smtp_host: '', email_smtp_port: 587, email_smtp_user: '',
        email_smtp_password: '', email_from_address: '', email_to_addresses: [] as string[],
    });

    const [llm, setLlm] = useState({
        active_provider: '' as string,
        ollama_enabled: false, ollama_base_url: 'http://localhost:11434', ollama_default_model: '', ollama_vision_model: '',
        openai_enabled: false, openai_api_key: '', openai_base_url: 'https://api.openai.com/v1', openai_default_model: 'gpt-4o',
        gemini_enabled: false, gemini_api_key: '', gemini_default_model: 'gemini-2.0-flash',
        openrouter_enabled: false, openrouter_api_key: '', openrouter_default_model: '',
    });

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [s, n, l] = await Promise.all([settingsApi.getStorage(), settingsApi.getNotifications(), settingsApi.getLLM()]);
            if (s.data) setStorage(s.data);
            if (n.data) setNotif(prev => ({ ...prev, ...n.data }));
            if (l.data) setLlm(prev => ({ ...prev, ...l.data }));
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    /* ── Auto-fetch models ── */
    const fetchModels = useCallback(async (provider: string) => {
        setFetchingModels(prev => ({ ...prev, [provider]: true }));
        try {
            let baseUrl = '', apiKey = '';
            if (provider === 'ollama') baseUrl = llm.ollama_base_url;
            else if (provider === 'openai') { baseUrl = llm.openai_base_url; apiKey = llm.openai_api_key; }
            else if (provider === 'gemini') apiKey = llm.gemini_api_key;
            else if (provider === 'openrouter') apiKey = llm.openrouter_api_key;
            const res = await settingsApi.fetchModels(provider, baseUrl, apiKey);
            setProviderModels(prev => ({ ...prev, [provider]: res.data.models || [] }));
        } catch (e: any) {
            showSnack(`Failed to fetch ${provider} models: ${e.response?.data?.detail || e.message}`, 'error');
        }
        setFetchingModels(prev => ({ ...prev, [provider]: false }));
    }, [llm]);

    useEffect(() => { if (llm.ollama_enabled && providerModels.ollama.length === 0) fetchModels('ollama'); }, [llm.ollama_enabled]); // eslint-disable-line
    useEffect(() => { if (llm.openai_enabled && llm.openai_api_key && providerModels.openai.length === 0) fetchModels('openai'); }, [llm.openai_enabled, llm.openai_api_key]); // eslint-disable-line
    useEffect(() => { if (llm.gemini_enabled && llm.gemini_api_key && providerModels.gemini.length === 0) fetchModels('gemini'); }, [llm.gemini_enabled, llm.gemini_api_key]); // eslint-disable-line
    useEffect(() => { if (llm.openrouter_enabled && providerModels.openrouter.length === 0) fetchModels('openrouter'); }, [llm.openrouter_enabled]); // eslint-disable-line

    const saveStorage = async () => { setSaving(true); try { await settingsApi.updateStorage(storage); showSnack('Storage settings saved'); } catch { showSnack('Failed to save', 'error'); } setSaving(false); };
    const saveNotifications = async () => {
        setSaving(true);
        try {
            await settingsApi.updateNotifications({
                telegram: { enabled: notif.telegram_enabled, bot_token: notif.telegram_bot_token, chat_id: notif.telegram_chat_id },
                whatsapp: { enabled: notif.whatsapp_enabled, api_url: notif.whatsapp_api_url, api_key: notif.whatsapp_api_key, phone_number: notif.whatsapp_phone_number },
                email: { enabled: notif.email_enabled, smtp_host: notif.email_smtp_host, smtp_port: notif.email_smtp_port, smtp_user: notif.email_smtp_user, smtp_password: notif.email_smtp_password, from_address: notif.email_from_address, to_addresses: notif.email_to_addresses },
            });
            showSnack('Notification settings saved');
        } catch { showSnack('Failed to save', 'error'); } setSaving(false);
    };
    const saveLLM = async () => {
        setSaving(true);
        try {
            await settingsApi.updateLLM({
                active_provider: llm.active_provider || null,
                ollama: { enabled: llm.ollama_enabled, base_url: llm.ollama_base_url, default_model: llm.ollama_default_model, vision_model: llm.ollama_vision_model },
                openai: { enabled: llm.openai_enabled, api_key: llm.openai_api_key, base_url: llm.openai_base_url, default_model: llm.openai_default_model },
                gemini: { enabled: llm.gemini_enabled, api_key: llm.gemini_api_key, default_model: llm.gemini_default_model },
                openrouter: { enabled: llm.openrouter_enabled, api_key: llm.openrouter_api_key, default_model: llm.openrouter_default_model },
            });
            showSnack('LLM settings saved');
        } catch { showSnack('Failed to save', 'error'); } setSaving(false);
    };

    const testNotification = async (provider: string) => {
        try { const res = await settingsApi.testNotification(provider); showSnack(res.data.message, 'info'); }
        catch { showSnack('Test failed', 'error'); }
    };

    const PasswordField: React.FC<{ label: string; value: string; fieldKey: string; onChange: (v: string) => void }> = ({ label, value, fieldKey, onChange }) => (
        <TextField fullWidth size="small" label={label} value={value} onChange={e => onChange(e.target.value)}
            type={showPasswords[fieldKey] ? 'text' : 'password'}
            slotProps={{
                input: {
                    endAdornment: (
                        <InputAdornment position="end">
                            <IconButton size="small" onClick={() => togglePassword(fieldKey)}>
                                {showPasswords[fieldKey] ? <VisibilityOff sx={{ fontSize: 18 }} /> : <Visibility sx={{ fontSize: 18 }} />}
                            </IconButton>
                        </InputAdornment>
                    )
                }
            }} />
    );

    const ModelSelector: React.FC<{ provider: string; value: string; onChange: (v: string) => void; label?: string }> = ({ provider, value, onChange, label = 'Default Model' }) => {
        const models = providerModels[provider] || [];
        const isFetching = fetchingModels[provider] || false;
        return (
            <Stack direction="row" spacing={1} alignItems="flex-start">
                <Autocomplete fullWidth size="small" freeSolo options={models} value={value}
                    onInputChange={(_, v) => onChange(v)} loading={isFetching}
                    renderInput={(params) => (
                        <TextField {...params} label={label}
                            placeholder={isFetching ? 'Fetching models...' : models.length > 0 ? `${models.length} models available` : 'Type model name'}
                            slotProps={{ input: { ...params.InputProps, endAdornment: (<>{isFetching && <CircularProgress size={16} />}{params.InputProps.endAdornment}</>) } }} />
                    )} />
                <IconButton size="small" onClick={() => fetchModels(provider)} disabled={isFetching}
                    sx={{ mt: 0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}>
                    <Refresh sx={{ fontSize: 20, animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
                </IconButton>
            </Stack>
        );
    };

    const StatusBadge: React.FC<{ enabled: boolean }> = ({ enabled }) => (
        <Chip label={enabled ? 'Enabled' : 'Disabled'} size="small"
            sx={{
                height: 22, fontSize: 10, fontWeight: 600,
                background: enabled ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)',
                color: enabled ? '#00E676' : 'text.secondary',
            }} />
    );

    const SaveButton: React.FC<{ onClick: () => void; label: string }> = ({ onClick, label }) => (
        <Button variant="contained" onClick={onClick} disabled={saving}
            startIcon={saving ? <CircularProgress size={16} /> : <Save />}
            sx={{
                borderRadius: 2, textTransform: 'none', fontWeight: 600, px: 3, py: 1,
                background: 'linear-gradient(135deg, #4F8EF7, #7C4DFF)',
                '&:hover': { background: 'linear-gradient(135deg, #3D7CE5, #6A3BE3)' },
            }}>
            {label}
        </Button>
    );

    if (loading) return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress /></Box>
    );

    return (
        <Box>
            <Box sx={{ mb: 3 }}>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>Settings</Typography>
                <Typography variant="body2" color="text.secondary">Configure storage, notifications, and AI providers</Typography>
            </Box>

            <Box sx={{ borderBottom: '1px solid rgba(148,163,184,0.08)', mb: 3 }}>
                <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{
                    '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 48, fontSize: '0.9rem' },
                    '& .MuiTabs-indicator': { height: 3, borderRadius: '3px 3px 0 0' },
                }}>
                    <Tab icon={<Storage sx={{ fontSize: 18 }} />} iconPosition="start" label="Storage" />
                    <Tab icon={<Notifications sx={{ fontSize: 18 }} />} iconPosition="start" label="Notifications" />
                    <Tab icon={<SmartToy sx={{ fontSize: 18 }} />} iconPosition="start" label="LLM Providers" />
                </Tabs>
            </Box>

            {/* ── Storage Tab ───────────────────────────── */}
            <TabPanel value={tab} index={0}>
                <Grid container spacing={3}>
                    <Grid size={{ xs: 12, md: 8, lg: 6 }}>
                        <SectionCard icon={<FolderOpen sx={{ fontSize: 20 }} />} title="Recording Storage"
                            subtitle="Configure where recordings are stored" color="#4F8EF7">
                            <Stack spacing={2.5}>
                                <TextField fullWidth size="small" label="Recording Path" value={storage.recording_path}
                                    onChange={e => setStorage(s => ({ ...s, recording_path: e.target.value }))}
                                    slotProps={{ input: { startAdornment: <InputAdornment position="start"><FolderOpen sx={{ fontSize: 18, color: 'text.secondary' }} /></InputAdornment> } }} />
                                <TextField fullWidth size="small" label="Retention (days)" type="number" value={storage.retention_days}
                                    onChange={e => setStorage(s => ({ ...s, retention_days: Number(e.target.value) }))}
                                    slotProps={{ htmlInput: { min: 1, max: 365 }, input: { startAdornment: <InputAdornment position="start"><Timer sx={{ fontSize: 18, color: 'text.secondary' }} /></InputAdornment> } }} />
                                <FormControlLabel
                                    control={<Switch checked={storage.auto_delete} onChange={e => setStorage(s => ({ ...s, auto_delete: e.target.checked }))} />}
                                    label={<Box>
                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>Auto-delete old recordings</Typography>
                                        <Typography variant="caption" color="text.secondary">Automatically remove recordings older than the retention period</Typography>
                                    </Box>} />
                            </Stack>
                        </SectionCard>
                        <SaveButton onClick={saveStorage} label="Save Storage Settings" />
                    </Grid>
                </Grid>
            </TabPanel>

            {/* ── Notifications Tab ─────────────────────── */}
            <TabPanel value={tab} index={1}>
                <Grid container spacing={3}>
                    <Grid size={{ xs: 12, lg: 6 }}>
                        {/* Telegram */}
                        <SectionCard icon={<Telegram sx={{ fontSize: 20 }} />} title="Telegram" subtitle="Send alerts via Telegram bot"
                            color="#29B6F6" badge={<StatusBadge enabled={notif.telegram_enabled} />}>
                            <Stack spacing={2}>
                                <FormControlLabel
                                    control={<Switch checked={notif.telegram_enabled} onChange={e => setNotif(n => ({ ...n, telegram_enabled: e.target.checked }))} />}
                                    label="Enable Telegram notifications" />
                                {notif.telegram_enabled && (<>
                                    <PasswordField label="Bot Token" value={notif.telegram_bot_token} fieldKey="tg_token"
                                        onChange={v => setNotif(n => ({ ...n, telegram_bot_token: v }))} />
                                    <TextField fullWidth size="small" label="Chat ID" value={notif.telegram_chat_id}
                                        onChange={e => setNotif(n => ({ ...n, telegram_chat_id: e.target.value }))} />
                                    <Button size="small" variant="outlined" startIcon={<Send />} onClick={() => testNotification('telegram')}
                                        sx={{ alignSelf: 'flex-start', borderRadius: 2, textTransform: 'none' }}>Send Test</Button>
                                </>)}
                            </Stack>
                        </SectionCard>

                        {/* WhatsApp */}
                        <SectionCard icon={<WhatsApp sx={{ fontSize: 20 }} />} title="WhatsApp" subtitle="Send alerts via WhatsApp API"
                            color="#25D366" badge={<StatusBadge enabled={notif.whatsapp_enabled} />}>
                            <Stack spacing={2}>
                                <FormControlLabel
                                    control={<Switch checked={notif.whatsapp_enabled} onChange={e => setNotif(n => ({ ...n, whatsapp_enabled: e.target.checked }))} />}
                                    label="Enable WhatsApp notifications" />
                                {notif.whatsapp_enabled && (<>
                                    <TextField fullWidth size="small" label="API URL" value={notif.whatsapp_api_url}
                                        onChange={e => setNotif(n => ({ ...n, whatsapp_api_url: e.target.value }))} />
                                    <PasswordField label="API Key" value={notif.whatsapp_api_key} fieldKey="wa_key"
                                        onChange={v => setNotif(n => ({ ...n, whatsapp_api_key: v }))} />
                                    <TextField fullWidth size="small" label="Phone Number" value={notif.whatsapp_phone_number}
                                        onChange={e => setNotif(n => ({ ...n, whatsapp_phone_number: e.target.value }))} />
                                    <Button size="small" variant="outlined" startIcon={<Send />} onClick={() => testNotification('whatsapp')}
                                        sx={{ alignSelf: 'flex-start', borderRadius: 2, textTransform: 'none' }}>Send Test</Button>
                                </>)}
                            </Stack>
                        </SectionCard>
                    </Grid>

                    <Grid size={{ xs: 12, lg: 6 }}>
                        {/* Email */}
                        <SectionCard icon={<Email sx={{ fontSize: 20 }} />} title="Email (SMTP)" subtitle="Send alerts via email"
                            color="#EF5350" badge={<StatusBadge enabled={notif.email_enabled} />}>
                            <Stack spacing={2}>
                                <FormControlLabel
                                    control={<Switch checked={notif.email_enabled} onChange={e => setNotif(n => ({ ...n, email_enabled: e.target.checked }))} />}
                                    label="Enable Email notifications" />
                                {notif.email_enabled && (<>
                                    <Stack direction="row" spacing={2}>
                                        <TextField fullWidth size="small" label="SMTP Host" value={notif.email_smtp_host}
                                            onChange={e => setNotif(n => ({ ...n, email_smtp_host: e.target.value }))} />
                                        <TextField size="small" label="Port" type="number" value={notif.email_smtp_port} sx={{ minWidth: 100 }}
                                            onChange={e => setNotif(n => ({ ...n, email_smtp_port: Number(e.target.value) }))} />
                                    </Stack>
                                    <TextField fullWidth size="small" label="SMTP Username" value={notif.email_smtp_user}
                                        onChange={e => setNotif(n => ({ ...n, email_smtp_user: e.target.value }))} />
                                    <PasswordField label="SMTP Password" value={notif.email_smtp_password} fieldKey="email_pass"
                                        onChange={v => setNotif(n => ({ ...n, email_smtp_password: v }))} />
                                    <TextField fullWidth size="small" label="From Address" value={notif.email_from_address}
                                        onChange={e => setNotif(n => ({ ...n, email_from_address: e.target.value }))} />
                                    <TextField fullWidth size="small" label="To Addresses (comma-separated)"
                                        value={(notif.email_to_addresses || []).join(', ')}
                                        onChange={e => setNotif(n => ({ ...n, email_to_addresses: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} />
                                    <Button size="small" variant="outlined" startIcon={<Send />} onClick={() => testNotification('email')}
                                        sx={{ alignSelf: 'flex-start', borderRadius: 2, textTransform: 'none' }}>Send Test</Button>
                                </>)}
                            </Stack>
                        </SectionCard>
                    </Grid>
                </Grid>
                <Box sx={{ mt: 1 }}>
                    <SaveButton onClick={saveNotifications} label="Save Notification Settings" />
                </Box>
            </TabPanel>

            {/* ── LLM Tab ──────────────────────────────── */}
            <TabPanel value={tab} index={2}>
                <Card sx={{ mb: 3, border: '1px solid rgba(79,142,247,0.15)', background: 'rgba(79,142,247,0.03)' }}>
                    <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                        <Stack direction="row" alignItems="center" spacing={2}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>Active Provider:</Typography>
                            <FormControl size="small" sx={{ minWidth: 200 }}>
                                <Select value={llm.active_provider || ''} displayEmpty
                                    onChange={e => setLlm(l => ({ ...l, active_provider: e.target.value }))}>
                                    <MenuItem value="">None</MenuItem>
                                    <MenuItem value="ollama">🦙 Ollama (Local)</MenuItem>
                                    <MenuItem value="openai">🤖 OpenAI</MenuItem>
                                    <MenuItem value="gemini">💎 Google Gemini</MenuItem>
                                    <MenuItem value="openrouter">🌐 OpenRouter</MenuItem>
                                </Select>
                            </FormControl>
                        </Stack>
                    </CardContent>
                </Card>

                <Grid container spacing={3}>
                    <Grid size={{ xs: 12, lg: 6 }}>
                        {/* Ollama */}
                        <SectionCard icon={<OllamaIcon />} title="Ollama" subtitle="Local AI inference"
                            color="#FF9800"
                            badge={llm.active_provider === 'ollama' ? <Chip label="Active" size="small" sx={{ height: 22, fontSize: 10, fontWeight: 600, background: 'rgba(0,230,118,0.12)', color: '#00E676' }} /> : undefined}>
                            <Stack spacing={2}>
                                <FormControlLabel
                                    control={<Switch checked={llm.ollama_enabled} onChange={e => setLlm(l => ({ ...l, ollama_enabled: e.target.checked }))} />}
                                    label="Enable Ollama" />
                                {llm.ollama_enabled && (<>
                                    <TextField fullWidth size="small" label="Base URL" value={llm.ollama_base_url}
                                        onChange={e => setLlm(l => ({ ...l, ollama_base_url: e.target.value }))} />
                                    <ModelSelector provider="ollama" value={llm.ollama_default_model}
                                        onChange={v => setLlm(l => ({ ...l, ollama_default_model: v }))} label="Chat Model (Assistant)" />
                                    <ModelSelector provider="ollama" value={llm.ollama_vision_model}
                                        onChange={v => setLlm(l => ({ ...l, ollama_vision_model: v }))} label="Vision Model (Summaries)" />
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
                                        Select a vision-capable model (e.g. llava, moondream, qwen3-vl) for AI event summaries with scene analysis
                                    </Typography>
                                </>)}
                            </Stack>
                        </SectionCard>

                        {/* OpenAI */}
                        <SectionCard icon={<OpenAIIcon />} title="OpenAI" subtitle="GPT models via API"
                            color="#10A37F"
                            badge={llm.active_provider === 'openai' ? <Chip label="Active" size="small" sx={{ height: 22, fontSize: 10, fontWeight: 600, background: 'rgba(0,230,118,0.12)', color: '#00E676' }} /> : undefined}>
                            <Stack spacing={2}>
                                <FormControlLabel
                                    control={<Switch checked={llm.openai_enabled} onChange={e => setLlm(l => ({ ...l, openai_enabled: e.target.checked }))} />}
                                    label="Enable OpenAI" />
                                {llm.openai_enabled && (<>
                                    <PasswordField label="API Key" value={llm.openai_api_key} fieldKey="oai_key"
                                        onChange={v => setLlm(l => ({ ...l, openai_api_key: v }))} />
                                    <TextField fullWidth size="small" label="Base URL" value={llm.openai_base_url}
                                        onChange={e => setLlm(l => ({ ...l, openai_base_url: e.target.value }))} />
                                    <ModelSelector provider="openai" value={llm.openai_default_model}
                                        onChange={v => setLlm(l => ({ ...l, openai_default_model: v }))} />
                                </>)}
                            </Stack>
                        </SectionCard>
                    </Grid>

                    <Grid size={{ xs: 12, lg: 6 }}>
                        {/* Gemini */}
                        <SectionCard icon={<GeminiIcon />} title="Google Gemini" subtitle="Gemini models via API"
                            color="#4285F4"
                            badge={llm.active_provider === 'gemini' ? <Chip label="Active" size="small" sx={{ height: 22, fontSize: 10, fontWeight: 600, background: 'rgba(0,230,118,0.12)', color: '#00E676' }} /> : undefined}>
                            <Stack spacing={2}>
                                <FormControlLabel
                                    control={<Switch checked={llm.gemini_enabled} onChange={e => setLlm(l => ({ ...l, gemini_enabled: e.target.checked }))} />}
                                    label="Enable Gemini" />
                                {llm.gemini_enabled && (<>
                                    <PasswordField label="API Key" value={llm.gemini_api_key} fieldKey="gem_key"
                                        onChange={v => setLlm(l => ({ ...l, gemini_api_key: v }))} />
                                    <ModelSelector provider="gemini" value={llm.gemini_default_model}
                                        onChange={v => setLlm(l => ({ ...l, gemini_default_model: v }))} />
                                </>)}
                            </Stack>
                        </SectionCard>

                        {/* OpenRouter */}
                        <SectionCard icon={<OpenRouterIcon />} title="OpenRouter" subtitle="Access 100+ models"
                            color="#7C4DFF"
                            badge={llm.active_provider === 'openrouter' ? <Chip label="Active" size="small" sx={{ height: 22, fontSize: 10, fontWeight: 600, background: 'rgba(0,230,118,0.12)', color: '#00E676' }} /> : undefined}>
                            <Stack spacing={2}>
                                <FormControlLabel
                                    control={<Switch checked={llm.openrouter_enabled} onChange={e => setLlm(l => ({ ...l, openrouter_enabled: e.target.checked }))} />}
                                    label="Enable OpenRouter" />
                                {llm.openrouter_enabled && (<>
                                    <PasswordField label="API Key" value={llm.openrouter_api_key} fieldKey="or_key"
                                        onChange={v => setLlm(l => ({ ...l, openrouter_api_key: v }))} />
                                    <ModelSelector provider="openrouter" value={llm.openrouter_default_model}
                                        onChange={v => setLlm(l => ({ ...l, openrouter_default_model: v }))} />
                                </>)}
                            </Stack>
                        </SectionCard>
                    </Grid>
                </Grid>
                <Box sx={{ mt: 1 }}>
                    <SaveButton onClick={saveLLM} label="Save LLM Settings" />
                </Box>
            </TabPanel>

            <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
                <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))} variant="filled" sx={{ borderRadius: 2 }}>
                    {snack.message}
                </Alert>
            </Snackbar>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </Box>
    );
};
export default Settings;
