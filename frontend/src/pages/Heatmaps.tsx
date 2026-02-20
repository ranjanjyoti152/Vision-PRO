import React, { useEffect, useState, useRef } from 'react';
import {
    Box, Typography, Card, CardContent, Grid, MenuItem,
    Select, FormControl, InputLabel, CircularProgress, Chip, Stack
} from '@mui/material';
import { Whatshot, CameraAlt } from '@mui/icons-material';
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

            // Map 0..1 to a hot colour: blue → cyan → green → yellow → red
            const r = Math.round(Math.min(255, intensity * 2 * 255));
            const g = Math.round(Math.min(255, (1 - Math.abs(intensity - 0.5) * 2) * 255));
            const b = Math.round(Math.max(0, (1 - intensity * 2) * 255));

            ctx.fillStyle = `rgba(${r},${g},${b},${0.3 + intensity * 0.65})`;
            ctx.fillRect(gx * cellW, gy * cellH, cellW, cellH);
        }
    }

    // Overlay a subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= gridW; x++) {
        ctx.beginPath(); ctx.moveTo(x * cellW, 0); ctx.lineTo(x * cellW, ch); ctx.stroke();
    }
    for (let y = 0; y <= gridH; y++) {
        ctx.beginPath(); ctx.moveTo(0, y * cellH); ctx.lineTo(cw, y * cellH); ctx.stroke();
    }
}

const CameraHeatmapCard: React.FC<{ camera: any; hours: number }> = ({ camera, hours }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        setLoading(true);
        heatmapsApi.getHeatmap(camera.id, hours, GRID_W, GRID_H)
            .then((res: any) => {
                const { heatmap_data, grid_width, grid_height, total_detections } = res.data;
                setTotal(total_detections);
                if (canvasRef.current) {
                    drawHeatmap(canvasRef.current, heatmap_data, grid_width, grid_height);
                }
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, [camera.id, hours]);

    return (
        <Card>
            <CardContent sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CameraAlt sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{camera.name}</Typography>
                    </Box>
                    <Chip
                        size="small"
                        label={`${total} detections`}
                        sx={{ height: 20, fontSize: 10, background: 'rgba(79,142,247,0.15)', color: '#4F8EF7' }}
                    />
                </Box>

                <Box sx={{ position: 'relative', borderRadius: 1.5, overflow: 'hidden', background: '#0A0F1E' }}>
                    {loading && (
                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,15,30,0.8)', zIndex: 1 }}>
                            <CircularProgress size={24} />
                        </Box>
                    )}
                    <canvas
                        ref={canvasRef}
                        width={640}
                        height={360}
                        style={{ width: '100%', aspectRatio: '16/9', display: 'block' }}
                    />
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
                    <Typography variant="h4" sx={{ mb: 0.5 }}>Activity Heatmaps</Typography>
                    <Typography variant="body2" color="text.secondary">Movement density visualized per camera</Typography>
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
                        <Box key={cam.id} sx={{ flex: '1 1 320px', minWidth: 280 }}>
                            <CameraHeatmapCard camera={cam} hours={hours} />
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
};

export default Heatmaps;
