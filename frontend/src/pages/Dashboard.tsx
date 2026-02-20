import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    Box,
    Grid,
    Card,
    CardContent,
    Typography,
    Chip,
    IconButton,
    Skeleton,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Tooltip,
} from '@mui/material';
import {
    Videocam,
    Event as EventIcon,
    People,
    Storage,
    FiberManualRecord as LiveDot,
    Fullscreen,
    FullscreenExit,
    Add,
    PhotoCamera,
    Refresh,
    CameraAlt,
    Delete,
} from '@mui/icons-material';
import { camerasApi, eventsApi, systemApi } from '../services/api';

// ----- Live Camera Canvas Component -----
interface LiveCanvasProps {
    cameraId: string;
    cameraName: string;
    location: string;
    enabled: boolean;
}

const LiveCameraFeed: React.FC<LiveCanvasProps> = ({ cameraId, cameraName, location }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [fps, setFps] = useState(0);
    const [fullscreen, setFullscreen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const frameCountRef = useRef(0);
    const lastFpsTimeRef = useRef(Date.now());

    const connectWs = useCallback(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/cameras/ws/${cameraId}/live`;
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
            setConnected(true);
        };

        ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                const blob = new Blob([event.data], { type: 'image/jpeg' });
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    const canvas = canvasRef.current;
                    if (canvas) {
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.drawImage(img, 0, 0);
                        }
                    }
                    URL.revokeObjectURL(url);
                    // FPS counter
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
            // Auto-reconnect after 3s
            setTimeout(() => {
                if (wsRef.current === ws) {
                    connectWs();
                }
            }, 3000);
        };

        ws.onerror = () => {
            setConnected(false);
        };

        wsRef.current = ws;
    }, [cameraId]);

    useEffect(() => {
        connectWs();
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [connectWs]);

    const toggleFullscreen = () => {
        if (!containerRef.current) return;
        if (!fullscreen) {
            containerRef.current.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
        setFullscreen(!fullscreen);
    };

    return (
        <Box
            ref={containerRef}
            sx={{
                position: 'relative',
                borderRadius: 2,
                overflow: 'hidden',
                bgcolor: '#0a0a0a',
                aspectRatio: '16/9',
                '&:hover .camera-overlay': { opacity: 1 },
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                }}
            />

            {/* Top-left: LIVE badge */}
            <Box sx={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip
                    icon={<LiveDot sx={{ fontSize: 10, color: connected ? '#00E676' : '#FF5252' }} />}
                    label={connected ? 'LIVE' : 'OFFLINE'}
                    size="small"
                    sx={{
                        background: connected ? 'rgba(0,230,118,0.2)' : 'rgba(255,82,82,0.2)',
                        color: connected ? '#00E676' : '#FF5252',
                        fontWeight: 700,
                        fontSize: '0.65rem',
                        height: 22,
                        animation: connected ? 'pulse 2s infinite' : 'none',
                        '@keyframes pulse': {
                            '0%, 100%': { opacity: 1 },
                            '50%': { opacity: 0.7 },
                        },
                    }}
                />
                {connected && (
                    <Chip label={`${fps} FPS`} size="small"
                        sx={{ bgcolor: 'rgba(0,0,0,0.5)', color: '#fff', fontWeight: 600, fontSize: '0.6rem', height: 20 }} />
                )}
            </Box>

            {/* Bottom overlay: camera name */}
            <Box sx={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
                px: 1.5, py: 1,
            }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>{cameraName}</Typography>
                {location && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>{location}</Typography>
                )}
            </Box>

            {/* Hover controls */}
            <Box className="camera-overlay" sx={{
                position: 'absolute', top: 8, right: 8,
                display: 'flex', gap: 0.5, opacity: 0, transition: 'opacity 0.2s',
            }}>
                <IconButton size="small" sx={{ bgcolor: 'rgba(0,0,0,0.5)', color: '#fff' }} onClick={toggleFullscreen}>
                    {fullscreen ? <FullscreenExit fontSize="small" /> : <Fullscreen fontSize="small" />}
                </IconButton>
                <IconButton size="small" sx={{ bgcolor: 'rgba(0,0,0,0.5)', color: '#fff' }}
                    onClick={() => { window.open(camerasApi.snapshotUrl(cameraId), '_blank'); }}>
                    <PhotoCamera fontSize="small" />
                </IconButton>
            </Box>

            {/* No-feed placeholder */}
            {!connected && (
                <Box sx={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    bgcolor: 'rgba(0,0,0,0.7)',
                }}>
                    <CameraAlt sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
                    <Typography variant="body2" color="text.secondary">Connecting...</Typography>
                </Box>
            )}
        </Box>
    );
};

// ----- Dashboard Page -----
const Dashboard: React.FC = () => {
    const [cameras, setCameras] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [eventCount, setEventCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [newCamera, setNewCamera] = useState({ name: '', rtsp_url: '', location: '' });
    const [addError, setAddError] = useState('');

    const fetchData = async () => {
        try {
            const [camRes, statsRes, evtRes] = await Promise.all([
                camerasApi.list(),
                systemApi.getStats(),
                eventsApi.count(),
            ]);
            setCameras(camRes.data);
            setStats(statsRes.data);
            setEventCount(evtRes.data.count || 0);
        } catch (err) {
            console.error('Dashboard fetch error:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // refresh stats every 10s
        return () => clearInterval(interval);
    }, []);

    const handleAddCamera = async () => {
        try {
            setAddError('');
            await camerasApi.create(newCamera);
            setAddDialogOpen(false);
            setNewCamera({ name: '', rtsp_url: '', location: '' });
            fetchData();
        } catch (err: any) {
            setAddError(err.response?.data?.detail || 'Failed to add camera');
        }
    };

    const handleDeleteCamera = async (id: string, name: string) => {
        if (!confirm(`Delete camera "${name}"? This will stop its stream.`)) return;
        try {
            await camerasApi.delete(id);
            fetchData();
        } catch (err) {
            console.error('Delete camera error:', err);
        }
    };

    // Grid columns based on camera count
    const gridCols = cameras.length <= 1 ? 12 : cameras.length <= 4 ? 6 : 4;

    const statCards = [
        {
            label: 'Cameras',
            value: cameras.length,
            online: cameras.filter(c => c.enabled).length,
            icon: <Videocam />,
            color: '#4F8EF7',
        },
        {
            label: 'Events Today',
            value: eventCount,
            icon: <EventIcon />,
            color: '#FF6B6B',
        },
        {
            label: 'CPU Usage',
            value: stats ? `${stats.cpu_percent || 0}%` : '—',
            icon: <People />,
            color: '#7C4DFF',
        },
        {
            label: 'GPU Memory',
            value: stats?.gpu?.length ? `${stats.gpu[0].memory_used_mb || 0} MB` : 'N/A',
            icon: <Storage />,
            color: '#00E676',
        },
    ];

    return (
        <Box>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h4" sx={{ mb: 0.5 }}>Dashboard</Typography>
                    <Typography variant="body2">Real-time monitoring overview</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button startIcon={<Refresh />} size="small" onClick={fetchData}>Refresh</Button>
                    <Button startIcon={<Add />} variant="contained" size="small" onClick={() => setAddDialogOpen(true)}>
                        Add Camera
                    </Button>
                </Box>
            </Box>

            {/* Stat Cards */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
                {statCards.map((stat) => (
                    <Grid size={{ xs: 6, md: 3 }} key={stat.label}>
                        <Card sx={{
                            background: `linear-gradient(135deg, ${stat.color}15 0%, ${stat.color}05 100%)`,
                            border: `1px solid ${stat.color}30`,
                        }}>
                            <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Box>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', fontWeight: 600, fontSize: '0.65rem' }}>
                                            {stat.label}
                                        </Typography>
                                        <Typography variant="h5" sx={{ fontWeight: 700 }}>{loading ? <Skeleton width={40} /> : stat.value}</Typography>
                                        {'online' in stat && (
                                            <Typography variant="caption" sx={{ color: '#00E676' }}>
                                                {stat.online} online
                                            </Typography>
                                        )}
                                    </Box>
                                    <Box sx={{ color: stat.color, opacity: 0.7 }}>{stat.icon}</Box>
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>

            {/* Live Camera Grid */}
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                Live Feeds
                <Chip label={`${cameras.length} camera${cameras.length !== 1 ? 's' : ''}`} size="small"
                    sx={{ ml: 1, bgcolor: 'rgba(79,142,247,0.15)', color: '#4F8EF7', fontWeight: 600 }} />
            </Typography>

            {cameras.length === 0 ? (
                <Card sx={{ textAlign: 'center', py: 6 }}>
                    <CameraAlt sx={{ fontSize: 56, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>No cameras added yet</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                        Add your first RTSP camera to start monitoring
                    </Typography>
                    <Button variant="contained" startIcon={<Add />} onClick={() => setAddDialogOpen(true)}>
                        Add Camera
                    </Button>
                </Card>
            ) : (
                <Grid container spacing={2}>
                    {cameras.map((cam) => (
                        <Grid size={{ xs: 12, sm: gridCols, md: gridCols }} key={cam.id}>
                            <Box sx={{ position: 'relative' }}>
                                <LiveCameraFeed
                                    cameraId={cam.id}
                                    cameraName={cam.name}
                                    location={cam.location}
                                    enabled={cam.enabled}
                                />
                                <Tooltip title="Delete camera">
                                    <IconButton
                                        size="small"
                                        sx={{ position: 'absolute', bottom: 40, right: 8, bgcolor: 'rgba(0,0,0,0.5)', color: '#FF5252' }}
                                        onClick={() => handleDeleteCamera(cam.id, cam.name)}
                                    >
                                        <Delete fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        </Grid>
                    ))}
                </Grid>
            )}

            {/* Add Camera Dialog */}
            <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth
                PaperProps={{ sx: { background: '#111827', borderRadius: 3 } }}>
                <DialogTitle>Add Camera</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
                    {addError && (
                        <Typography color="error" variant="body2">{addError}</Typography>
                    )}
                    <TextField
                        label="Camera Name" placeholder="e.g. Front Gate"
                        value={newCamera.name}
                        onChange={e => setNewCamera({ ...newCamera, name: e.target.value })}
                        fullWidth size="small"
                    />
                    <TextField
                        label="RTSP URL" placeholder="rtsp://user:pass@192.168.1.100:554/stream"
                        value={newCamera.rtsp_url}
                        onChange={e => setNewCamera({ ...newCamera, rtsp_url: e.target.value })}
                        fullWidth size="small"
                    />
                    <TextField
                        label="Location (optional)" placeholder="e.g. Building A, Floor 2"
                        value={newCamera.location}
                        onChange={e => setNewCamera({ ...newCamera, location: e.target.value })}
                        fullWidth size="small"
                    />
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={() => setAddDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleAddCamera}
                        disabled={!newCamera.name || !newCamera.rtsp_url}>
                        Add Camera
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default Dashboard;
