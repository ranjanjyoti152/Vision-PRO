import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    Box, Typography, Card, CardContent, MenuItem,
    Select, FormControl, InputLabel, CircularProgress, Chip, Stack
} from '@mui/material';
import { Whatshot, CameraAlt, FiberManualRecord } from '@mui/icons-material';
import { camerasApi } from '../services/api';

const GRID_W = 32;
const GRID_H = 18;

/* ── Colour helpers ─────────────────────────────────────────────── */

const CLASS_COLORS: Record<string, string> = {
    person: '#00E5FF',
    car: '#FF9100',
    truck: '#FF3D00',
    bus: '#FF6D00',
    motorcycle: '#FFAB00',
    bicycle: '#76FF03',
    dog: '#E040FB',
    cat: '#EA80FC',
    bird: '#B388FF',
    horse: '#82B1FF',
};

function getClassColor(cls: string): string {
    return CLASS_COLORS[cls] || '#4FC3F7';
}

/* ── Heatmap renderer ───────────────────────────────────────────── */

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

/* ── Bounding-box renderer ──────────────────────────────────────── */

interface Detection {
    class: string;
    confidence: number;
    bbox: { x: number; y: number; w: number; h: number };
}

function drawBoundingBoxes(
    canvas: HTMLCanvasElement,
    detections: Detection[],
    frameW: number,
    frameH: number,
) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    const scaleX = cw / frameW;
    const scaleY = ch / frameH;

    for (const det of detections) {
        const { bbox } = det;
        const x = bbox.x * scaleX;
        const y = bbox.y * scaleY;
        const w = bbox.w * scaleX;
        const h = bbox.h * scaleY;
        const color = getClassColor(det.class);
        const label = `${det.class} ${Math.round(det.confidence * 100)}%`;

        // Bounding box
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // Corner accents (top-left & bottom-right)
        const cornerLen = Math.min(w, h, 16) * 0.4;
        ctx.lineWidth = 3;
        // top-left
        ctx.beginPath();
        ctx.moveTo(x, y + cornerLen);
        ctx.lineTo(x, y);
        ctx.lineTo(x + cornerLen, y);
        ctx.stroke();
        // bottom-right
        ctx.beginPath();
        ctx.moveTo(x + w - cornerLen, y + h);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x + w, y + h - cornerLen);
        ctx.stroke();

        // Label background
        ctx.font = 'bold 11px Inter, system-ui, sans-serif';
        const tm = ctx.measureText(label);
        const lw = tm.width + 8;
        const lh = 16;
        ctx.fillStyle = color + 'CC';
        ctx.beginPath();
        ctx.roundRect(x, y - lh - 2, lw, lh, 3);
        ctx.fill();

        // Label text
        ctx.fillStyle = '#000';
        ctx.fillText(label, x + 4, y - 5);
    }
}

/* ── Live stream + detections + heatmap card ────────────────────── */

