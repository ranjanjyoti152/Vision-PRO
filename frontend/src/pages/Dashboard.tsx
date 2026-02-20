import React, { useEffect, useState } from 'react';
import {
    Box,
    Grid,
    Card,
    CardContent,
    Typography,
    Chip,
    IconButton,
    Skeleton,
} from '@mui/material';
import {
    Videocam,
    Event as EventIcon,
    People,
    Storage,
    FiberManualRecord as LiveDot,
    Fullscreen,
    VolumeOff,
} from '@mui/icons-material';
import { camerasApi, eventsApi, systemApi } from '../services/api';

const Dashboard: React.FC = () => {
    const [cameras, setCameras] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [eventCount, setEventCount] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [camsRes, statsRes, evtCountRes] = await Promise.all([
                    camerasApi.list(),
                    systemApi.getStats(),
                    eventsApi.count(),
                ]);
                setCameras(camsRes.data);
                setStats(statsRes.data);
                setEventCount(evtCountRes.data.count);
            } catch (err) {
                console.error('Failed to load dashboard:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    const statCards = [
        {
            title: 'Active Cameras',
            value: cameras.filter((c) => c.enabled).length,
            total: cameras.length,
            icon: <Videocam />,
            color: '#4F8EF7',
        },
        {
            title: 'Total Events',
            value: eventCount,
            icon: <EventIcon />,
            color: '#7C4DFF',
        },
        {
            title: 'GPU Usage',
            value: stats?.gpu?.devices?.[0]?.gpu_utilization || 0,
            suffix: '%',
            icon: <Storage />,
            color: '#00E676',
        },
        {
            title: 'CPU Usage',
            value: stats?.cpu?.percent || 0,
            suffix: '%',
            icon: <People />,
            color: '#FFB74D',
        },
    ];

    return (
        <Box>
            <Typography variant="h4" sx={{ mb: 0.5 }}>
                Dashboard
            </Typography>
            <Typography variant="body2" sx={{ mb: 3 }}>
                Live camera feeds and system overview
            </Typography>

            {/* Stat Cards */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
                {statCards.map((stat) => (
                    <Grid item xs={6} md={3} key={stat.title}>
                        <Card>
                            <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <Box>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                                            {stat.title}
                                        </Typography>
                                        <Typography variant="h4" sx={{ fontWeight: 700, mt: 0.5 }}>
                                            {loading ? <Skeleton width={60} /> : `${stat.value}${stat.suffix || ''}`}
                                            {stat.total !== undefined && (
                                                <Typography
                                                    component="span"
                                                    variant="body2"
                                                    sx={{ color: 'text.secondary', ml: 0.5 }}
                                                >
                                                    /{stat.total}
                                                </Typography>
                                            )}
                                        </Typography>
                                    </Box>
                                    <Box
                                        sx={{
                                            width: 44,
                                            height: 44,
                                            borderRadius: 2,
                                            background: `${stat.color}15`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: stat.color,
                                        }}
                                    >
                                        {stat.icon}
                                    </Box>
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>

            {/* Camera Grid */}
            <Typography variant="h6" sx={{ mb: 2 }}>
                Live Camera Feeds
            </Typography>

            {cameras.length === 0 && !loading ? (
                <Card sx={{ p: 4, textAlign: 'center' }}>
                    <Videocam sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" sx={{ color: 'text.secondary' }}>
                        No cameras configured
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        Go to Settings to add your first RTSP camera
                    </Typography>
                </Card>
            ) : (
                <Grid container spacing={2}>
                    {cameras.map((camera) => (
                        <Grid item xs={12} sm={6} lg={4} xl={3} key={camera.id}>
                            <Card
                                sx={{
                                    position: 'relative',
                                    overflow: 'hidden',
                                    '&:hover .camera-overlay': { opacity: 1 },
                                }}
                            >
                                {/* Camera feed placeholder */}
                                <Box
                                    sx={{
                                        width: '100%',
                                        paddingTop: '56.25%', // 16:9
                                        background: 'linear-gradient(135deg, #1a1f2e 0%, #0d1117 100%)',
                                        position: 'relative',
                                    }}
                                >
                                    {/* Live badge */}
                                    <Chip
                                        icon={<LiveDot sx={{ fontSize: 8, color: '#ff4444 !important' }} />}
                                        label="LIVE"
                                        size="small"
                                        sx={{
                                            position: 'absolute',
                                            top: 10,
                                            left: 10,
                                            background: 'rgba(0,0,0,0.6)',
                                            color: '#ff4444',
                                            fontSize: '0.7rem',
                                            height: 24,
                                        }}
                                    />

                                    {/* Status badge */}
                                    <Chip
                                        label={camera.status}
                                        size="small"
                                        sx={{
                                            position: 'absolute',
                                            top: 10,
                                            right: 10,
                                            background:
                                                camera.status === 'online'
                                                    ? 'rgba(0,230,118,0.15)'
                                                    : 'rgba(255,82,82,0.15)',
                                            color: camera.status === 'online' ? '#00E676' : '#FF5252',
                                            fontSize: '0.7rem',
                                            height: 24,
                                        }}
                                    />

                                    {/* Camera placeholder text */}
                                    <Box
                                        sx={{
                                            position: 'absolute',
                                            top: '50%',
                                            left: '50%',
                                            transform: 'translate(-50%, -50%)',
                                            textAlign: 'center',
                                        }}
                                    >
                                        <Videocam sx={{ fontSize: 40, color: 'rgba(255,255,255,0.1)' }} />
                                    </Box>

                                    {/* Hover overlay */}
                                    <Box
                                        className="camera-overlay"
                                        sx={{
                                            position: 'absolute',
                                            bottom: 0,
                                            left: 0,
                                            right: 0,
                                            p: 1,
                                            background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                                            display: 'flex',
                                            justifyContent: 'flex-end',
                                            gap: 0.5,
                                            opacity: 0,
                                            transition: 'opacity 0.2s',
                                        }}
                                    >
                                        <IconButton size="small" sx={{ color: '#fff' }}>
                                            <VolumeOff fontSize="small" />
                                        </IconButton>
                                        <IconButton size="small" sx={{ color: '#fff' }}>
                                            <Fullscreen fontSize="small" />
                                        </IconButton>
                                    </Box>
                                </Box>

                                {/* Camera info */}
                                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                                    <Typography variant="subtitle2" noWrap>
                                        {camera.name}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                        {camera.location || 'No location set'}
                                    </Typography>
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            )}
        </Box>
    );
};

export default Dashboard;
