import React, { useEffect, useState } from 'react';
import { Box, Typography, Grid, Card, CardContent, Chip, Avatar, Button, Skeleton } from '@mui/material';
import { Event as EventIcon, FilterList } from '@mui/icons-material';
import { eventsApi } from '../services/api';

const Events: React.FC = () => {
    const [events, setEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        eventsApi.list({ page_size: 20 }).then(res => {
            setEvents(res.data);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h4" sx={{ mb: 0.5 }}>Events</Typography>
                    <Typography variant="body2">AI-detected events from all cameras</Typography>
                </Box>
                <Button startIcon={<FilterList />} variant="outlined" size="small">Filter</Button>
            </Box>

            {events.length === 0 && !loading ? (
                <Card><CardContent sx={{ p: 4, textAlign: 'center' }}>
                    <EventIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">No events recorded yet</Typography>
                    <Typography variant="body2" color="text.secondary">Events will appear here when the detection pipeline is active</Typography>
                </CardContent></Card>
            ) : (
                <Grid container spacing={2}>
                    {(loading ? Array(6).fill(null) : events).map((event, i) => (
                        <Grid item xs={12} sm={6} lg={4} key={event?.id || i}>
                            <Card sx={{ '&:hover': { borderColor: 'primary.main', transition: '0.2s' } }}>
                                <CardContent sx={{ p: 2 }}>
                                    {loading ? <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2, mb: 1.5 }} /> : (
                                        <Box sx={{ height: 120, borderRadius: 2, background: '#1a1f2e', mb: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <EventIcon sx={{ color: 'rgba(255,255,255,0.1)', fontSize: 32 }} />
                                        </Box>
                                    )}
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                        <Box>
                                            <Typography variant="subtitle2">{loading ? <Skeleton width={100} /> : event?.event_type}</Typography>
                                            <Typography variant="caption" color="text.secondary">{loading ? <Skeleton width={80} /> : event?.camera_name || 'Camera'}</Typography>
                                        </Box>
                                        {!loading && <Chip label={`${Math.round((event?.confidence || 0) * 100)}%`} size="small" sx={{ background: 'rgba(79,142,247,0.15)', color: 'primary.main' }} />}
                                    </Box>
                                    {!loading && event?.ai_summary && <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary', fontSize: '0.8rem' }}>{event.ai_summary}</Typography>}
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            )}
        </Box>
    );
};
export default Events;