const CameraHeatmapCard: React.FC<{ camera: any }> = ({ camera }) => {
    const heatmapCanvasRef = useRef<HTMLCanvasElement>(null);
    const feedCanvasRef = useRef<HTMLCanvasElement>(null);
    const bboxCanvasRef = useRef<HTMLCanvasElement>(null);
    const feedWsRef = useRef<WebSocket | null>(null);
    const detWsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [detConnected, setDetConnected] = useState(false);
    const [hasFrame, setHasFrame] = useState(false);
    const [fps, setFps] = useState(0);
    const [detectionCount, setDetectionCount] = useState(0);
    const frameCountRef = useRef(0);
    const lastFpsTimeRef = useRef(Date.now());
    const totalDetRef = useRef(0);

    // Heatmap accumulation grid (client-side, from live detections)
    const heatGridRef = useRef<number[]>(new Array(GRID_W * GRID_H).fill(0));
    const heatRedrawTimerRef = useRef<number | null>(null);

    // ── WebSocket: live JPEG feed ──
    const connectFeedWs = useCallback(() => {
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
                            // Sync bbox and heatmap canvas sizes
                            if (bboxCanvasRef.current) {
                                bboxCanvasRef.current.width = img.width;
                                bboxCanvasRef.current.height = img.height;
                            }
                            if (heatmapCanvasRef.current) {
                                heatmapCanvasRef.current.width = img.width;
                                heatmapCanvasRef.current.height = img.height;
                            }
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
                if (feedWsRef.current === ws) connectFeedWs();
            }, 3000);
        };

        ws.onerror = () => { setConnected(false); setHasFrame(false); };
        feedWsRef.current = ws;
    }, [camera.id]);

    // ── WebSocket: live detections (JSON) ──
    const connectDetWs = useCallback(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/cameras/ws/${camera.id}/detections`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => setDetConnected(true);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const dets: Detection[] = data.detections || [];
                const frameW: number = data.frame_w || 1920;
                const frameH: number = data.frame_h || 1080;

                // Draw bounding boxes
                if (bboxCanvasRef.current) {
                    drawBoundingBoxes(bboxCanvasRef.current, dets, frameW, frameH);
                }

                // Accumulate heatmap from detection centres
                for (const det of dets) {
                    const cx = det.bbox.x + det.bbox.w / 2;
                    const cy = det.bbox.y + det.bbox.h / 2;
                    const gx = Math.min(Math.floor(cx / frameW * GRID_W), GRID_W - 1);
                    const gy = Math.min(Math.floor(cy / frameH * GRID_H), GRID_H - 1);
                    heatGridRef.current[gy * GRID_W + gx] += 1;
                }

                totalDetRef.current += dets.length;
                setDetectionCount(totalDetRef.current);

                // Throttle heatmap redraw (every 500ms)
                if (!heatRedrawTimerRef.current) {
                    heatRedrawTimerRef.current = window.setTimeout(() => {
                        if (heatmapCanvasRef.current) {
                            drawHeatmap(heatmapCanvasRef.current, heatGridRef.current, GRID_W, GRID_H);
                        }
                        heatRedrawTimerRef.current = null;
                    }, 500);
                }
            } catch {
                // ignore malformed messages
            }
        };

        ws.onclose = () => {
            setDetConnected(false);
            setTimeout(() => {
                if (detWsRef.current === ws) connectDetWs();
            }, 3000);
        };

        ws.onerror = () => setDetConnected(false);
        detWsRef.current = ws;
    }, [camera.id]);

    // ── Lifecycle ──
    useEffect(() => {
        connectFeedWs();
        connectDetWs();
        return () => {
            if (feedWsRef.current) { feedWsRef.current.close(); feedWsRef.current = null; }
            if (detWsRef.current) { detWsRef.current.close(); detWsRef.current = null; }
            if (heatRedrawTimerRef.current) clearTimeout(heatRedrawTimerRef.current);
        };
    }, [connectFeedWs, connectDetWs]);

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
                        {detConnected && (
                            <Chip label="AI" size="small"
                                sx={{ height: 18, fontSize: 9, fontWeight: 700, background: 'rgba(0,229,255,0.1)', color: '#00E5FF' }} />
                        )}
                    </Box>
                    <Chip
                        size="small"
                        label={`${detectionCount} detections`}
                        sx={{ height: 20, fontSize: 10, background: 'rgba(79,142,247,0.15)', color: '#4F8EF7' }}
                    />
                </Box>

                {/* Stream + Bounding Boxes + Heatmap Overlay */}
                <Box sx={{ position: 'relative', borderRadius: 1.5, overflow: 'hidden', background: '#0A0F1E' }}>
                    {/* Loading spinner */}
                    {!hasFrame && (
                        <Box sx={{
                            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', background: 'rgba(10,15,30,0.85)', zIndex: 4,
                        }}>
                            <CircularProgress size={24} sx={{ mb: 1 }} />
                            <Typography variant="caption" color="text.secondary">
                                Connecting to stream...
                            </Typography>
                        </Box>
                    )}

                    {/* Layer 1: Live camera feed */}
                    <canvas
                        ref={feedCanvasRef}
                        style={{
                            width: '100%',
                            aspectRatio: '16/9',
                            display: 'block',
                            objectFit: 'cover',
                        }}
                    />

                    {/* Layer 2: Bounding boxes */}
                    <canvas
                        ref={bboxCanvasRef}
                        width={640}
                        height={360}
                        style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            pointerEvents: 'none',
                            zIndex: 1,
                        }}
                    />

                    {/* Layer 3: Heatmap overlay */}
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
                            opacity: 0.5,
                            zIndex: 2,
                        }}
                    />

                    {/* LIVE badge */}
                    {connected && hasFrame && (
                        <Box sx={{
                            position: 'absolute', top: 8, left: 8, zIndex: 3,
                            background: 'rgba(0,0,0,0.6)', borderRadius: 1,
                            px: 1, py: 0.25, display: 'flex', alignItems: 'center', gap: 0.5,
                        }}>
                            <FiberManualRecord sx={{ fontSize: 8, color: '#FF5252', animation: 'pulse 1.5s infinite' }} />
                            <Typography variant="caption" sx={{ fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>LIVE</Typography>
                        </Box>
                    )}

                    {/* AI badge */}
                    {detConnected && hasFrame && (
                        <Box sx={{
                            position: 'absolute', top: 8, right: 8, zIndex: 3,
                            background: 'rgba(0,229,255,0.15)', borderRadius: 1, border: '1px solid rgba(0,229,255,0.25)',
                            px: 1, py: 0.25, display: 'flex', alignItems: 'center', gap: 0.5,
                        }}>
                            <Box sx={{
                                width: 6, height: 6, borderRadius: '50%',
                                background: '#00E5FF', animation: 'pulse 1.5s infinite',
                            }} />
                            <Typography variant="caption" sx={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: '#00E5FF' }}>
                                AI DETECT
                            </Typography>
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
                    <Typography variant="body2" color="text.secondary">Live camera feed with real-time detection overlay &amp; activity heatmap</Typography>
                </Box>
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
                            <CameraHeatmapCard camera={cam} />
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
