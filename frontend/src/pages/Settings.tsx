import React, { useEffect, useState, useCallback } from 'react';
import {
    Box, Typography, Card, CardContent, TextField, Button, Switch,
    FormControlLabel, Select, MenuItem, FormControl, InputLabel,
    Tabs, Tab, Stack, Alert, Snackbar, CircularProgress, Chip, Divider,
    IconButton, InputAdornment, Autocomplete,
} from '@mui/material';
import {
    Storage, Notifications, SmartToy, Save, Send, Refresh,
    Telegram, Email, WhatsApp, Visibility, VisibilityOff,
} from '@mui/icons-material';
import { settingsApi } from '../services/api';

/* ── Tab panel helper ──────────────────────────────────────────── */

const TabPanel: React.FC<{ value: number; index: number; children: React.ReactNode }> = ({ value, index, children }) => (
    <Box role="tabpanel" hidden={value !== index} sx={{ pt: 3 }}>
        {value === index && children}
    </Box>
);

/* ── component ───────────────────────────────────────────────────── */

const Settings: React.FC = () => {
    const [tab, setTab] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'info' });
    const showSnack = (message: string, severity: 'success' | 'error' | 'info' = 'success') => setSnack({ open: true, message, severity });

    // Password visibility
    const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
    const togglePassword = (key: string) => setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));

    // Model lists per provider
    const [providerModels, setProviderModels] = useState<Record<string, string[]>>({
        ollama: [], openai: [], gemini: [], openrouter: [],
    });
    const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});

    // ── Storage state ──
    const [storage, setStorage] = useState({ recording_path: './recordings', retention_days: 30, auto_delete: true });

    // ── Notification state (flat) ──
    const [notif, setNotif] = useState({
        telegram_enabled: false, telegram_bot_token: '', telegram_chat_id: '',
        whatsapp_enabled: false, whatsapp_api_url: '', whatsapp_api_key: '', whatsapp_phone_number: '',
        email_enabled: false, email_smtp_host: '', email_smtp_port: 587, email_smtp_user: '',
        email_smtp_password: '', email_from_address: '', email_to_addresses: [] as string[],
    });

    // ── LLM state (flat) ──
    const [llm, setLlm] = useState({
        active_provider: '' as string,
        ollama_enabled: false, ollama_base_url: 'http://localhost:11434', ollama_default_model: '',
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

    /* ── Auto-fetch models when provider is enabled ── */
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

    // Auto-fetch on enable
    useEffect(() => {
        if (llm.ollama_enabled && providerModels.ollama.length === 0) fetchModels('ollama');
    }, [llm.ollama_enabled]); // eslint-disable-line
    useEffect(() => {
        if (llm.openai_enabled && llm.openai_api_key && providerModels.openai.length === 0) fetchModels('openai');
    }, [llm.openai_enabled, llm.openai_api_key]); // eslint-disable-line
    useEffect(() => {
        if (llm.gemini_enabled && llm.gemini_api_key && providerModels.gemini.length === 0) fetchModels('gemini');
    }, [llm.gemini_enabled, llm.gemini_api_key]); // eslint-disable-line
    useEffect(() => {
        if (llm.openrouter_enabled && providerModels.openrouter.length === 0) fetchModels('openrouter');
    }, [llm.openrouter_enabled]); // eslint-disable-line

    const saveStorage = async () => {
        setSaving(true);
        try { await settingsApi.updateStorage(storage); showSnack('Storage settings saved'); }
        catch { showSnack('Failed to save', 'error'); }
        setSaving(false);
    };

    const saveNotifications = async () => {
        setSaving(true);
        try {
            const body = {
                telegram: { enabled: notif.telegram_enabled, bot_token: notif.telegram_bot_token, chat_id: notif.telegram_chat_id },
                whatsapp: { enabled: notif.whatsapp_enabled, api_url: notif.whatsapp_api_url, api_key: notif.whatsapp_api_key, phone_number: notif.whatsapp_phone_number },
                email: {
                    enabled: notif.email_enabled, smtp_host: notif.email_smtp_host, smtp_port: notif.email_smtp_port,
                    smtp_user: notif.email_smtp_user, smtp_password: notif.email_smtp_password,
                    from_address: notif.email_from_address, to_addresses: notif.email_to_addresses,
                },
            };
            await settingsApi.updateNotifications(body);
            showSnack('Notification settings saved');
        } catch { showSnack('Failed to save', 'error'); }
        setSaving(false);
    };

    const saveLLM = async () => {
        setSaving(true);
        try {
            const body = {
                active_provider: llm.active_provider || null,
                ollama: { enabled: llm.ollama_enabled, base_url: llm.ollama_base_url, default_model: llm.ollama_default_model },
                openai: { enabled: llm.openai_enabled, api_key: llm.openai_api_key, base_url: llm.openai_base_url, default_model: llm.openai_default_model },
                gemini: { enabled: llm.gemini_enabled, api_key: llm.gemini_api_key, default_model: llm.gemini_default_model },
                openrouter: { enabled: llm.openrouter_enabled, api_key: llm.openrouter_api_key, default_model: llm.openrouter_default_model },
            };
            await settingsApi.updateLLM(body);
            showSnack('LLM settings saved');
        } catch { showSnack('Failed to save', 'error'); }
        setSaving(false);
    };

    const testNotification = async (provider: string) => {
        try {
            const res = await settingsApi.testNotification(provider);
            showSnack(res.data.message, 'info');
        } catch { showSnack('Test failed', 'error'); }
    };

    /* Password field helper */
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
                    ),
                },
            }}
        />
    );

    /* Model selector with auto-fetch */
    const ModelSelector: React.FC<{
        provider: string; value: string; onChange: (v: string) => void; label?: string;
    }> = ({ provider, value, onChange, label = 'Default Model' }) => {
        const models = providerModels[provider] || [];
        const isFetching = fetchingModels[provider] || false;

        return (
            <Stack direction="row" spacing={1} alignItems="flex-start">
                <Autocomplete
                    fullWidth
                    size="small"
                    freeSolo
                    options={models}
                    value={value}
                    onInputChange={(_, v) => onChange(v)}
                    loading={isFetching}
                    renderInput={(params) => (
                        <TextField {...params} label={label}
                            placeholder={isFetching ? 'Fetching models...' : models.length > 0 ? `${models.length} models available` : 'Type model name'}
                            slotProps={{
                                input: {
                                    ...params.InputProps,
                                    endAdornment: (
                                        <>
                                            {isFetching && <CircularProgress size={16} />}
                                            {params.InputProps.endAdornment}
                                        </>
                                    ),
                                },
                            }}
                        />
                    )}
                />
                <IconButton size="small" onClick={() => fetchModels(provider)} disabled={isFetching}
                    sx={{ mt: 0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}>
                    <Refresh sx={{ fontSize: 20, animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
                </IconButton>
            </Stack>
        );
    };

    if (loading) return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress /></Box>
    );

    return (
        <Box>
            <Box sx={{ mb: 3 }}>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>Settings</Typography>
                <Typography variant="body2" color="text.secondary">Configure storage, notifications, and AI providers</Typography>
            </Box>

            <Card>
                <Box sx={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                    <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{
                        px: 2, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 52 },
                    }}>
                        <Tab icon={<Storage sx={{ fontSize: 18 }} />} iconPosition="start" label="Storage" />
                        <Tab icon={<Notifications sx={{ fontSize: 18 }} />} iconPosition="start" label="Notifications" />
                        <Tab icon={<SmartToy sx={{ fontSize: 18 }} />} iconPosition="start" label="LLM Providers" />
                    </Tabs>
                </Box>

                {/* ── Storage Tab ───────────────────────────── */}
                <TabPanel value={tab} index={0}>
                    <CardContent sx={{ maxWidth: 600 }}>
                        <Stack spacing={2.5}>
                            <TextField fullWidth size="small" label="Recording Path" value={storage.recording_path}
                                onChange={e => setStorage(s => ({ ...s, recording_path: e.target.value }))} />
                            <TextField fullWidth size="small" label="Retention (days)" type="number" value={storage.retention_days}
                                onChange={e => setStorage(s => ({ ...s, retention_days: Number(e.target.value) }))}
                                slotProps={{ htmlInput: { min: 1, max: 365 } }} />
                            <FormControlLabel
                                control={<Switch checked={storage.auto_delete} onChange={e => setStorage(s => ({ ...s, auto_delete: e.target.checked }))} />}
                                label="Auto-delete old recordings"
                            />
                            <Button variant="contained" startIcon={saving ? <CircularProgress size={16} /> : <Save />}
                                onClick={saveStorage} disabled={saving} sx={{ alignSelf: 'flex-start', borderRadius: 2, textTransform: 'none' }}>
                                Save Storage Settings
                            </Button>
                        </Stack>
                    </CardContent>
                </TabPanel>

                {/* ── Notifications Tab ─────────────────────── */}
                <TabPanel value={tab} index={1}>
                    <CardContent>
                        <Stack spacing={4}>
                            {/* Telegram */}
                            <Box>
                                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                                    <Telegram sx={{ color: '#29B6F6' }} />
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Telegram</Typography>
                                    <Chip label={notif.telegram_enabled ? 'Enabled' : 'Disabled'} size="small"
                                        sx={{ height: 20, fontSize: 10, fontWeight: 600, background: notif.telegram_enabled ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)', color: notif.telegram_enabled ? '#00E676' : 'text.secondary' }} />
                                </Stack>
                                <Stack spacing={2} sx={{ maxWidth: 500 }}>
                                    <FormControlLabel
                                        control={<Switch checked={notif.telegram_enabled} onChange={e => setNotif(n => ({ ...n, telegram_enabled: e.target.checked }))} />}
                                        label="Enable Telegram notifications"
                                    />
                                    {notif.telegram_enabled && (
                                        <>
                                            <PasswordField label="Bot Token" value={notif.telegram_bot_token} fieldKey="tg_token"
                                                onChange={v => setNotif(n => ({ ...n, telegram_bot_token: v }))} />
                                            <TextField fullWidth size="small" label="Chat ID" value={notif.telegram_chat_id}
                                                onChange={e => setNotif(n => ({ ...n, telegram_chat_id: e.target.value }))} />
                                            <Button size="small" variant="outlined" startIcon={<Send />} onClick={() => testNotification('telegram')}
                                                sx={{ alignSelf: 'flex-start', borderRadius: 2, textTransform: 'none' }}>
                                                Send Test
                                            </Button>
                                        </>
                                    )}
                                </Stack>
                            </Box>

                            <Divider />

                            {/* WhatsApp */}
                            <Box>
                                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                                    <WhatsApp sx={{ color: '#25D366' }} />
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>WhatsApp</Typography>
                                    <Chip label={notif.whatsapp_enabled ? 'Enabled' : 'Disabled'} size="small"
                                        sx={{ height: 20, fontSize: 10, fontWeight: 600, background: notif.whatsapp_enabled ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)', color: notif.whatsapp_enabled ? '#00E676' : 'text.secondary' }} />
                                </Stack>
                                <Stack spacing={2} sx={{ maxWidth: 500 }}>
                                    <FormControlLabel
                                        control={<Switch checked={notif.whatsapp_enabled} onChange={e => setNotif(n => ({ ...n, whatsapp_enabled: e.target.checked }))} />}
                                        label="Enable WhatsApp notifications"
                                    />
                                    {notif.whatsapp_enabled && (
                                        <>
                                            <TextField fullWidth size="small" label="API URL" value={notif.whatsapp_api_url}
                                                onChange={e => setNotif(n => ({ ...n, whatsapp_api_url: e.target.value }))} />
                                            <PasswordField label="API Key" value={notif.whatsapp_api_key} fieldKey="wa_key"
                                                onChange={v => setNotif(n => ({ ...n, whatsapp_api_key: v }))} />
                                            <TextField fullWidth size="small" label="Phone Number" value={notif.whatsapp_phone_number}
                                                onChange={e => setNotif(n => ({ ...n, whatsapp_phone_number: e.target.value }))} />
                                            <Button size="small" variant="outlined" startIcon={<Send />} onClick={() => testNotification('whatsapp')}
                                                sx={{ alignSelf: 'flex-start', borderRadius: 2, textTransform: 'none' }}>
                                                Send Test
                                            </Button>
                                        </>
                                    )}
                                </Stack>
                            </Box>

                            <Divider />

                            {/* Email */}
                            <Box>
                                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                                    <Email sx={{ color: '#EF5350' }} />
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Email (SMTP)</Typography>
                                    <Chip label={notif.email_enabled ? 'Enabled' : 'Disabled'} size="small"
                                        sx={{ height: 20, fontSize: 10, fontWeight: 600, background: notif.email_enabled ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)', color: notif.email_enabled ? '#00E676' : 'text.secondary' }} />
                                </Stack>
                                <Stack spacing={2} sx={{ maxWidth: 500 }}>
                                    <FormControlLabel
                                        control={<Switch checked={notif.email_enabled} onChange={e => setNotif(n => ({ ...n, email_enabled: e.target.checked }))} />}
                                        label="Enable Email notifications"
                                    />
                                    {notif.email_enabled && (
                                        <>
                                            <Stack direction="row" spacing={2}>
                                                <TextField fullWidth size="small" label="SMTP Host" value={notif.email_smtp_host}
                                                    onChange={e => setNotif(n => ({ ...n, email_smtp_host: e.target.value }))} />
                                                <TextField size="small" label="Port" type="number" value={notif.email_smtp_port} sx={{ width: 100 }}
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
                                                sx={{ alignSelf: 'flex-start', borderRadius: 2, textTransform: 'none' }}>
                                                Send Test
                                            </Button>
                                        </>
                                    )}
                                </Stack>
                            </Box>
                        </Stack>

                        <Box sx={{ mt: 4 }}>
                            <Button variant="contained" startIcon={saving ? <CircularProgress size={16} /> : <Save />}
                                onClick={saveNotifications} disabled={saving} sx={{ borderRadius: 2, textTransform: 'none' }}>
                                Save Notification Settings
                            </Button>
                        </Box>
                    </CardContent>
                </TabPanel>

                {/* ── LLM Tab ──────────────────────────────── */}
                <TabPanel value={tab} index={2}>
                    <CardContent>
                        <FormControl size="small" sx={{ minWidth: 240, mb: 3 }}>
                            <InputLabel>Active Provider</InputLabel>
                            <Select value={llm.active_provider || ''} label="Active Provider"
                                onChange={e => setLlm(l => ({ ...l, active_provider: e.target.value }))}>
                                <MenuItem value="">None</MenuItem>
                                <MenuItem value="ollama">Ollama (Local)</MenuItem>
                                <MenuItem value="openai">OpenAI</MenuItem>
                                <MenuItem value="gemini">Google Gemini</MenuItem>
                                <MenuItem value="openrouter">OpenRouter</MenuItem>
                            </Select>
                        </FormControl>

                        <Stack spacing={4}>
                            {/* Ollama */}
                            <Box>
                                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                                    <Typography sx={{ fontSize: '1.2rem' }}>🦙</Typography>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Ollama</Typography>
                                    {llm.active_provider === 'ollama' && (
                                        <Chip label="Active" size="small" sx={{ height: 20, fontSize: 10, fontWeight: 600, background: 'rgba(0,230,118,0.12)', color: '#00E676' }} />
                                    )}
                                </Stack>
                                <Stack spacing={2} sx={{ maxWidth: 500 }}>
                                    <FormControlLabel
                                        control={<Switch checked={llm.ollama_enabled} onChange={e => setLlm(l => ({ ...l, ollama_enabled: e.target.checked }))} />}
                                        label="Enable Ollama"
                                    />
                                    {llm.ollama_enabled && (
                                        <>
                                            <TextField fullWidth size="small" label="Base URL" value={llm.ollama_base_url}
                                                onChange={e => setLlm(l => ({ ...l, ollama_base_url: e.target.value }))} />
                                            <ModelSelector provider="ollama" value={llm.ollama_default_model}
                                                onChange={v => setLlm(l => ({ ...l, ollama_default_model: v }))} />
                                        </>
                                    )}
                                </Stack>
                            </Box>

                            <Divider />

                            {/* OpenAI */}
                            <Box>
                                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                                    <Typography sx={{ fontSize: '1.2rem' }}>🤖</Typography>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>OpenAI</Typography>
                                    {llm.active_provider === 'openai' && (
                                        <Chip label="Active" size="small" sx={{ height: 20, fontSize: 10, fontWeight: 600, background: 'rgba(0,230,118,0.12)', color: '#00E676' }} />
                                    )}
                                </Stack>
                                <Stack spacing={2} sx={{ maxWidth: 500 }}>
                                    <FormControlLabel
                                        control={<Switch checked={llm.openai_enabled} onChange={e => setLlm(l => ({ ...l, openai_enabled: e.target.checked }))} />}
                                        label="Enable OpenAI"
                                    />
                                    {llm.openai_enabled && (
                                        <>
                                            <PasswordField label="API Key" value={llm.openai_api_key} fieldKey="oai_key"
                                                onChange={v => setLlm(l => ({ ...l, openai_api_key: v }))} />
                                            <TextField fullWidth size="small" label="Base URL" value={llm.openai_base_url}
                                                onChange={e => setLlm(l => ({ ...l, openai_base_url: e.target.value }))} />
                                            <ModelSelector provider="openai" value={llm.openai_default_model}
                                                onChange={v => setLlm(l => ({ ...l, openai_default_model: v }))} />
                                        </>
                                    )}
                                </Stack>
                            </Box>

                            <Divider />

                            {/* Gemini */}
                            <Box>
                                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                                    <Typography sx={{ fontSize: '1.2rem' }}>💎</Typography>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Google Gemini</Typography>
                                    {llm.active_provider === 'gemini' && (
                                        <Chip label="Active" size="small" sx={{ height: 20, fontSize: 10, fontWeight: 600, background: 'rgba(0,230,118,0.12)', color: '#00E676' }} />
                                    )}
                                </Stack>
                                <Stack spacing={2} sx={{ maxWidth: 500 }}>
                                    <FormControlLabel
                                        control={<Switch checked={llm.gemini_enabled} onChange={e => setLlm(l => ({ ...l, gemini_enabled: e.target.checked }))} />}
                                        label="Enable Gemini"
                                    />
                                    {llm.gemini_enabled && (
                                        <>
                                            <PasswordField label="API Key" value={llm.gemini_api_key} fieldKey="gem_key"
                                                onChange={v => setLlm(l => ({ ...l, gemini_api_key: v }))} />
                                            <ModelSelector provider="gemini" value={llm.gemini_default_model}
                                                onChange={v => setLlm(l => ({ ...l, gemini_default_model: v }))} />
                                        </>
                                    )}
                                </Stack>
                            </Box>

                            <Divider />

                            {/* OpenRouter */}
                            <Box>
                                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                                    <Typography sx={{ fontSize: '1.2rem' }}>🌐</Typography>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>OpenRouter</Typography>
                                    {llm.active_provider === 'openrouter' && (
                                        <Chip label="Active" size="small" sx={{ height: 20, fontSize: 10, fontWeight: 600, background: 'rgba(0,230,118,0.12)', color: '#00E676' }} />
                                    )}
                                </Stack>
                                <Stack spacing={2} sx={{ maxWidth: 500 }}>
                                    <FormControlLabel
                                        control={<Switch checked={llm.openrouter_enabled} onChange={e => setLlm(l => ({ ...l, openrouter_enabled: e.target.checked }))} />}
                                        label="Enable OpenRouter"
                                    />
                                    {llm.openrouter_enabled && (
                                        <>
                                            <PasswordField label="API Key" value={llm.openrouter_api_key} fieldKey="or_key"
                                                onChange={v => setLlm(l => ({ ...l, openrouter_api_key: v }))} />
                                            <ModelSelector provider="openrouter" value={llm.openrouter_default_model}
                                                onChange={v => setLlm(l => ({ ...l, openrouter_default_model: v }))} />
                                        </>
                                    )}
                                </Stack>
                            </Box>
                        </Stack>

                        <Box sx={{ mt: 4 }}>
                            <Button variant="contained" startIcon={saving ? <CircularProgress size={16} /> : <Save />}
                                onClick={saveLLM} disabled={saving} sx={{ borderRadius: 2, textTransform: 'none' }}>
                                Save LLM Settings
                            </Button>
                        </Box>
                    </CardContent>
                </TabPanel>
            </Card>

            {/* Snackbar */}
            <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
                <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))} variant="filled" sx={{ borderRadius: 2 }}>
                    {snack.message}
                </Alert>
            </Snackbar>

            {/* Spin animation for refresh button */}
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </Box>
    );
};
export default Settings;
