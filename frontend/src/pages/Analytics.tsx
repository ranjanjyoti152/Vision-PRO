import React, { useEffect, useState } from 'react';
import {
    Box, Typography, Grid, Card, CardContent, MenuItem, Select, FormControl, InputLabel, Chip, Skeleton,
} from '@mui/material';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { TrendingUp, CameraAlt, Schedule, Assessment } from '@mui/icons-material';
import { analyticsApi } from '../services/api';

const EVENT_COLORS: Record<string, string> = {
    person: '#4F8EF7',
    vehicle: '#FF9800',
    animal: '#4CAF50',
    face_known: '#00BCD4',
    face_unknown: '#FF5252',
    motion: '#AB47BC',
    package: '#FFC107',
    custom: '#78909C',
};

const PIE_COLORS = Object.values(EVENT_COLORS);

const Analytics: React.FC = () => {
    const [days, setDays] = useState(7);
    const [overview, setOverview] = useState<any>(null);
    const [daily, setDaily] = useState<any[]>([]);
    const [hourly, setHourly] = useState<any[]>([]);
    const [cameras, setCameras] = useState<any[]>([]);
    const [topHours, setTopHours] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        Promise.all([
            analyticsApi.overview(days),
            analyticsApi.daily(days),
            analyticsApi.trends(days),
            analyticsApi.cameras(days),
            analyticsApi.topHours(days),
        ]).then(([ov, dly, trnd, cams, hrs]) => {
            setOverview(ov.data);

            const dailyMap = dly.data.daily_trends || {};
            const dailySeries = Object.entries(dailyMap).map(([date, types]: [string, any]) => ({
                date: date.slice(5),
                ...types,
            })).sort((a, b) => a.date.localeCompare(b.date));
            setDaily(dailySeries);

            const hourlyMap = trnd.data.hourly_trends || {};
            const hourlySeries = Array.from({ length: 24 }, (_, h) => ({
                hour: `${h.toString().padStart(2, '0')}:00`,
                ...(hourlyMap[h] || {}),
            }));
            setHourly(hourlySeries);

            setCameras(cams.data.cameras || []);
            setTopHours(hrs.data.top_hours || []);
        }).finally(() => setLoading(false));
    }, [days]);

    const pieData = overview
        ? Object.entries(overview.by_type || {}).map(([name, data]: [string, any]) => ({
            name,
            value: data.count,
        }))
        : [];

    const allEventTypes = [...new Set([
        ...daily.flatMap(d => Object.keys(d).filter(k => k !== 'date')),
    ])];

    const statCards = [
        { label: 'Total Events', value: overview?.total_events || 0, icon: <Assessment sx={{ color: '#4F8EF7' }} />, color: 'rgba(79,142,247,0.1)', border: 'rgba(79,142,247,0.2)' },
        { label: 'Active Cameras', value: cameras.length, icon: <CameraAlt sx={{ color: '#00BCD4' }} />, color: 'rgba(0,188,212,0.1)', border: 'rgba(0,188,212,0.2)' },
        { label: 'Unique Types', value: Object.keys(overview?.by_type || {}).length, icon: <TrendingUp sx={{ color: '#4CAF50' }} />, color: 'rgba(76,175,80,0.1)', border: 'rgba(76,175,80,0.2)' },
        { label: 'Period', value: `${days} days`, icon: <Schedule sx={{ color: '#FF9800' }} />, color: 'rgba(255,152,0,0.1)', border: 'rgba(255,152,0,0.2)' },
    ];

    const tooltipStyle = { background: '#1E293B', border: '1px solid rgba(148,163,184,0.15)', borderRadius: 8, fontSize: 12 };
    const axisStyle = { fontSize: 11, fill: '#94A3B8' };

    return (
        <Box>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                <Box>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>AI Analytics</Typography>
                    <Typography variant="body2" color="text.secondary">Detection trends and behavioral intelligence</Typography>
                </Box>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Time Range</InputLabel>
                    <Select value={days} label="Time Range" onChange={e => setDays(Number(e.target.value))}>
                        <MenuItem value={1}>Last 24h</MenuItem>
                        <MenuItem value={7}>Last 7 Days</MenuItem>
                        <MenuItem value={30}>Last 30 Days</MenuItem>
                        <MenuItem value={90}>Last 90 Days</MenuItem>
                    </Select>
                </FormControl>
            </Box>

            {/* Stat Cards */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
                {statCards.map((card, i) => (
                    <Grid size={{ xs: 6, sm: 3 }} key={i}>
                        <Card sx={{ border: `1px solid ${card.border}` }}>
                            <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        width: 44, height: 44, borderRadius: 2, background: card.color,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                    }}>
                                        {card.icon}
                                    </Box>
                                    <Box>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                            {card.label}
                                        </Typography>
                                        <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                                            {loading ? <Skeleton width={50} /> : card.value}
                                        </Typography>
                                    </Box>
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>

            {/* Row 1: Daily Trend + Pie */}
            <Grid container spacing={2} sx={{ mb: 2 }}>
                {/* Daily Detection Trend */}
                <Grid size={{ xs: 12, lg: 8 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 3 }}>
                            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Daily Detection Trend</Typography>
                            {loading ? <Skeleton height={300} variant="rounded" /> : (
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={daily} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                        <XAxis dataKey="date" tick={axisStyle} tickLine={false} axisLine={false} />
                                        <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                                        <Legend iconType="circle" iconSize={8}
                                            wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                                        {allEventTypes.map((type, idx) => (
                                            <Bar key={type} dataKey={type} stackId="a"
                                                fill={EVENT_COLORS[type] || '#78909C'}
                                                radius={idx === allEventTypes.length - 1 ? [4, 4, 0, 0] : undefined} />
                                        ))}
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>
                </Grid>

                {/* Event Distribution Pie */}
                <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
                            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Event Distribution</Typography>
                            {loading ? <Skeleton height={200} variant="rounded" /> : pieData.length > 0 ? (
                                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                    <ResponsiveContainer width="100%" height={200}>
                                        <PieChart>
                                            <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85}
                                                paddingAngle={3} dataKey="value">
                                                {pieData.map((_, idx) => (
                                                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip contentStyle={tooltipStyle} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    {/* Custom legend */}
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 2, justifyContent: 'center' }}>
                                        {pieData.map((entry, idx) => (
                                            <Box key={entry.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', background: PIE_COLORS[idx % PIE_COLORS.length], flexShrink: 0 }} />
                                                <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                                                    {entry.name} ({entry.value})
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </Box>
                            ) : (
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                                    <Typography color="text.secondary" variant="body2">No data yet</Typography>
                                </Box>
                            )}
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* Row 2: Hourly Activity + Top Hours */}
            <Grid container spacing={2} sx={{ mb: 2 }}>
                {/* Hourly Activity */}
                <Grid size={{ xs: 12, lg: 8 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 3 }}>
                            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Hourly Activity Pattern</Typography>
                            {loading ? <Skeleton height={300} variant="rounded" /> : (
                                <ResponsiveContainer width="100%" height={300}>
                                    <LineChart data={hourly} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                        <XAxis dataKey="hour" tick={axisStyle} tickLine={false} axisLine={false} interval={2} />
                                        <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Legend iconType="circle" iconSize={8}
                                            wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                                        {allEventTypes.map(type => (
                                            <Line key={type} type="monotone" dataKey={type}
                                                stroke={EVENT_COLORS[type] || '#78909C'} dot={false} strokeWidth={2} />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>
                </Grid>

                {/* Top Active Hours */}
                <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
                            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Top Active Hours</Typography>
                            {loading ? <Skeleton height={200} variant="rounded" /> : topHours.length > 0 ? (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, justifyContent: 'center' }}>
                                    {topHours.map((h, i) => {
                                        const maxCount = topHours[0]?.count || 1;
                                        const pct = Math.round((h.count / maxCount) * 100);
                                        const hour = h.hour;
                                        const label = `${hour.toString().padStart(2, '0')}:00 – ${(hour + 1).toString().padStart(2, '0')}:00`;
                                        return (
                                            <Box key={i}>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                                                    <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.8rem' }}>{label}</Typography>
                                                    <Chip size="small" label={h.count}
                                                        sx={{
                                                            height: 22, fontSize: 11, fontWeight: 600,
                                                            background: i === 0 ? 'rgba(79,142,247,0.15)' : 'rgba(255,255,255,0.06)',
                                                            color: i === 0 ? '#4F8EF7' : 'text.secondary',
                                                        }}
                                                    />
                                                </Box>
                                                <Box sx={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                                    <Box sx={{
                                                        width: `${pct}%`, height: '100%', borderRadius: 4,
                                                        background: i === 0
                                                            ? 'linear-gradient(90deg, #4F8EF7, #7C4DFF)'
                                                            : 'linear-gradient(90deg, rgba(79,142,247,0.5), rgba(124,77,255,0.5))',
                                                        transition: 'width 0.5s ease',
                                                    }} />
                                                </Box>
                                            </Box>
                                        );
                                    })}
                                </Box>
                            ) : (
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                                    <Typography color="text.secondary" variant="body2">No data yet</Typography>
                                </Box>
                            )}
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* Row 3: Camera Activity Rankings */}
            {cameras.length > 0 && (
                <Card>
                    <CardContent sx={{ p: 3 }}>
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2.5 }}>Camera Activity Rankings</Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {cameras.map((cam, i) => {
                                const maxCount = cameras[0]?.event_count || 1;
                                const pct = Math.round((cam.event_count / maxCount) * 100);
                                const colors = ['#4F8EF7', '#00BCD4', '#4CAF50', '#FF9800', '#AB47BC'];
                                const barColor = colors[i % colors.length];
                                return (
                                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                        <Box sx={{
                                            width: 28, height: 28, borderRadius: '50%', display: 'flex',
                                            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                            background: `${barColor}20`, border: `1px solid ${barColor}40`,
                                        }}>
                                            <Typography sx={{ fontSize: 11, fontWeight: 700, color: barColor }}>
                                                {i + 1}
                                            </Typography>
                                        </Box>
                                        <Typography variant="body2" sx={{ minWidth: 140, fontWeight: 500, flexShrink: 0 }}>
                                            {cam.camera_name}
                                        </Typography>
                                        <Box sx={{ flex: 1, height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                                            <Box sx={{
                                                width: `${pct}%`, height: '100%', borderRadius: 5,
                                                background: `linear-gradient(90deg, ${barColor}, ${barColor}80)`,
                                                transition: 'width 0.5s ease',
                                            }} />
                                        </Box>
                                        <Chip size="small" label={cam.event_count}
                                            sx={{
                                                height: 24, fontSize: 11, fontWeight: 600, minWidth: 52,
                                                background: `${barColor}15`, color: barColor,
                                            }}
                                        />
                                    </Box>
                                );
                            })}
                        </Box>
                    </CardContent>
                </Card>
            )}
        </Box>
    );
};

export default Analytics;
