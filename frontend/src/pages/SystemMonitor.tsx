import React, { useEffect, useState } from 'react';
import { Box, Typography, Grid, Card, CardContent, LinearProgress, Chip } from '@mui/material';
import { Memory, Speed, Storage, Thermostat } from '@mui/icons-material';
import { systemApi } from '../services/api';

const SystemMonitor: React.FC = () => {
    const [stats, setStats] = useState<any>(null);
    const [info, setInfo] = useState<any>(null);

    useEffect(() => {
        const fetch = async () => {
            try {
                const [statsRes, infoRes] = await Promise.all([systemApi.getStats(), systemApi.getInfo()]);
                setStats(statsRes.data);
                setInfo(infoRes.data);
            } catch (e) { console.error(e); }
        };
        fetch();
        const interval = setInterval(fetch, 3000);
        return () => clearInterval(interval);
    }, []);

    const gaugeCard = (title: string, value: number, icon: any, color: string, detail?: string) => (
        <Card>
            <CardContent sx={{ p: 2.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                    <Box sx={{ width: 40, height: 40, borderRadius: 2, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>{icon}</Box>
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="caption" color="text.secondary">{title}</Typography>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>{value}%</Typography>
                    </Box>
                </Box>
                <LinearProgress variant="determinate" value={value}
                    sx={{ height: 8, borderRadius: 4, bgcolor: 'rgba(255,255,255,0.05)', '& .MuiLinearProgress-bar': { borderRadius: 4, background: `linear-gradient(90deg, ${color}, ${color}88)` } }} />
                {detail && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>{detail}</Typography>}
            </CardContent>
        </Card>
    );

    return (
        <Box>
            <Typography variant="h4" sx={{ mb: 0.5 }}>System Monitor</Typography>
            <Typography variant="body2" sx={{ mb: 3 }}>Real-time hardware utilization</Typography>
            <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={3}>{gaugeCard('CPU', stats?.cpu?.percent || 0, <Speed />, '#4F8EF7', `${stats?.cpu?.cores || 0} cores`)}</Grid>
                <Grid item xs={12} sm={6} md={3}>{gaugeCard('RAM', stats?.memory?.percent || 0, <Memory />, '#7C4DFF', `${stats?.memory?.used_gb || 0} / ${stats?.memory?.total_gb || 0} GB`)}</Grid>
                <Grid item xs={12} sm={6} md={3}>{gaugeCard('Disk', stats?.disk?.percent || 0, <Storage />, '#FFB74D', `${stats?.disk?.used_gb || 0} / ${stats?.disk?.total_gb || 0} GB`)}</Grid>
                <Grid item xs={12} sm={6} md={3}>{gaugeCard('GPU', stats?.gpu?.devices?.[0]?.gpu_utilization || 0, <Thermostat />, '#00E676', stats?.gpu?.devices?.[0]?.name || 'No GPU')}</Grid>
            </Grid>
            {info && (
                <Card sx={{ mt: 3 }}>
                    <CardContent>
                        <Typography variant="h6" sx={{ mb: 2 }}>System Information</Typography>
                        <Grid container spacing={1}>{[
                            ['OS', `${info.platform} ${info.platform_release}`],
                            ['Architecture', info.architecture],
                            ['CPU Cores', info.cpu_count],
                            ['RAM', `${info.ram_total_gb} GB`],
                            ['Python', info.python_version],
                            ['GPUs', info.gpu_count],
                        ].map(([label, value]) => (
                            <Grid item xs={6} sm={4} md={2} key={String(label)}>
                                <Typography variant="caption" color="text.secondary">{label}</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>{String(value)}</Typography>
                            </Grid>
                        ))}</Grid>
                    </CardContent>
                </Card>
            )}
        </Box>
    );
};
export default SystemMonitor;
