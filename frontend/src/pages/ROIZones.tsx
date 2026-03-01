import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Box, Typography, IconButton, Paper, Tooltip, Chip,
    Select, MenuItem, FormControl, InputLabel, TextField,
    Switch, FormControlLabel, Button, Dialog,
    DialogTitle, DialogContent, DialogActions, Fade,
} from '@mui/material';
import {
    Crop, Add, Delete, Edit, Save, Close, Visibility,
    VisibilityOff, NotificationsActive, NotificationsOff,
    PhotoCamera, Undo, CheckCircle, Warning,
    Login as EnterIcon, Logout as ExitIcon, Timer, SwapHoriz,
    Videocam,
} from '@mui/icons-material';
import api, { camerasApi, roiApi } from '../services/api';

/* ── Types ───────────────────────────────────────────────────────── */

interface ROIZone {
    id: string;
    name: string;
    camera_id: string;
    points: number[][];
    trigger_type: string;
    trigger_classes: string[];
    enabled: boolean;
    color: string;
    notify: boolean;
    loiter_seconds: number;
}

interface Camera {
    id: string;
    name: string;
    location: string;
    enabled: boolean;
}

const TRIGGER_TYPES = [
    { value: 'enter', label: 'Enter Zone', icon: <EnterIcon sx={{ fontSize: 18 }} />, desc: 'Object enters the zone' },
    { value: 'exit', label: 'Exit Zone', icon: <ExitIcon sx={{ fontSize: 18 }} />, desc: 'Object exits the zone' },
    { value: 'loiter', label: 'Loiter', icon: <Timer sx={{ fontSize: 18 }} />, desc: 'Object stays too long' },
    { value: 'enter_exit', label: 'Enter + Exit', icon: <SwapHoriz sx={{ fontSize: 18 }} />, desc: 'Both enter and exit' },
];

const ZONE_COLORS = [
    '#FF5722', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
    '#2196F3', '#00BCD4', '#009688', '#4CAF50', '#FF9800',
    '#F44336', '#795548',
];

/* ── Component ───────────────────────────────────────────────────── */

