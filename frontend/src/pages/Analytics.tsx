import React, { useEffect, useState } from 'react';
import {
    Box, Typography, Grid, Card, CardContent, MenuItem, Select, FormControl, InputLabel, Chip, Skeleton
} from '@mui/material';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
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

            // Shape daily data for Recharts
            const dailyMap = dly.data.daily_trends || {};
            const dailySeries = Object.entries(dailyMap).map(([date, types]: [string, any]) => ({
                date: date.slice(5), // strip year
                ...types,
            })).sort((a, b) => a.date.localeCompare(b.date));
            setDaily(dailySeries);

            // Shape hourly data
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
        { label: 'Total Events', value: overview?.total_events || 0, icon: <Assessment sx={{ color: '#4F8EF7' }} />, color: 'rgba(79,142,247,0.1)' },
        { label: 'Active Cameras', value: cameras.length, icon: <CameraAlt sx={{ color: '#00BCD4' }} />, color: 'rgba(0,188,212,0.1)' },
        { label: 'Unique Types', value: Object.keys(overview?.by_type || {}).length, icon: <TrendingUp sx={{ color: '#4CAF50' }} />, color: 'rgba(76,175,80,0.1)' },
        { label: 'Period', value: `${days} days`, icon: <Schedule sx={{ color: '#FF9800' }} />, color: 'rgba(255,152,0,0.1)' },
    ];

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
                <Box>
                    <Typography variant="h4" sx={{ mb: 0.5 }}>AI Analytics</Typography>
                    <Typography variant="body2" color="text.secondary">Detection trends and behavioral intelligence</Typography>
                </Box>
                <FormControl size="small" sx={{ minWidth: 130 }}>
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
                    <Grid item xs={6} sm={3} key={i}>
                        <Card>
                            <CardContent sx={{ p: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                    <Box sx={{ width: 40, height: 40, borderRadius: 2, background: card.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {card.icon}
                                    </Box>
                                    <Box>
                                        <Typography variant="caption" color="text.secondary">{card.label}</Typography>
                                        <Typography variant="h6" sx={{ fontWeight: 700 }}>{loading ? <Skeleton width={40} /> : card.value}</Typography>
                                    </Box>
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>

            <Grid container spacing={2}>
                {/* Daily Detection Trends */}
                <Grid item xs={12} lg={8}>
                    <Card>
                        <CardContent>
                            <Typography variant="h6" sx={{ mb: 2 }}>Daily Detection Trend</Typography>
                            {loading ? <Skeleton height={240} /> : (
                                <ResponsiveContainer width="100%" height={240}>
                                    <BarChart data={daily} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94A3B8' }} />
                                        <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} allowDecimals={false} />
                                        <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid rgba(148,163,184,0.1)', borderRadius: 8 }} />
                                        <Legend />
                                        {allEventTypes.map(type => (
                                            <Bar key={type} dataKey={type} stackId="a" fill={EVENT_COLORS[type] || '#78909C'} radius={type === allEventTypes[allEventTypes.length - 1] ? [3, 3, 0, 0] : undefined} />
                                        ))}
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>
                </Grid>

                {/* Event Type Pie Chart */}
                <Grid item xs={12} sm={6} lg={4}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent>
                            <Typography variant="h6" sx={{ mb: 2 }}>Event Distribution</Typography>
                            {loading ? <Skeleton height={200} /> : pieData.length > 0 ? (
                                <ResponsiveContainer width="100%" height={200}>
                                    <PieChart>
                                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                                            {pieData.map((_, idx) => (
                                                <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid rgba(148,163,184,0.1)', borderRadius: 8 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                                    <Typography color="text.secondary" variant="body2">No data yet</Typography>
                                </Box>
                            )}
                        </CardContent>
                    </Card>
                </Grid>

                {/* Hourly Activity Line Chart */}
                <Grid item xs={12} lg={8}>
                    <Card>
                        <CardContent>
                            <Typography variant="h6" sx={{ mb: 2 }}>Hourly Activity Pattern</Typography>
                            {loading ? <Skeleton height={200} /> : (
                                <ResponsiveContainer width="100%" height={200}>
                                    <LineChart data={hourly} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                        <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#94A3B8' }} interval={3} />
                                        <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} allowDecimals={false} />
                                        <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid rgba(148,163,184,0.1)', borderRadius: 8 }} />
                                        <Legend />
                                        {allEventTypes.map(type => (
                                            <Line key={type} type="monotone" dataKey={type} stroke={EVENT_COLORS[type] || '#78909C'} dot={false} strokeWidth={2} />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>
                </Grid>

                {/* Top Active Hours */}
                <Grid item xs={12} sm={6} lg={4}>
                    <Card>
                        <CardContent>
                            <Typography variant="h6" sx={{ mb: 2 }}>Top Active Hours</Typography>
                            {loading ? <Skeleton height={200} /> : topHours.length > 0 ? (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                                    {topHours.map((h, i) => {
                                        const maxCount = topHours[0]?.count || 1;
                                        const pct = Math.round((h.count / maxCount) * 100);
                                        const hour = h.hour;
                                        const label = `${hour.toString().padStart(2, '0')}:00 – ${(hour + 1).toString().padStart(2, '0')}:00`;
                                        return (
                                            <Box key={i}>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                                                    <Chip size="small" label={h.count} sx={{ height: 18, fontSize: 10 }} />
                                                </Box>
                                                <Box sx={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                                    <Box sx={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #4F8EF7, #7C4DFF)' }} />
                                                </Box>
                                            </Box>
                                        );
                                    })}
                                </Box>
                            ) : (
                                <Typography color="text.secondary" variant="body2" sx={{ mt: 4, textAlign: 'center' }}>No data yet</Typography>
                            )}
                        </CardContent>
                    </Card>
                </Grid>

                {/* Per-Camera Rankings */}
                {cameras.length > 0 && (
                    <Grid item xs={12}>
                        <Card>
                            <CardContent>
                                <Typography variant="h6" sx={{ mb: 2 }}>Camera Activity Rankings</Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    {cameras.map((cam, i) => {
                                        const maxCount = cameras[0]?.event_count || 1;
                                        const pct = Math.round((cam.event_count / maxCount) * 100);
                                        return (
                                            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 24 }}>#{i + 1}</Typography>
                                                <Typography variant="body2" sx={{ minWidth: 160, fontWeight: 500 }}>{cam.camera_name}</Typography>
                                                <Box sx={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                                                    <Box sx={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, #4F8EF7, #00BCD4)' }} />
                                                </Box>
                                                <Chip size="small" label={cam.event_count} sx={{ height: 20, fontSize: 10, minWidth: 42 }} />
                                            </Box>
                                        );
                                    })}
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                )}
            </Grid>
        </Box>
    );
};

export default Analytics;
