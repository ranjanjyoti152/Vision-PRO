import React, { useEffect, useState } from 'react';
import {
    Box, Typography, Grid, Card, CardContent, LinearProgress, Skeleton,
    Table, TableBody, TableCell, TableRow, Divider,
} from '@mui/material';
import {
    Memory, Speed, Storage, Thermostat, Computer, DeveloperBoard,
    DataObject, Dns,
} from '@mui/icons-material';
import { systemApi } from '../services/api';

/* ── Circular gauge ─────────────────────────────────────────────── */

const CircularGauge: React.FC<{
    value: number; color: string; size?: number; strokeWidth?: number;
}> = ({ value, color, size = 90, strokeWidth = 7 }) => {
    const r = (size - strokeWidth) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ - (Math.min(value, 100) / 100) * circ;
    return (
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={color} strokeWidth={strokeWidth}
                strokeDasharray={circ} strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        </svg>
    );
};

/* ── Gauge card ──────────────────────────────────────────────────── */

const GaugeCard: React.FC<{
    title: string; value: number; icon: React.ReactNode;
    color: string; detail?: string; loading?: boolean;
}> = ({ title, value, icon, color, detail, loading }) => (
    <Card sx={{ height: '100%' }}>
        <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 2 }}>
                <Box sx={{
                    width: 32, height: 32, borderRadius: 1.5, background: `${color}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color, flexShrink: 0,
                }}>
                    {icon}
                </Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', fontSize: '0.7rem', color: 'text.secondary' }}>
                    {title}
                </Typography>
            </Box>
            {loading ? (
                <Skeleton variant="circular" width={90} height={90} sx={{ mx: 'auto', mb: 1.5 }} />
            ) : (
                <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center', mb: 1.5 }}>
                    <CircularGauge value={value} color={color} />
                    <Box sx={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1 }}>
                            {value.toFixed(1)}
                        </Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary' }}>%</Typography>
                    </Box>
                </Box>
            )}
            {detail && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', fontSize: '0.7rem' }}>
                    {detail}
                </Typography>
            )}
        </CardContent>
    </Card>
);

/* ── Main component ──────────────────────────────────────────────── */

const SystemMonitor: React.FC = () => {
    const [stats, setStats] = useState<any>(null);
    const [info, setInfo] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [statsRes, infoRes] = await Promise.all([
                    systemApi.getStats(), systemApi.getInfo(),
                ]);
                setStats(statsRes.data);
                setInfo(infoRes.data);
            } catch (e) { console.error(e); }
            setLoading(false);
        };
        fetchData();
        const interval = setInterval(async () => {
            try {
                const res = await systemApi.getStats();
                setStats(res.data);
            } catch { /* ignore */ }
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    const gpu0 = stats?.gpu?.devices?.[0];

    const sysInfoRows: [React.ReactNode, string, string][] = info ? [
        [<Computer sx={{ fontSize: 18 }} />, 'Operating System', `${info.platform} ${info.platform_release}`],
        [<DeveloperBoard sx={{ fontSize: 18 }} />, 'Architecture', info.architecture],
        [<Speed sx={{ fontSize: 18 }} />, 'CPU Cores', `${info.cpu_count} cores`],
        [<Memory sx={{ fontSize: 18 }} />, 'Total RAM', `${info.ram_total_gb} GB`],
        [<DataObject sx={{ fontSize: 18 }} />, 'Python Version', info.python_version],
        [<Dns sx={{ fontSize: 18 }} />, 'GPU Count', `${info.gpu_count} GPU(s)`],
    ] : [];

    return (
        <Box>
            {/* Header */}
            <Box sx={{ mb: 3 }}>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>System Monitor</Typography>
                <Typography variant="body2" color="text.secondary">Real-time hardware utilization</Typography>
            </Box>

            {/* Gauge Cards */}
            <Grid container spacing={2.5} sx={{ mb: 3 }}>
                <Grid size={{ xs: 6, sm: 3 }}>
                    <GaugeCard title="CPU" value={stats?.cpu?.percent || 0}
                        icon={<Speed sx={{ fontSize: 18 }} />} color="#4F8EF7" loading={loading}
                        detail={`${stats?.cpu?.cores || 0} cores`} />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                    <GaugeCard title="RAM" value={stats?.memory?.percent || 0}
                        icon={<Memory sx={{ fontSize: 18 }} />} color="#7C4DFF" loading={loading}
                        detail={`${stats?.memory?.used_gb || 0} / ${stats?.memory?.total_gb || 0} GB`} />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                    <GaugeCard title="Disk" value={stats?.disk?.percent || 0}
                        icon={<Storage sx={{ fontSize: 18 }} />} color="#FFB74D" loading={loading}
                        detail={`${stats?.disk?.used_gb || 0} / ${stats?.disk?.total_gb || 0} GB`} />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                    <GaugeCard title="GPU" value={gpu0?.gpu_utilization || 0}
                        icon={<Thermostat sx={{ fontSize: 18 }} />} color="#00E676" loading={loading}
                        detail={gpu0?.name || 'No GPU'} />
                </Grid>
            </Grid>

            {/* Bottom Row */}
            <Grid container spacing={2.5}>
                {/* System Information */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 3 }}>
                            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>System Information</Typography>
                            {loading ? (
                                <>
                                    {[...Array(6)].map((_, i) => <Skeleton key={i} height={32} sx={{ mb: 0.5 }} />)}
                                </>
                            ) : (
                                <Table size="small" sx={{ '& .MuiTableCell-root': { borderBottom: '1px solid rgba(148,163,184,0.08)', py: 1.25, px: 1 } }}>
                                    <TableBody>
                                        {sysInfoRows.map(([icon, label, value], i) => (
                                            <TableRow key={i} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                                                <TableCell sx={{ width: 36, color: 'text.secondary' }}>
                                                    {icon}
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                                                        {label}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell align="right">
                                                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
                                                        {value}
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </Grid>

                {/* Resource Details */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 3 }}>
                            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Resource Details</Typography>
                            {loading ? (
                                <>
                                    {[...Array(3)].map((_, i) => <Skeleton key={i} height={50} sx={{ mb: 1 }} />)}
                                </>
                            ) : (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                                    {/* CPU Detail */}
                                    <Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                                            <Typography variant="body2" sx={{ fontWeight: 500 }}>CPU Usage</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#4F8EF7' }}>
                                                {(stats?.cpu?.percent || 0).toFixed(1)}%
                                            </Typography>
                                        </Box>
                                        <LinearProgress variant="determinate" value={stats?.cpu?.percent || 0}
                                            sx={{
                                                height: 10, borderRadius: 5, bgcolor: 'rgba(255,255,255,0.06)',
                                                '& .MuiLinearProgress-bar': { borderRadius: 5, background: 'linear-gradient(90deg, #4F8EF7, #7C4DFF)' },
                                            }} />
                                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', fontSize: '0.7rem' }}>
                                            {stats?.cpu?.cores || 0} cores • {stats?.cpu?.frequency_mhz ? `${(stats.cpu.frequency_mhz / 1000).toFixed(2)} GHz` : 'N/A'}
                                        </Typography>
                                    </Box>

                                    <Divider sx={{ borderColor: 'rgba(148,163,184,0.08)' }} />

                                    {/* Memory Detail */}
                                    <Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                                            <Typography variant="body2" sx={{ fontWeight: 500 }}>Memory Usage</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#7C4DFF' }}>
                                                {stats?.memory?.used_gb || 0} / {stats?.memory?.total_gb || 0} GB
                                            </Typography>
                                        </Box>
                                        <LinearProgress variant="determinate" value={stats?.memory?.percent || 0}
                                            sx={{
                                                height: 10, borderRadius: 5, bgcolor: 'rgba(255,255,255,0.06)',
                                                '& .MuiLinearProgress-bar': { borderRadius: 5, background: 'linear-gradient(90deg, #7C4DFF, #AB47BC)' },
                                            }} />
                                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', fontSize: '0.7rem' }}>
                                            {(stats?.memory?.percent || 0).toFixed(1)}% utilized
                                        </Typography>
                                    </Box>

                                    <Divider sx={{ borderColor: 'rgba(148,163,184,0.08)' }} />

                                    {/* Disk Detail */}
                                    <Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                                            <Typography variant="body2" sx={{ fontWeight: 500 }}>Disk Usage</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#FFB74D' }}>
                                                {stats?.disk?.used_gb || 0} / {stats?.disk?.total_gb || 0} GB
                                            </Typography>
                                        </Box>
                                        <LinearProgress variant="determinate" value={stats?.disk?.percent || 0}
                                            sx={{
                                                height: 10, borderRadius: 5, bgcolor: 'rgba(255,255,255,0.06)',
                                                '& .MuiLinearProgress-bar': { borderRadius: 5, background: 'linear-gradient(90deg, #FFB74D, #FF7043)' },
                                            }} />
                                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', fontSize: '0.7rem' }}>
                                            {(stats?.disk?.percent || 0).toFixed(1)}% utilized
                                        </Typography>
                                    </Box>

                                    {/* GPU Detail (if available) */}
                                    {gpu0 && (
                                        <>
                                            <Divider sx={{ borderColor: 'rgba(148,163,184,0.08)' }} />
                                            <Box>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                        GPU • {gpu0.name}
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontWeight: 600, color: '#00E676' }}>
                                                        {gpu0.gpu_utilization || 0}%
                                                    </Typography>
                                                </Box>
                                                <LinearProgress variant="determinate" value={gpu0.gpu_utilization || 0}
                                                    sx={{
                                                        height: 10, borderRadius: 5, bgcolor: 'rgba(255,255,255,0.06)',
                                                        '& .MuiLinearProgress-bar': { borderRadius: 5, background: 'linear-gradient(90deg, #00E676, #00BCD4)' },
                                                    }} />
                                                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', fontSize: '0.7rem' }}>
                                                    {gpu0.memory_used_mb || 0} / {gpu0.memory_total_mb || 0} MB VRAM
                                                    {gpu0.temperature != null && gpu0.temperature > 0 && ` • ${gpu0.temperature}°C`}
                                                </Typography>
                                            </Box>
                                        </>
                                    )}
                                </Box>
                            )}
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Box>
    );
};

export default SystemMonitor;
