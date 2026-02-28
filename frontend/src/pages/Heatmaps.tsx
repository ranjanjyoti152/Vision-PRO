import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    Box, Typography, Card, CardContent, MenuItem,
    Select, FormControl, InputLabel, CircularProgress, Chip, Stack
} from '@mui/material';
import { Whatshot, CameraAlt, FiberManualRecord } from '@mui/icons-material';
import { heatmapsApi, camerasApi } from '../services/api';

const GRID_W = 32;
const GRID_H = 18;

function drawHeatmap(canvas: HTMLCanvasElement, grid: number[], gridW: number, gridH: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const cellW = cw / gridW;
    const cellH = ch / gridH;

    ctx.clearRect(0, 0, cw, ch);

    const maxVal = Math.max(...grid, 1);

    for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
            const val = grid[gy * gridW + gx] || 0;
            if (val === 0) continue;
            const intensity = val / maxVal;

            // Hot colour: blue → cyan → green → yellow → red
            const r = Math.round(Math.min(255, intensity * 2 * 255));
            const g = Math.round(Math.min(255, (1 - Math.abs(intensity - 0.5) * 2) * 255));
            const b = Math.round(Math.max(0, (1 - intensity * 2) * 255));

            ctx.fillStyle = `rgba(${r},${g},${b},${0.25 + intensity * 0.55})`;
            ctx.fillRect(gx * cellW, gy * cellH, cellW, cellH);
        }
    }
}

/* ── Live stream + heatmap overlay per camera ──────────────────── */

