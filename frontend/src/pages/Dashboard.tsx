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
    const [hasFrame, setHasFrame] = useState(false);
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
                            // Only hide the overlay once a real frame is painted
                            setHasFrame(true);
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
            setHasFrame(false);  // Reset so overlay reappears on reconnect
            // Auto-reconnect after 3s
            setTimeout(() => {
                if (wsRef.current === ws) {
                    connectWs();
                }
            }, 3000);
        };

        ws.onerror = () => {
            setConnected(false);
            setHasFrame(false);
        };

        wsRef.current = ws;
    }, [cameraId]);

    useEffect(() => {
        setHasFrame(false);  // Reset on camera change
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

            {/* No-feed placeholder — stays until first real frame is painted */}
            {!hasFrame && (
                <Box sx={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    bgcolor: 'rgba(0,0,0,0.7)',
                }}>
                    <CameraAlt sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
                    <Typography variant="body2" color="text.secondary">
                        {connected ? 'Waiting for stream…' : 'Connecting…'}
                    </Typography>
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
            value: stats ? `${stats.cpu?.percent ?? stats.cpu_percent ?? 0}%` : '—',
            icon: <People />,
            color: '#7C4DFF',
        },
        {
            label: 'GPU Memory',
            value: stats?.gpu?.devices?.length
                ? `${stats.gpu.devices[0].memory_used_mb ?? 0} MB`
                : 'N/A',
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
                            height: '100%',
                        }}>
                            <CardContent sx={{ py: 2, px: 2.5, '&:last-child': { pb: 2 }, height: '100%', boxSizing: 'border-box' }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', height: '100%' }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', fontWeight: 600, fontSize: '0.65rem', letterSpacing: '0.05em' }}>
                                            {stat.label}
                                        </Typography>
                                        <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                                            {loading ? <Skeleton width={40} /> : stat.value}
                                        </Typography>
                                        {'online' in stat && (
                                            <Typography variant="caption" sx={{ color: '#00E676', fontSize: '0.72rem', mt: 0.25 }}>
                                                {stat.online} online
                                            </Typography>
                                        )}
                                    </Box>
                                    <Box sx={{ color: stat.color, opacity: 0.7, mt: 0.25, flexShrink: 0 }}>
                                        {stat.icon}
                                    </Box>
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
                PaperProps={{
                    sx: {
                        background: 'linear-gradient(180deg, #111827 0%, #0d1117 100%)',
                        borderRadius: 3,
                        border: '1px solid rgba(79,142,247,0.15)',
                        overflow: 'hidden',
                    },
                }}>
                {/* Header with gradient accent */}
                <Box sx={{
                    p: 3, pb: 2,
                    background: 'linear-gradient(135deg, rgba(79,142,247,0.08) 0%, rgba(124,77,255,0.05) 100%)',
                    borderBottom: '1px solid rgba(148,163,184,0.08)',
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{
                            width: 44, height: 44, borderRadius: 2,
                            background: 'linear-gradient(135deg, #4F8EF7 0%, #7C4DFF 100%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 16px rgba(79,142,247,0.3)',
                        }}>
                            <CameraAlt sx={{ fontSize: 22, color: '#fff' }} />
                        </Box>
                        <Box>
                            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>Add Camera</Typography>
                            <Typography variant="caption" color="text.secondary">
                                Connect an RTSP camera stream to your NVR
                            </Typography>
                        </Box>
                    </Box>
                </Box>

                <DialogContent sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                    {addError && (
                        <Box sx={{
                            p: 1.5, borderRadius: 1.5,
                            background: 'rgba(255,82,82,0.08)',
                            border: '1px solid rgba(255,82,82,0.2)',
                            display: 'flex', alignItems: 'center', gap: 1,
                        }}>
                            <Typography variant="body2" sx={{ color: '#FF5252', fontSize: '0.8rem' }}>{addError}</Typography>
                        </Box>
                    )}

                    {/* Camera Name */}
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
                            <Box sx={{
                                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                                background: 'rgba(79,142,247,0.15)', border: '1px solid rgba(79,142,247,0.3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Typography variant="caption" sx={{ fontSize: '0.6rem', fontWeight: 800, color: '#4F8EF7' }}>1</Typography>
                            </Box>
                            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>Camera Name</Typography>
                        </Box>
                        <TextField
                            placeholder="e.g. Front Gate, Parking Lot"
                            value={newCamera.name}
                            onChange={e => setNewCamera({ ...newCamera, name: e.target.value })}
                            fullWidth size="small"
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: 2,
                                    background: 'rgba(255,255,255,0.03)',
                                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(79,142,247,0.4)' },
                                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#4F8EF7' },
                                },
                            }}
                        />
                    </Box>

                    {/* RTSP URL */}
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
                            <Box sx={{
                                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                                background: 'rgba(79,142,247,0.15)', border: '1px solid rgba(79,142,247,0.3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Typography variant="caption" sx={{ fontSize: '0.6rem', fontWeight: 800, color: '#4F8EF7' }}>2</Typography>
                            </Box>
                            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>RTSP Stream URL</Typography>
                        </Box>
                        <TextField
                            placeholder="rtsp://user:pass@192.168.1.100:554/stream"
                            value={newCamera.rtsp_url}
                            onChange={e => setNewCamera({ ...newCamera, rtsp_url: e.target.value })}
                            fullWidth size="small"
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: 2, fontFamily: 'monospace', fontSize: '0.85rem',
                                    background: 'rgba(255,255,255,0.03)',
                                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(79,142,247,0.4)' },
                                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#4F8EF7' },
                                },
                            }}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', fontSize: '0.65rem' }}>
                            Supports RTSP, HTTP, and RTMP streams. Include credentials if required.
                        </Typography>
                    </Box>

                    {/* Location */}
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
                            <Box sx={{
                                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                                background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.2)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Typography variant="caption" sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'text.secondary' }}>3</Typography>
                            </Box>
                            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
                                Location
                                <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>(optional)</Typography>
                            </Typography>
                        </Box>
                        <TextField
                            placeholder="e.g. Building A, Floor 2"
                            value={newCamera.location}
                            onChange={e => setNewCamera({ ...newCamera, location: e.target.value })}
                            fullWidth size="small"
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: 2,
                                    background: 'rgba(255,255,255,0.03)',
                                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(79,142,247,0.4)' },
                                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#4F8EF7' },
                                },
                            }}
                        />
                    </Box>
                </DialogContent>

                <DialogActions sx={{
                    p: 2.5, pt: 1,
                    borderTop: '1px solid rgba(148,163,184,0.08)',
                }}>
                    <Button onClick={() => setAddDialogOpen(false)}
                        sx={{ borderRadius: 2, textTransform: 'none', px: 2.5 }}>
                        Cancel
                    </Button>
                    <Button variant="contained" onClick={handleAddCamera}
                        disabled={!newCamera.name || !newCamera.rtsp_url}
                        startIcon={<Add />}
                        sx={{
                            borderRadius: 2, textTransform: 'none', px: 3,
                            fontWeight: 700,
                            background: 'linear-gradient(135deg, #4F8EF7 0%, #7C4DFF 100%)',
                            boxShadow: '0 4px 12px rgba(79,142,247,0.3)',
                            '&:hover': {
                                background: 'linear-gradient(135deg, #3a7be0 0%, #6a3deb 100%)',
                                boxShadow: '0 6px 20px rgba(79,142,247,0.4)',
                            },
                            '&.Mui-disabled': {
                                background: 'rgba(148,163,184,0.1)',
                                boxShadow: 'none',
                            },
                        }}>
                        Add Camera
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default Dashboard;
