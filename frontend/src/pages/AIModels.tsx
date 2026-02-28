import React, { useEffect, useState, useCallback } from 'react';
import {
    Box, Typography, Grid, Card, CardContent, Button, Chip, IconButton,
    CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, LinearProgress, Tooltip, Stack, Alert, Snackbar,
} from '@mui/material';
import {
    SmartToy, Delete, Upload, Refresh,
    CheckCircle, CloudDownload, Memory, Speed, Star,
} from '@mui/icons-material';
import { modelsApi } from '../services/api';

/* ── helpers ─────────────────────────────────────────────────────── */

const formatSize = (bytes: number) => {
    if (!bytes) return '—';
    if (bytes < 1e6) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e9).toFixed(2)} GB`;
};

/* ── component ───────────────────────────────────────────────────── */

const AIModels: React.FC = () => {
    const [models, setModels] = useState<any[]>([]);
    const [available, setAvailable] = useState<Record<string, string[]>>({});
    const [activeModel, setActiveModel] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());

    // Dialogs
    const [uploadOpen, setUploadOpen] = useState(false);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadName, setUploadName] = useState('');

    // Snackbar
    const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'info' });
    const showSnack = (message: string, severity: 'success' | 'error' | 'info' = 'success') => setSnack({ open: true, message, severity });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [m, a, act] = await Promise.all([modelsApi.list(), modelsApi.available(), modelsApi.getActive()]);
            setModels(m.data);
            setAvailable(a.data);
            setActiveModel(act.data);
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSetDefault = async (id: string) => {
        try {
            const res = await modelsApi.setDefault(id);
            showSnack(res.data.message);
            fetchData();
        } catch { showSnack('Failed to set default', 'error'); }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Delete model "${name}"?`)) return;
        try {
            await modelsApi.delete(id);
            showSnack(`${name} deleted`);
            fetchData();
        } catch { showSnack('Failed to delete', 'error'); }
    };

    const handleDownload = async (modelName: string) => {
        setDownloadingModels(prev => new Set(prev).add(modelName));
        try {
            const res = await modelsApi.download(modelName);
            showSnack(res.data.message);
            fetchData();
        } catch (e: any) {
            const msg = e.response?.data?.detail || 'Download failed';
            showSnack(msg, msg.includes('already') ? 'info' : 'error');
        }
        setDownloadingModels(prev => { const s = new Set(prev); s.delete(modelName); return s; });
    };

    const handleUpload = async () => {
        if (!uploadFile) return;
        setUploading(true);
        try {
            const name = uploadName.trim() || uploadFile.name.replace('.pt', '');
            await modelsApi.upload(uploadFile, name);
            showSnack(`${name} uploaded successfully`);
            setUploadOpen(false);
            setUploadFile(null);
            setUploadName('');
            fetchData();
        } catch { showSnack('Upload failed', 'error'); }
        setUploading(false);
    };

    const handleReloadDeepstream = async () => {
        try {
            const res = await modelsApi.reloadDeepstream();
            showSnack(res.data.message);
        } catch (e: any) {
            showSnack(e.response?.data?.detail || 'DeepStream reload failed', 'error');
        }
    };

    // Flatten all available model names for the grid
    const allAvailable = Object.entries(available).flatMap(([family, variants]) =>
        (variants as string[]).map(v => ({ family, name: v }))
    );

    return (
        <Box>
            {/* ── Header ────────────────────────────────────── */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h4" sx={{ mb: 0.5, fontWeight: 700 }}>AI Models</Typography>
                    <Typography variant="body2" color="text.secondary">Manage YOLO detection models</Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                    <Button startIcon={<Refresh />} variant="outlined" size="small" onClick={handleReloadDeepstream}
                        sx={{ borderRadius: 2, textTransform: 'none' }}>
                        Reload DeepStream
                    </Button>
                    <Button startIcon={<Upload />} variant="contained" size="small" onClick={() => setUploadOpen(true)}
                        sx={{ borderRadius: 2, textTransform: 'none' }}>
                        Upload Model
                    </Button>
                </Stack>
            </Box>

            {/* ── Active Model Banner ───────────────────────── */}
            {activeModel && (
                <Card sx={{
                    mb: 3,
                    background: 'linear-gradient(135deg, rgba(79,142,247,0.1) 0%, rgba(124,77,255,0.06) 100%)',
                    border: '1px solid rgba(79,142,247,0.25)',
                }}>
                    <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                            <Stack direction="row" alignItems="center" spacing={2}>
                                <Box sx={{
                                    width: 48, height: 48, borderRadius: 2,
                                    background: 'rgba(79,142,247,0.18)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Memory sx={{ color: '#4F8EF7', fontSize: 28 }} />
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.5, textTransform: 'uppercase', fontSize: '0.65rem' }}>
                                        Active Detection Model
                                    </Typography>
                                    <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                                        {activeModel.model_name || 'yolov8n'}
                                    </Typography>
                                </Box>
                            </Stack>
                            <Stack alignItems="flex-end" spacing={0.5}>
                                <Chip icon={<CheckCircle sx={{ fontSize: 14 }} />} label="Running"
                                    size="small" sx={{ background: 'rgba(0,230,118,0.12)', color: '#00E676', fontWeight: 700 }} />
                                {activeModel.updated_at && (
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                        Set {new Date(activeModel.updated_at).toLocaleDateString()}
                                    </Typography>
                                )}
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>
            )}

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
            ) : (
                <>
                    {/* ── Downloaded Models ─────────────────────── */}
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
                        Downloaded Models
                        <Chip label={models.length} size="small" sx={{ ml: 1, height: 22, fontSize: 11, background: 'rgba(79,142,247,0.12)', color: '#4F8EF7' }} />
                    </Typography>

                    {models.length === 0 ? (
                        <Card sx={{ mb: 4 }}>
                            <CardContent sx={{ p: 5, textAlign: 'center' }}>
                                <SmartToy sx={{ fontSize: 56, color: 'text.secondary', mb: 1, opacity: 0.4 }} />
                                <Typography variant="h6" color="text.secondary">No models downloaded</Typography>
                                <Typography variant="body2" color="text.secondary">Download one below or upload your own</Typography>
                            </CardContent>
                        </Card>
                    ) : (
                        <Grid container spacing={2} sx={{ mb: 4 }}>
                            {models.map(m => {
                                const isActive = activeModel?.model_name === m.name;
                                return (
                                    <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={m.id}>
                                        <Card sx={{
                                            height: '100%',
                                            transition: 'all 0.2s',
                                            border: isActive ? '1px solid rgba(79,142,247,0.4)' : '1px solid rgba(148,163,184,0.08)',
                                            '&:hover': { borderColor: 'primary.main', transform: 'translateY(-2px)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' },
                                        }}>
                                            <CardContent sx={{ p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
                                                {/* Model name + chips */}
                                                <Box sx={{ mb: 1.5 }}>
                                                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>{m.name}</Typography>
                                                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                                                        <Chip label={`v${m.version}`} size="small"
                                                            sx={{ height: 20, fontSize: 10, background: 'rgba(255,255,255,0.06)' }} />
                                                        <Chip label={formatSize(m.file_size_bytes)} size="small"
                                                            sx={{ height: 20, fontSize: 10, background: 'rgba(255,255,255,0.06)' }} />
                                                        {m.is_custom && (
                                                            <Chip label="Custom" size="small"
                                                                sx={{ height: 20, fontSize: 10, fontWeight: 600, background: 'rgba(124,77,255,0.15)', color: '#7C4DFF' }} />
                                                        )}
                                                    </Stack>
                                                </Box>

                                                {/* Active/Default indicators */}
                                                {isActive && (
                                                    <Chip icon={<Speed sx={{ fontSize: 14 }} />} label="Currently Active"
                                                        size="small" sx={{
                                                            mb: 1.5, alignSelf: 'flex-start', height: 24, fontWeight: 600,
                                                            background: 'rgba(0,230,118,0.12)', color: '#00E676',
                                                            '& .MuiChip-icon': { color: 'inherit' },
                                                        }} />
                                                )}
                                                {m.is_default && !isActive && (
                                                    <Chip icon={<Star sx={{ fontSize: 14 }} />} label="Default"
                                                        size="small" sx={{
                                                            mb: 1.5, alignSelf: 'flex-start', height: 24, fontWeight: 600,
                                                            background: 'rgba(255,183,77,0.15)', color: '#FFB74D',
                                                            '& .MuiChip-icon': { color: 'inherit' },
                                                        }} />
                                                )}

                                                {/* Buttons — pushed to bottom */}
                                                <Box sx={{ mt: 'auto', pt: 1, display: 'flex', gap: 1 }}>
                                                    {!m.is_default ? (
                                                        <Button size="small" variant="outlined" fullWidth
                                                            startIcon={<Star sx={{ fontSize: 16 }} />}
                                                            onClick={() => handleSetDefault(m.id)}
                                                            sx={{ borderRadius: 2, textTransform: 'none', fontSize: '0.75rem' }}>
                                                            Set Default
                                                        </Button>
                                                    ) : (
                                                        <Button size="small" variant="outlined" fullWidth disabled
                                                            startIcon={<CheckCircle sx={{ fontSize: 16 }} />}
                                                            sx={{ borderRadius: 2, textTransform: 'none', fontSize: '0.75rem' }}>
                                                            Default Model
                                                        </Button>
                                                    )}
                                                    <Tooltip title="Delete model">
                                                        <IconButton size="small" color="error" onClick={() => handleDelete(m.id, m.name)}
                                                            sx={{ border: '1px solid rgba(255,82,82,0.2)', borderRadius: 2, '&:hover': { background: 'rgba(255,82,82,0.1)' } }}>
                                                            <Delete sx={{ fontSize: 18 }} />
                                                        </IconButton>
                                                    </Tooltip>
                                                </Box>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                );
                            })}
                        </Grid>
                    )}

                    {/* ── Available for Download ────────────────── */}
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
                        Available for Download
                    </Typography>

                    <Grid container spacing={2}>
                        {allAvailable.map(({ family, name }) => {
                            const downloaded = models.some(m => m.name === name);
                            const isDownloading = downloadingModels.has(name);
                            return (
                                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={name}>
                                    <Card sx={{
                                        transition: 'all 0.2s',
                                        opacity: downloaded ? 0.7 : 1,
                                        border: downloaded ? '1px solid rgba(0,230,118,0.2)' : '1px solid rgba(148,163,184,0.08)',
                                        '&:hover': !downloaded ? { borderColor: 'primary.main', transform: 'translateY(-1px)' } : {},
                                    }}>
                                        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                                            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: isDownloading ? 1 : 0 }}>
                                                <Box>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{name}</Typography>
                                                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.6rem' }}>
                                                        {family}
                                                    </Typography>
                                                </Box>
                                                {downloaded ? (
                                                    <Chip icon={<CheckCircle sx={{ fontSize: 14 }} />} label="Downloaded" size="small"
                                                        sx={{ height: 24, fontSize: 10, fontWeight: 600, background: 'rgba(0,230,118,0.12)', color: '#00E676' }} />
                                                ) : isDownloading ? (
                                                    <Chip icon={<CircularProgress size={12} sx={{ color: '#4F8EF7' }} />} label="Downloading..."
                                                        size="small" sx={{ height: 24, fontSize: 10, fontWeight: 600, background: 'rgba(79,142,247,0.12)', color: '#4F8EF7' }} />
                                                ) : (
                                                    <Button size="small" variant="outlined" startIcon={<CloudDownload sx={{ fontSize: 16 }} />}
                                                        onClick={() => handleDownload(name)}
                                                        sx={{ borderRadius: 2, textTransform: 'none', fontSize: '0.7rem', minWidth: 100 }}>
                                                        Download
                                                    </Button>
                                                )}
                                            </Stack>

                                            {/* Download progress bar */}
                                            {isDownloading && (
                                                <LinearProgress
                                                    sx={{
                                                        borderRadius: 4, height: 4,
                                                        background: 'rgba(79,142,247,0.1)',
                                                        '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg, #4F8EF7, #7C4DFF)' },
                                                    }}
                                                />
                                            )}
                                        </CardContent>
                                    </Card>
                                </Grid>
                            );
                        })}
                    </Grid>
                </>
            )}

            {/* ── Upload Dialog ─────────────────────────────── */}
            <Dialog open={uploadOpen} onClose={() => !uploading && setUploadOpen(false)} maxWidth="sm" fullWidth
                PaperProps={{ sx: { background: '#0f1419', borderRadius: 3, border: '1px solid rgba(148,163,184,0.08)' } }}>
                <DialogTitle sx={{ fontWeight: 700 }}>Upload Custom Model</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Upload a YOLO .pt model file. It will be available for detection immediately.
                    </Typography>
                    <TextField fullWidth label="Model Name" value={uploadName}
                        onChange={e => setUploadName(e.target.value)}
                        placeholder="e.g. my_custom_yolov8"
                        size="small" sx={{ mb: 2 }} />

                    <Box sx={{
                        border: '2px dashed rgba(148,163,184,0.2)',
                        borderRadius: 2, p: 4, textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        '&:hover': { borderColor: 'primary.main', background: 'rgba(79,142,247,0.05)' },
                    }}
                        onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = '.pt,.pth,.onnx,.engine';
                            input.onchange = (e: any) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    setUploadFile(file);
                                    if (!uploadName) setUploadName(file.name.replace(/\.(pt|pth|onnx|engine)$/, ''));
                                }
                            };
                            input.click();
                        }}>
                        {uploadFile ? (
                            <>
                                <CheckCircle sx={{ fontSize: 36, color: '#00E676', mb: 1 }} />
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>{uploadFile.name}</Typography>
                                <Typography variant="body2" color="text.secondary">{formatSize(uploadFile.size)}</Typography>
                            </>
                        ) : (
                            <>
                                <Upload sx={{ fontSize: 36, color: 'text.secondary', mb: 1 }} />
                                <Typography variant="body2" color="text.secondary">Click to select a .pt model file</Typography>
                            </>
                        )}
                    </Box>

                    {uploading && <LinearProgress sx={{ mt: 2, borderRadius: 4, height: 4 }} />}
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5 }}>
                    <Button onClick={() => setUploadOpen(false)} disabled={uploading} variant="outlined" size="small"
                        sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
                    <Button onClick={handleUpload} disabled={!uploadFile || uploading} variant="contained" size="small"
                        startIcon={uploading ? <CircularProgress size={14} /> : <Upload />}
                        sx={{ borderRadius: 2, textTransform: 'none' }}>
                        {uploading ? 'Uploading...' : 'Upload'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar */}
            <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
                <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))} variant="filled"
                    sx={{ borderRadius: 2 }}>
                    {snack.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};
export default AIModels;
