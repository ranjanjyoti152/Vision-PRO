import React, { useEffect, useState } from 'react';
import { Box, Typography, Grid, Card, CardContent } from '@mui/material';
import { Analytics as AnalyticsIcon, TrendingUp } from '@mui/icons-material';
import { analyticsApi } from '../services/api';

const Analytics: React.FC = () => {
    const [overview, setOverview] = useState<any>(null);

    useEffect(() => {
        analyticsApi.overview(7).then(res => setOverview(res.data)).catch(() => { });
    }, []);

    return (
        <Box>
            <Typography variant="h4" sx={{ mb: 0.5 }}>AI Analytics</Typography>
            <Typography variant="body2" sx={{ mb: 3 }}>Detection trends and behavioral analysis</Typography>

            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={12} sm={6} md={4}>
                    <Card>
                        <CardContent sx={{ p: 2.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Box sx={{ width: 44, height: 44, borderRadius: 2, background: 'rgba(79,142,247,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <TrendingUp sx={{ color: '#4F8EF7' }} />
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary">Total Events (7 days)</Typography>
                                    <Typography variant="h5" sx={{ fontWeight: 700 }}>{overview?.total_events || 0}</Typography>
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {overview?.by_type && Object.keys(overview.by_type).length > 0 ? (
                <Card>
                    <CardContent>
                        <Typography variant="h6" sx={{ mb: 2 }}>Events by Type</Typography>
                        <Grid container spacing={2}>
                            {Object.entries(overview.by_type).map(([type, data]: [string, any]) => (
                                <Grid item xs={6} sm={4} md={3} key={type}>
                                    <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255,255,255,0.03)', textAlign: 'center' }}>
                                        <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main' }}>{data.count}</Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{type}</Typography>
                                        <Typography variant="caption" color="text.secondary">Avg conf: {(data.avg_confidence * 100).toFixed(0)}%</Typography>
                                    </Box>
                                </Grid>
                            ))}
                        </Grid>
                    </CardContent>
                </Card>
            ) : (
                <Card><CardContent sx={{ p: 4, textAlign: 'center' }}>
                    <AnalyticsIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">No analytics data yet</Typography>
                    <Typography variant="body2" color="text.secondary">Analytics will populate once the detection pipeline is generating events</Typography>
                </CardContent></Card>
            )}
        </Box>
    );
};
export default Analytics;