const CameraHeatmapCard: React.FC<{ camera: any; hours: number }> = ({ camera, hours }) => {
    const heatmapCanvasRef = useRef<HTMLCanvasElement>(null);
    const feedCanvasRef = useRef<HTMLCanvasElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [connected, setConnected] = useState(false);
    const [hasFrame, setHasFrame] = useState(false);
    const [fps, setFps] = useState(0);
    const frameCountRef = useRef(0);
    const lastFpsTimeRef = useRef(Date.now());

    // ── WebSocket live feed ──
    const connectWs = useCallback(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/cameras/ws/${camera.id}/live`;
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => setConnected(true);

        ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                const blob = new Blob([event.data], { type: 'image/jpeg' });
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    const canvas = feedCanvasRef.current;
                    if (canvas) {
                        if (canvas.width !== img.width || canvas.height !== img.height) {
                            canvas.width = img.width;
                            canvas.height = img.height;
                        }
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.drawImage(img, 0, 0);
                            setHasFrame(true);
                        }
                    }
                    URL.revokeObjectURL(url);
                    frameCountRef.current++;
                    const now = Date.now();
                    if (now - lastFpsTimeRef.current >= 1000) {
                        setFps(frameCountRef.current);
                        frameCountRef.current = 0;
                        lastFpsTimeRef.current = now;
                    }
                };
                img.src = url;
            }
        };

        ws.onclose = () => {
            setConnected(false);
            setHasFrame(false);
            setTimeout(() => {
                if (wsRef.current === ws) connectWs();
            }, 3000);
        };

        ws.onerror = () => {
            setConnected(false);
            setHasFrame(false);
        };

        wsRef.current = ws;
    }, [camera.id]);

    useEffect(() => {
        connectWs();
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [connectWs]);

    // ── Heatmap data ──
    useEffect(() => {
        setLoading(true);
        heatmapsApi.getHeatmap(camera.id, hours, GRID_W, GRID_H)
            .then((res: any) => {
                const { heatmap_data, grid_width, grid_height, total_detections } = res.data;
                setTotal(total_detections);
                if (heatmapCanvasRef.current) {
                    drawHeatmap(heatmapCanvasRef.current, heatmap_data, grid_width, grid_height);
                }
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, [camera.id, hours]);

    return (
        <Card>
            <CardContent sx={{ p: 2 }}>
                {/* Header */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <FiberManualRecord sx={{ fontSize: 10, color: connected ? '#00E676' : '#FF5252' }} />
                        <CameraAlt sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{camera.name}</Typography>
                        {connected && (
                            <Chip label={`${fps} FPS`} size="small"
                                sx={{ height: 18, fontSize: 9, fontWeight: 700, background: 'rgba(0,230,118,0.1)', color: '#00E676' }} />
                        )}
                    </Box>
                    <Chip
                        size="small"
                        label={`${total} detections`}
                        sx={{ height: 20, fontSize: 10, background: 'rgba(79,142,247,0.15)', color: '#4F8EF7' }}
                    />
                </Box>

                {/* Stream + Heatmap Overlay */}
                <Box sx={{ position: 'relative', borderRadius: 1.5, overflow: 'hidden', background: '#0A0F1E' }}>
                    {/* Loading spinner */}
                    {(loading || !hasFrame) && (
                        <Box sx={{
                            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', background: 'rgba(10,15,30,0.85)', zIndex: 2,
                        }}>
                            <CircularProgress size={24} sx={{ mb: 1 }} />
                            <Typography variant="caption" color="text.secondary">
                                {!hasFrame ? 'Connecting to stream...' : 'Loading heatmap...'}
                            </Typography>
                        </Box>
                    )}

                    {/* Live camera feed (bottom layer) */}
                    <canvas
                        ref={feedCanvasRef}
                        style={{
                            width: '100%',
                            aspectRatio: '16/9',
                            display: 'block',
                            objectFit: 'cover',
                        }}
                    />

                    {/* Heatmap overlay (top layer — transparent) */}
                    <canvas
                        ref={heatmapCanvasRef}
                        width={640}
                        height={360}
                        style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            pointerEvents: 'none',
                        }}
                    />

                    {/* LIVE badge */}
                    {connected && hasFrame && (
                        <Box sx={{
                            position: 'absolute', top: 8, left: 8,
                            background: 'rgba(0,0,0,0.6)', borderRadius: 1,
                            px: 1, py: 0.25, display: 'flex', alignItems: 'center', gap: 0.5,
                        }}>
                            <FiberManualRecord sx={{ fontSize: 8, color: '#FF5252', animation: 'pulse 1.5s infinite' }} />
                            <Typography variant="caption" sx={{ fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>LIVE</Typography>
                        </Box>
                    )}
                </Box>

                {/* Legend */}
                <Stack direction="row" spacing={0.5} sx={{ mt: 1, justifyContent: 'center' }}>
                    {['Low', 'Med', 'High'].map((label, i) => {
                        const colors = ['rgba(0,0,255,0.6)', 'rgba(0,255,0,0.6)', 'rgba(255,0,0,0.6)'];
                        return (
                            <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Box sx={{ width: 10, height: 10, borderRadius: 1, background: colors[i] }} />
                                <Typography variant="caption" color="text.secondary">{label}</Typography>
                            </Box>
                        );
                    })}
                </Stack>
            </CardContent>
        </Card>
    );
};

/* ── Heatmaps page ─────────────────────────────────────────────── */

const Heatmaps: React.FC = () => {
    const [cameras, setCameras] = useState<any[]>([]);
    const [hours, setHours] = useState(24);
    const [loadingCameras, setLoadingCameras] = useState(true);

    useEffect(() => {
        setLoadingCameras(true);
        camerasApi.list().then(res => setCameras(res.data || [])).finally(() => setLoadingCameras(false));
    }, []);

    const enabledCameras = cameras.filter(c => c.enabled);

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
                <Box>
                    <Typography variant="h4" sx={{ mb: 0.5, fontWeight: 700 }}>Activity Heatmaps</Typography>
                    <Typography variant="body2" color="text.secondary">Live camera feed with movement density overlay</Typography>
                </Box>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Time Window</InputLabel>
                    <Select value={hours} label="Time Window" onChange={e => setHours(Number(e.target.value))}>
                        <MenuItem value={1}>Last 1 Hour</MenuItem>
                        <MenuItem value={6}>Last 6 Hours</MenuItem>
                        <MenuItem value={24}>Last 24 Hours</MenuItem>
                        <MenuItem value={72}>Last 3 Days</MenuItem>
                        <MenuItem value={168}>Last 7 Days</MenuItem>
                    </Select>
                </FormControl>
            </Box>

            {loadingCameras ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            ) : enabledCameras.length === 0 ? (
                <Card>
                    <CardContent sx={{ p: 5, textAlign: 'center' }}>
                        <Whatshot sx={{ fontSize: 56, color: 'text.secondary', mb: 2 }} />
                        <Typography variant="h6" color="text.secondary">No active cameras</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            Enable a camera to start seeing activity heatmaps here
                        </Typography>
                    </CardContent>
                </Card>
            ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    {enabledCameras.map(cam => (
                        <Box key={cam.id} sx={{ flex: '1 1 480px', minWidth: 360 }}>
                            <CameraHeatmapCard camera={cam} hours={hours} />
                        </Box>
                    ))}
                </Box>
            )}

            {/* Pulse animation for LIVE badge */}
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.3; }
                }
            `}</style>
        </Box>
    );
};

export default Heatmaps;
