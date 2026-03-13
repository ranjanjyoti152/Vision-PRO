import React, { useEffect, useState, useCallback } from 'react';
import {
    Box, Typography, Grid, Card, CardContent, Avatar, Chip, Button,
    Skeleton, IconButton, Tooltip, Dialog, DialogTitle, DialogContent,
    DialogActions, TextField, Stack,
} from '@mui/material';
import {
    Face, PersonAdd, PersonOff, Delete, Edit, Save,
} from '@mui/icons-material';
import { facesApi } from '../services/api';

/* ── helpers ─────────────────────────────────────────────────────── */

const formatDate = (ts: string) => {
    if (!ts) return 'N/A';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatRelative = (ts: string) => {
    if (!ts) return '';
    const utcTs = ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z';
    const diffMs = Date.now() - new Date(utcTs).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
};

const COLORS = ['#4F8EF7', '#7C4DFF', '#FF5252', '#FF9800', '#00BCD4', '#66BB6A', '#AB47BC', '#FF7043'];
const avatarColor = (id: string) => COLORS[parseInt(id?.slice(-2) || '0', 16) % COLORS.length];

/* ── component ───────────────────────────────────────────────────── */

const Faces: React.FC = () => {
    const [knownFaces, setKnownFaces] = useState<any[]>([]);
    const [unknownFaces, setUnknownFaces] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'known' | 'unknown'>('unknown');

    // Dialogs
    const [editingFace, setEditingFace] = useState<any>(null);
    const [editName, setEditName] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [createName, setCreateName] = useState('');
    const [detailFace, setDetailFace] = useState<any>(null);

    const fetchFaces = useCallback(async () => {
        setLoading(true);
        try {
            const [known, unknown] = await Promise.all([facesApi.list(), facesApi.listUnknown()]);
            setKnownFaces(known.data);
            setUnknownFaces(unknown.data);
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => { fetchFaces(); }, [fetchFaces]);

    const handleDelete = async (id: string) => {
        try {
            await facesApi.delete(id);
            setKnownFaces(prev => prev.filter(f => f.id !== id));
            setUnknownFaces(prev => prev.filter(f => f.id !== id));
            setDetailFace(null);
        } catch { /* ignore */ }
    };

    const handleUpdate = async () => {
        if (!editingFace || !editName.trim()) return;
        try {
            await facesApi.update(editingFace.id, { name: editName.trim() });
            setEditingFace(null);
            setEditName('');
            fetchFaces(); // Refresh — face moves from unknown to known
        } catch { /* ignore */ }
    };

    const handleCreate = async () => {
        if (!createName.trim()) return;
        try {
            await facesApi.create({ name: createName.trim() });
            setCreateOpen(false);
            setCreateName('');
            fetchFaces();
        } catch { /* ignore */ }
    };

    const handleUploadReference = async (faceId: string) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e: any) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                await facesApi.uploadReference(faceId, file);
                fetchFaces();
            } catch { /* ignore */ }
        };
        input.click();
    };

    const faces = tab === 'known' ? knownFaces : unknownFaces;

    return (
        <Box>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h4" sx={{ mb: 0.5, fontWeight: 700 }}>Face Recognition</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Manage known faces and identify unknowns
                    </Typography>
                </Box>
                <Button startIcon={<PersonAdd />} variant="contained" size="small"
                    onClick={() => setCreateOpen(true)}
                    sx={{ borderRadius: 2, textTransform: 'none' }}>
                    Add Face
                </Button>
            </Box>

            {/* Tabs */}
            <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
                <Chip
                    label={`Known (${knownFaces.length})`}
                    onClick={() => setTab('known')}
                    color={tab === 'known' ? 'primary' : 'default'}
                    variant={tab === 'known' ? 'filled' : 'outlined'}
                    sx={{ fontWeight: 600 }}
                />
                <Chip
                    label={`Unknown (${unknownFaces.length})`}
                    onClick={() => setTab('unknown')}
                    color={tab === 'unknown' ? 'primary' : 'default'}
                    variant={tab === 'unknown' ? 'filled' : 'outlined'}
                    sx={{ fontWeight: 600 }}
                />
            </Box>

            {/* Grid */}
            {faces.length === 0 && !loading ? (
                <Card>
                    <CardContent sx={{ p: 5, textAlign: 'center' }}>
                        {tab === 'known'
                            ? <Face sx={{ fontSize: 56, color: 'text.secondary', mb: 2, opacity: 0.4 }} />
                            : <PersonOff sx={{ fontSize: 56, color: 'text.secondary', mb: 2, opacity: 0.4 }} />
                        }
                        <Typography variant="h6" color="text.secondary">
                            {tab === 'known' ? 'No known faces registered' : 'No unknown faces detected'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {tab === 'known'
                                ? 'Click "Add Face" to create a face profile with reference images'
                                : 'Unknown faces will appear here when detected by the system'}
                        </Typography>
                    </CardContent>
                </Card>
            ) : (
                <Grid container spacing={2}>
                    {(loading ? Array(8).fill(null) : faces).map((face, i) => {
                        const color = avatarColor(face?.id || String(i));
                        const faceImg = face?.thumbnail || face?.reference_images?.[0];

                        return (
                            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={face?.id || i}>
                                <Card sx={{
                                    textAlign: 'center',
                                    transition: 'all 0.2s ease',
                                    cursor: 'pointer',
                                    '&:hover': {
                                        borderColor: 'primary.main',
                                        transform: 'translateY(-2px)',
                                        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                                    },
                                }}
                                    onClick={() => !loading && setDetailFace(face)}
                                >
                                    <CardContent sx={{ p: 2.5 }}>
                                        {loading ? (
                                            <Skeleton variant="circular" width={72} height={72} sx={{ mx: 'auto', mb: 1.5 }} />
                                        ) : faceImg ? (
                                            <Avatar
                                                src={faceImg}
                                                sx={{ width: 72, height: 72, mx: 'auto', mb: 1.5, border: `2px solid ${color}` }}
                                            />
                                        ) : (
                                            <Avatar sx={{
                                                width: 72, height: 72, mx: 'auto', mb: 1.5,
                                                background: `linear-gradient(135deg, ${color}40, ${color}20)`,
                                                border: `2px solid ${color}50`,
                                                color: color,
                                                fontSize: '1.5rem', fontWeight: 700,
                                            }}>
                                                {face?.is_known ? (face?.name || '?')[0].toUpperCase() : '?'}
                                            </Avatar>
                                        )}

                                        <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
                                            {loading ? <Skeleton width={60} sx={{ mx: 'auto' }} /> : (face?.name || 'Unknown')}
                                        </Typography>

                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.3 }}>
                                            {loading ? <Skeleton width={80} sx={{ mx: 'auto' }} /> : `${face?.total_appearances || 0} appearances`}
                                        </Typography>

                                        {!loading && (
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.3, fontSize: '0.65rem' }}>
                                                Last seen: {formatRelative(face?.last_seen)}
                                            </Typography>
                                        )}

                                        {/* Quick actions */}
                                        {!loading && (
                                            <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                                                {!face?.is_known && (
                                                    <Tooltip title="Assign Name">
                                                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditingFace(face); setEditName(''); }}
                                                            sx={{ opacity: 0.5, '&:hover': { opacity: 1, color: '#4F8EF7' } }}>
                                                            <Edit sx={{ fontSize: 16 }} />
                                                        </IconButton>
                                                    </Tooltip>
                                                )}
                                                <Tooltip title="Delete">
                                                    <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); handleDelete(face.id); }}
                                                        sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}>
                                                        <Delete sx={{ fontSize: 16 }} />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
                                        )}
                                    </CardContent>
                                </Card>
                            </Grid>
                        );
                    })}
                </Grid>
            )}

            {/* ── Detail Dialog ─────────────────────────────── */}
            <Dialog open={!!detailFace} onClose={() => setDetailFace(null)} maxWidth="xs" fullWidth
                PaperProps={{ sx: { background: '#0f1419', borderRadius: 3, border: '1px solid rgba(148,163,184,0.08)' } }}>
                {detailFace && (
                    <>
                        <DialogTitle>Face Details</DialogTitle>
                        <DialogContent>
                            <Box sx={{ textAlign: 'center', mb: 2 }}>
                                <Avatar sx={{
                                    width: 96, height: 96, mx: 'auto', mb: 2,
                                    background: `linear-gradient(135deg, ${avatarColor(detailFace.id)}40, ${avatarColor(detailFace.id)}20)`,
                                    border: `3px solid ${avatarColor(detailFace.id)}50`,
                                    color: avatarColor(detailFace.id),
                                    fontSize: '2rem', fontWeight: 700,
                                }}
                                    src={detailFace.thumbnail || detailFace.reference_images?.[0] || undefined}
                                >
                                    {detailFace.is_known ? (detailFace.name || '?')[0].toUpperCase() : '?'}
                                </Avatar>
                                <Typography variant="h6">{detailFace.name || 'Unknown'}</Typography>
                                <Chip
                                    label={detailFace.is_known ? 'Known' : 'Unknown'}
                                    size="small"
                                    sx={{
                                        mt: 0.5,
                                        background: detailFace.is_known ? 'rgba(79,142,247,0.12)' : 'rgba(255,82,82,0.12)',
                                        color: detailFace.is_known ? '#4F8EF7' : '#FF5252',
                                    }}
                                />
                            </Box>

                            <Stack spacing={1.5}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="caption" color="text.secondary">Total Appearances</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{detailFace.total_appearances}</Typography>
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="caption" color="text.secondary">First Seen</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatDate(detailFace.first_seen)}</Typography>
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="caption" color="text.secondary">Last Seen</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatDate(detailFace.last_seen)}</Typography>
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="caption" color="text.secondary">Reference Images</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{detailFace.reference_images?.length || 0}</Typography>
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="caption" color="text.secondary">Embeddings</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{detailFace.embedding_ids?.length || 0}</Typography>
                                </Box>
                            </Stack>
                        </DialogContent>
                        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
                            <Button size="small" variant="outlined" onClick={() => handleUploadReference(detailFace.id)}>
                                Upload Photo
                            </Button>
                            {!detailFace.is_known && (
                                <Button size="small" variant="outlined" color="primary"
                                    onClick={() => { setEditingFace(detailFace); setEditName(''); setDetailFace(null); }}>
                                    Assign Name
                                </Button>
                            )}
                            <Button size="small" variant="outlined" color="error" startIcon={<Delete />}
                                onClick={() => handleDelete(detailFace.id)}>
                                Delete
                            </Button>
                        </DialogActions>
                    </>
                )}
            </Dialog>

            {/* ── Edit Name Dialog ─────────────────────────── */}
            <Dialog open={!!editingFace} onClose={() => setEditingFace(null)} maxWidth="xs" fullWidth
                PaperProps={{ sx: { background: '#0f1419', borderRadius: 3, border: '1px solid rgba(148,163,184,0.08)' } }}>
                <DialogTitle>Assign Name to Face</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        This will mark the face as "known" and enable recognition.
                    </Typography>
                    <TextField fullWidth label="Person's Name" value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleUpdate()}
                        autoFocus size="small" />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setEditingFace(null)} variant="outlined" size="small">Cancel</Button>
                    <Button onClick={handleUpdate} variant="contained" size="small" disabled={!editName.trim()}
                        startIcon={<Save />}>Save</Button>
                </DialogActions>
            </Dialog>

            {/* ── Create Face Dialog ───────────────────────── */}
            <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth
                PaperProps={{ sx: { background: '#0f1419', borderRadius: 3, border: '1px solid rgba(148,163,184,0.08)' } }}>
                <DialogTitle>Add New Face Profile</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Create a named profile, then upload reference images for recognition.
                    </Typography>
                    <TextField fullWidth label="Person's Name" value={createName}
                        onChange={e => setCreateName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleCreate()}
                        autoFocus size="small" />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setCreateOpen(false)} variant="outlined" size="small">Cancel</Button>
                    <Button onClick={handleCreate} variant="contained" size="small" disabled={!createName.trim()}
                        startIcon={<PersonAdd />}>Create</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
export default Faces;