const ROIZones: React.FC = () => {
    const [cameras, setCameras] = useState<Camera[]>([]);
    const [selectedCamera, setSelectedCamera] = useState<string>('');
    const [zones, setZones] = useState<ROIZone[]>([]);
    const [classes, setClasses] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    // Drawing state
    const [drawing, setDrawing] = useState(false);
    const [currentPoints, setCurrentPoints] = useState<number[][]>([]);
    const [editingZone, setEditingZone] = useState<ROIZone | null>(null);

    // Config dialog
    const [configOpen, setConfigOpen] = useState(false);
    const [zoneName, setZoneName] = useState('');
    const [triggerType, setTriggerType] = useState('enter');
    const [triggerClasses, setTriggerClasses] = useState<string[]>(['person', 'car']);
    const [zoneColor, setZoneColor] = useState('#FF5722');
    const [notify, setNotify] = useState(true);
    const [loiterSeconds, setLoiterSeconds] = useState(10);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);

    // ── Fetch data ─────────────────────────────────────────────────

    const fetchCameras = useCallback(async () => {
        try {
            const res = await camerasApi.list();
            const raw = res.data.cameras || res.data || [];
            const cams = raw.map((c: any) => ({
                id: c.id || c._id,
                name: c.name || 'Unnamed',
                location: c.location || '',
                enabled: c.enabled,
            }));
            setCameras(cams);
            if (cams.length > 0 && !selectedCamera) setSelectedCamera(cams[0].id);
        } catch (e) { console.error('Failed to load cameras', e); }
    }, [selectedCamera]);

    const fetchZones = useCallback(async () => {
        if (!selectedCamera) return;
        try {
            const res = await roiApi.list(selectedCamera);
            setZones(res.data.zones || []);
        } catch (e) { console.error('Failed to load zones', e); }
    }, [selectedCamera]);

    const fetchClasses = useCallback(async () => {
        try {
            const res = await roiApi.getClasses();
            setClasses(res.data.classes || []);
        } catch (e) { console.error('Failed to load classes', e); }
    }, []);

    useEffect(() => { fetchCameras(); fetchClasses(); }, [fetchCameras, fetchClasses]);
    useEffect(() => { fetchZones(); }, [fetchZones]);

    // ── Snapshot fetching (authenticated) ──────────────────────────

    const [snapshotUrl, setSnapshotUrl] = useState<string>('');

    const fetchSnapshot = useCallback(async () => {
        if (!selectedCamera) { setSnapshotUrl(''); return; }
        try {
            const res = await api.get(`/cameras/${selectedCamera}/snapshot`, { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            setSnapshotUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
        } catch { /* ignore */ }
    }, [selectedCamera]);

    useEffect(() => { fetchSnapshot(); }, [fetchSnapshot]);
    useEffect(() => {
        if (!selectedCamera) return;
        const interval = setInterval(fetchSnapshot, 3000);
        return () => clearInterval(interval);
    }, [selectedCamera, fetchSnapshot]);

    // ── Canvas drawing ─────────────────────────────────────────────

    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        if (!canvas || !img || !img.naturalWidth) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = img.clientWidth;
        canvas.height = img.clientHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const zone of zones) {
            if (editingZone?.id === zone.id) continue;
            drawPoly(ctx, zone.points, zone.color, zone.enabled ? 0.25 : 0.08, zone.name, canvas.width, canvas.height);
        }

        if (currentPoints.length > 0) {
            const color = editingZone ? editingZone.color : zoneColor;
            drawPoly(ctx, currentPoints, color, 0.3, '', canvas.width, canvas.height, true);
        }
    }, [zones, currentPoints, editingZone, zoneColor]);

    const drawPoly = (
        ctx: CanvasRenderingContext2D, pts: number[][], color: string,
        alpha: number, label: string, w: number, h: number, isDrawing = false
    ) => {
        if (pts.length < 2) {
            for (const p of pts) {
                ctx.beginPath();
                ctx.arc(p[0] * w, p[1] * h, 6, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            return;
        }

        ctx.beginPath();
        ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
        if (!isDrawing) ctx.closePath();

        ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0');
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.setLineDash(isDrawing ? [8, 5] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p[0] * w, p[1] * h, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        if (label && pts.length >= 3) {
            const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length * w;
            const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length * h;
            ctx.font = 'bold 13px Inter, sans-serif';
            ctx.textAlign = 'center';
            const metrics = ctx.measureText(label);
            const pad = 8;
            ctx.fillStyle = color + 'CC';
            const rw = metrics.width + pad * 2;
            const rh = 24;
            const rx = cx - rw / 2;
            const ry = cy - rh / 2;
            ctx.beginPath();
            ctx.roundRect(rx, ry, rw, rh, 4);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(label, cx, cy + 5);
        }
    };

    useEffect(() => { drawCanvas(); }, [drawCanvas]);
    const handleImageLoad = () => { drawCanvas(); };

    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!drawing) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        setCurrentPoints(prev => [...prev, [
            (e.clientX - rect.left) / rect.width,
            (e.clientY - rect.top) / rect.height,
        ]]);
    };

    const handleFinishDraw = () => {
        if (!drawing || currentPoints.length < 3) return;
        setDrawing(false);
        setConfigOpen(true);
    };

    // ── Zone CRUD ──────────────────────────────────────────────────

    const handleSaveZone = async () => {
        if (currentPoints.length < 3) return;
        setLoading(true);
        try {
            const payload = {
                name: zoneName, points: currentPoints, trigger_type: triggerType,
                trigger_classes: triggerClasses, color: zoneColor, notify, loiter_seconds: loiterSeconds,
            };
            if (editingZone) {
                await roiApi.update(editingZone.id, payload);
            } else {
                await roiApi.create({ ...payload, camera_id: selectedCamera });
            }
            await fetchZones();
            resetDrawing();
        } catch (e) { console.error('Failed to save zone', e); }
        setLoading(false);
    };

    const handleDeleteZone = async (id: string) => {
        try { await roiApi.delete(id); await fetchZones(); } catch (e) { console.error(e); }
    };

    const handleToggleZone = async (zone: ROIZone) => {
        try { await roiApi.update(zone.id, { enabled: !zone.enabled }); await fetchZones(); } catch (e) { console.error(e); }
    };

    const handleEditZone = (zone: ROIZone) => {
        setEditingZone(zone);
        setCurrentPoints(zone.points);
        setZoneName(zone.name);
        setTriggerType(zone.trigger_type);
        setTriggerClasses(zone.trigger_classes);
        setZoneColor(zone.color);
        setNotify(zone.notify);
        setLoiterSeconds(zone.loiter_seconds);
        setDrawing(true);
    };

    const resetDrawing = () => {
        setDrawing(false);
        setCurrentPoints([]);
        setEditingZone(null);
        setConfigOpen(false);
        setZoneName('');
        setTriggerType('enter');
        setTriggerClasses(['person', 'car']);
        setZoneColor(ZONE_COLORS[Math.floor(Math.random() * ZONE_COLORS.length)]);
        setNotify(true);
        setLoiterSeconds(10);
    };

    const startDrawing = () => {
        resetDrawing();
        setDrawing(true);
        setZoneColor(ZONE_COLORS[Math.floor(Math.random() * ZONE_COLORS.length)]);
    };

    const camLabel = (c: Camera) => {
        if (c.location) return `${c.name} — ${c.location}`;
        return `Camera: ${c.name}`;
    };

    // ── Render ──────────────────────────────────────────────────────

    return (
        <Box sx={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* ── Header ──────────────────────────────────────────── */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{
                        width: 48, height: 48, borderRadius: 3,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'linear-gradient(135deg, #FF5722, #E91E63)',
                        boxShadow: '0 4px 20px rgba(255,87,34,0.25)',
                    }}>
                        <Crop sx={{ fontSize: 26, color: '#fff' }} />
                    </Box>
                    <Box>
                        <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
                            ROI Zones
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'rgba(148,163,184,0.5)' }}>
                            Draw polygon regions and configure detection triggers
                        </Typography>
                    </Box>
                </Box>
            </Box>

            {/* ── Main Layout ─────────────────────────────────────── */}
            <Box sx={{ flex: 1, display: 'flex', gap: 2, overflow: 'hidden' }}>

                {/* ── Left: Camera Feed ────────────────────────────── */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {/* Camera bar */}
                    <Paper elevation={0} sx={{
                        display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1,
                        borderRadius: 2.5, background: 'rgba(15,23,42,0.6)',
                        border: '1px solid rgba(148,163,184,0.06)',
                    }}>
                        <Videocam sx={{ fontSize: 20, color: 'rgba(148,163,184,0.4)' }} />
                        <FormControl size="small" sx={{ flex: 1 }}>
                            <Select value={selectedCamera} displayEmpty
                                onChange={e => { setSelectedCamera(e.target.value); resetDrawing(); }}
                                sx={{
                                    borderRadius: 2, fontSize: '0.85rem',
                                    background: 'rgba(255,255,255,0.02)',
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148,163,184,0.08)' },
                                }}>
                                {cameras.map(c => (
                                    <MenuItem key={c.id} value={c.id}>{camLabel(c)}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {/* Draw / Finish buttons */}
                        {drawing ? (
                            <>
                                <Tooltip title="Undo last point">
                                    <span>
                                        <IconButton size="small" onClick={() => setCurrentPoints(p => p.slice(0, -1))}
                                            disabled={currentPoints.length === 0}
                                            sx={{ background: 'rgba(255,255,255,0.04)', borderRadius: 1.5 }}>
                                            <Undo sx={{ fontSize: 18 }} />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                                <Button size="small" color="error" onClick={resetDrawing}
                                    sx={{ textTransform: 'none', borderRadius: 2, minWidth: 80 }}>
                                    Cancel
                                </Button>
                                <Button size="small" variant="contained" onClick={handleFinishDraw}
                                    disabled={currentPoints.length < 3}
                                    startIcon={<CheckCircle sx={{ fontSize: 16 }} />}
                                    sx={{
                                        textTransform: 'none', borderRadius: 2, minWidth: 100,
                                        background: 'linear-gradient(135deg, #4F8EF7, #7C4DFF)',
                                    }}>
                                    Finish ({currentPoints.length} pts)
                                </Button>
                            </>
                        ) : (
                            <Button size="small" variant="contained" onClick={startDrawing}
                                disabled={!selectedCamera} startIcon={<Add sx={{ fontSize: 16 }} />}
                                sx={{
                                    textTransform: 'none', borderRadius: 2, px: 2.5,
                                    background: 'linear-gradient(135deg, #FF5722, #E91E63)',
                                    '&:hover': { background: 'linear-gradient(135deg, #E64A19, #C2185B)' },
                                }}>
                                Draw Zone
                            </Button>
                        )}
                    </Paper>

                    {/* Canvas area */}
                    <Paper sx={{
                        flex: 1, position: 'relative', overflow: 'hidden', borderRadius: 3,
                        border: drawing ? '2px solid rgba(255,87,34,0.35)' : '1px solid rgba(148,163,184,0.06)',
                        background: '#0A0E18',
                        cursor: drawing ? 'crosshair' : 'default',
                        transition: 'border-color 0.3s',
                    }}>
                        {selectedCamera && snapshotUrl ? (
                            <>
                                <img ref={imgRef} src={snapshotUrl} alt="Camera feed"
                                    onLoad={handleImageLoad}
                                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                                <canvas ref={canvasRef} onClick={handleCanvasClick}
                                    onDoubleClick={handleFinishDraw}
                                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                                {drawing && (
                                    <Fade in>
                                        <Box sx={{
                                            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                                            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
                                            borderRadius: 2.5, px: 2.5, py: 1, display: 'flex', alignItems: 'center', gap: 1,
                                            border: '1px solid rgba(255,87,34,0.25)',
                                        }}>
                                            <Warning sx={{ fontSize: 14, color: '#FF9800' }} />
                                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.72rem' }}>
                                                Click to place points · Double-click or "Finish" to close polygon (min 3)
                                            </Typography>
                                        </Box>
                                    </Fade>
                                )}
                            </>
                        ) : (
                            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <PhotoCamera sx={{ fontSize: 48, color: 'rgba(148,163,184,0.15)', mb: 1 }} />
                                    <Typography variant="body2" sx={{ color: 'rgba(148,163,184,0.4)' }}>
                                        {selectedCamera ? 'Loading camera feed...' : 'Select a camera to begin'}
                                    </Typography>
                                </Box>
                            </Box>
                        )}
                    </Paper>
                </Box>

                {/* ── Right: Zone list ─────────────────────────────── */}
                <Paper elevation={0} sx={{
                    width: 300, display: 'flex', flexDirection: 'column', borderRadius: 3,
                    border: '1px solid rgba(148,163,184,0.06)', background: 'rgba(15,23,42,0.5)',
                    overflow: 'hidden',
                }}>
                    <Box sx={{
                        p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        borderBottom: '1px solid rgba(148,163,184,0.06)',
                    }}>
                        <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.88rem' }}>
                                Zones
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'rgba(148,163,184,0.4)', fontSize: '0.65rem' }}>
                                {zones.length} zone{zones.length !== 1 ? 's' : ''} · {cameras.find(c => c.id === selectedCamera)?.name || '—'}
                            </Typography>
                        </Box>
                        <Chip size="small" label={zones.length}
                            sx={{
                                height: 24, minWidth: 24, fontWeight: 700, fontSize: '0.72rem',
                                background: zones.length > 0 ? 'rgba(79,142,247,0.12)' : 'rgba(148,163,184,0.06)',
                                color: zones.length > 0 ? '#93C5FD' : 'rgba(148,163,184,0.4)',
                            }} />
                    </Box>

                    <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
                        {zones.length === 0 && (
                            <Box sx={{ textAlign: 'center', py: 6 }}>
                                <Box sx={{
                                    width: 56, height: 56, borderRadius: '50%', mx: 'auto', mb: 1.5,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: 'rgba(148,163,184,0.04)', border: '1px dashed rgba(148,163,184,0.1)',
                                }}>
                                    <Crop sx={{ fontSize: 24, color: 'rgba(148,163,184,0.2)' }} />
                                </Box>
                                <Typography variant="body2" sx={{ color: 'rgba(148,163,184,0.4)', fontSize: '0.8rem', mb: 0.3 }}>
                                    No zones yet
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'rgba(148,163,184,0.25)', fontSize: '0.68rem' }}>
                                    Click "Draw Zone" to get started
                                </Typography>
                            </Box>
                        )}

                        {zones.map(zone => (
                            <Paper key={zone.id} elevation={0} sx={{
                                p: 1.5, mb: 1, borderRadius: 2,
                                background: zone.enabled ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.005)',
                                border: `1px solid ${zone.enabled ? zone.color + '25' : 'rgba(148,163,184,0.04)'}`,
                                opacity: zone.enabled ? 1 : 0.45,
                                transition: 'all 0.2s',
                                '&:hover': { borderColor: zone.color + '50', background: 'rgba(255,255,255,0.03)' },
                            }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.8 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                                        <Box sx={{
                                            width: 10, height: 10, borderRadius: '50%',
                                            background: zone.color, flexShrink: 0,
                                            boxShadow: `0 0 6px ${zone.color}60`,
                                        }} />
                                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }} noWrap>
                                            {zone.name}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 0.2, flexShrink: 0 }}>
                                        <IconButton size="small" onClick={() => handleToggleZone(zone)} sx={{ p: 0.5 }}>
                                            {zone.enabled ? <Visibility sx={{ fontSize: 15, color: 'rgba(148,163,184,0.5)' }} /> : <VisibilityOff sx={{ fontSize: 15 }} />}
                                        </IconButton>
                                        <IconButton size="small" onClick={() => handleEditZone(zone)} sx={{ p: 0.5 }}>
                                            <Edit sx={{ fontSize: 15, color: 'rgba(148,163,184,0.5)' }} />
                                        </IconButton>
                                        <IconButton size="small" onClick={() => handleDeleteZone(zone.id)} sx={{ p: 0.5 }}>
                                            <Delete sx={{ fontSize: 15, color: 'rgba(239,68,68,0.5)' }} />
                                        </IconButton>
                                    </Box>
                                </Box>

                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                    <Chip size="small"
                                        label={TRIGGER_TYPES.find(t => t.value === zone.trigger_type)?.label || zone.trigger_type}
                                        sx={{ height: 18, fontSize: '0.58rem', background: 'rgba(79,142,247,0.08)', color: '#93C5FD' }} />
                                    {zone.notify && (
                                        <Chip size="small" icon={<NotificationsActive sx={{ fontSize: 10 }} />} label="Notify"
                                            sx={{
                                                height: 18, fontSize: '0.58rem', background: 'rgba(16,185,129,0.08)', color: '#6EE7B7',
                                                '& .MuiChip-icon': { color: '#6EE7B7' }
                                            }} />
                                    )}
                                    {zone.trigger_classes.slice(0, 2).map(c => (
                                        <Chip key={c} size="small" label={c}
                                            sx={{ height: 18, fontSize: '0.56rem', background: 'rgba(139,92,246,0.08)', color: '#C4B5FD' }} />
                                    ))}
                                    {zone.trigger_classes.length > 2 && (
                                        <Chip size="small" label={`+${zone.trigger_classes.length - 2}`}
                                            sx={{ height: 18, fontSize: '0.56rem', background: 'rgba(148,163,184,0.06)' }} />
                                    )}
                                </Box>
                            </Paper>
                        ))}
                    </Box>
                </Paper>
            </Box>

            {/* ── Zone Config Dialog ──────────────────────────────── */}
            <Dialog open={configOpen} onClose={() => setConfigOpen(false)} maxWidth="sm" fullWidth
                PaperProps={{ sx: { borderRadius: 3, background: '#111827', border: '1px solid rgba(148,163,184,0.08)' } }}>
                <DialogTitle sx={{ pb: 0.5 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
                        {editingZone ? 'Edit Zone' : 'Configure New Zone'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(148,163,184,0.4)' }}>
                        Set trigger rules, detection classes, and notification preferences
                    </Typography>
                </DialogTitle>
                <DialogContent sx={{ pt: '12px !important' }}>
                    {/* Zone name */}
                    <TextField fullWidth label="Zone Name" value={zoneName}
                        onChange={e => setZoneName(e.target.value)}
                        placeholder="e.g., Parking Entry, Restricted Area"
                        size="small" sx={{ mb: 2.5, '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />

                    {/* Trigger type */}
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'rgba(255,255,255,0.6)', mb: 1, display: 'block', textTransform: 'uppercase', fontSize: '0.62rem', letterSpacing: '0.06em' }}>
                        Trigger Type
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2.5 }}>
                        {TRIGGER_TYPES.map(t => (
                            <Paper key={t.value} elevation={0} onClick={() => setTriggerType(t.value)}
                                sx={{
                                    p: 1.5, cursor: 'pointer', borderRadius: 2.5, textAlign: 'center',
                                    border: triggerType === t.value ? '1px solid rgba(79,142,247,0.35)' : '1px solid rgba(148,163,184,0.06)',
                                    background: triggerType === t.value ? 'rgba(79,142,247,0.06)' : 'rgba(255,255,255,0.01)',
                                    transition: 'all 0.2s',
                                    '&:hover': { borderColor: 'rgba(79,142,247,0.2)', background: 'rgba(79,142,247,0.03)' },
                                }}>
                                <Box sx={{ color: triggerType === t.value ? '#4F8EF7' : 'rgba(148,163,184,0.4)', mb: 0.3 }}>{t.icon}</Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.72rem', display: 'block' }}>{t.label}</Typography>
                                <Typography variant="caption" sx={{ color: 'rgba(148,163,184,0.35)', fontSize: '0.6rem' }}>{t.desc}</Typography>
                            </Paper>
                        ))}
                    </Box>

                    {triggerType === 'loiter' && (
                        <TextField fullWidth label="Loiter Duration (seconds)" type="number"
                            value={loiterSeconds} onChange={e => setLoiterSeconds(Number(e.target.value))}
                            size="small" sx={{ mb: 2.5, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                            inputProps={{ min: 1, max: 300 }} />
                    )}

                    {/* Detection classes */}
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'rgba(255,255,255,0.6)', mb: 1, display: 'block', textTransform: 'uppercase', fontSize: '0.62rem', letterSpacing: '0.06em' }}>
                        Detection Classes ({triggerClasses.length} selected)
                    </Typography>
                    <Box sx={{
                        display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2.5,
                        maxHeight: 130, overflow: 'auto', p: 1, borderRadius: 2,
                        background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(148,163,184,0.05)',
                    }}>
                        {classes.map(cls => (
                            <Chip key={cls} label={cls} size="small"
                                onClick={() => setTriggerClasses(prev =>
                                    prev.includes(cls) ? prev.filter(c => c !== cls) : [...prev, cls]
                                )}
                                sx={{
                                    borderRadius: 2, cursor: 'pointer', height: 26,
                                    background: triggerClasses.includes(cls) ? 'rgba(79,142,247,0.12)' : 'rgba(255,255,255,0.02)',
                                    border: triggerClasses.includes(cls) ? '1px solid rgba(79,142,247,0.25)' : '1px solid rgba(148,163,184,0.06)',
                                    color: triggerClasses.includes(cls) ? '#93C5FD' : 'rgba(148,163,184,0.4)',
                                    '&:hover': { background: 'rgba(79,142,247,0.08)' },
                                }}
                            />
                        ))}
                    </Box>

                    {/* Color */}
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'rgba(255,255,255,0.6)', mb: 1, display: 'block', textTransform: 'uppercase', fontSize: '0.62rem', letterSpacing: '0.06em' }}>
                        Zone Color
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
                        {ZONE_COLORS.map(c => (
                            <Box key={c} onClick={() => setZoneColor(c)}
                                sx={{
                                    width: 30, height: 30, borderRadius: 2, background: c, cursor: 'pointer',
                                    border: zoneColor === c ? '2.5px solid #fff' : '2px solid transparent',
                                    boxShadow: zoneColor === c ? `0 0 8px ${c}80` : 'none',
                                    transition: 'all 0.15s',
                                    '&:hover': { transform: 'scale(1.12)' },
                                }}
                            />
                        ))}
                    </Box>

                    {/* Notifications */}
                    <FormControlLabel
                        control={<Switch checked={notify} onChange={e => setNotify(e.target.checked)}
                            sx={{
                                '& .MuiSwitch-switchBase.Mui-checked': { color: '#10B981' },
                                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#10B981' },
                            }} />}
                        label={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                {notify ? <NotificationsActive sx={{ fontSize: 16, color: '#10B981' }} /> : <NotificationsOff sx={{ fontSize: 16, color: 'rgba(148,163,184,0.3)' }} />}
                                <Typography variant="body2" sx={{ fontSize: '0.82rem' }}>
                                    {notify ? 'Notifications enabled' : 'Notifications disabled'}
                                </Typography>
                            </Box>
                        }
                    />
                </DialogContent>
                <DialogActions sx={{ p: 2.5, pt: 1 }}>
                    <Button onClick={() => { setConfigOpen(false); resetDrawing(); }}
                        sx={{ textTransform: 'none', borderRadius: 2, color: 'rgba(148,163,184,0.5)' }}>
                        Cancel
                    </Button>
                    <Button variant="contained" onClick={handleSaveZone}
                        disabled={!zoneName.trim() || loading} startIcon={<Save sx={{ fontSize: 16 }} />}
                        sx={{
                            textTransform: 'none', borderRadius: 2, px: 3,
                            background: 'linear-gradient(135deg, #4F8EF7, #7C4DFF)',
                            '&:hover': { background: 'linear-gradient(135deg, #2563EB, #651FFF)' },
                        }}>
                        {editingZone ? 'Update Zone' : 'Save Zone'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default ROIZones;
