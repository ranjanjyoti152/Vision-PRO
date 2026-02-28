import React, { useEffect, useState, useCallback } from 'react';
import {
    Box, Typography, Grid, Card, CardContent, CardMedia, Chip, Button,
    Skeleton, IconButton, Tooltip, Pagination, Stack, MenuItem, Select,
    FormControl, InputLabel, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import {
    Delete, AccessTime, Videocam,
    DirectionsCar, Person, Pets, CameraAlt,
} from '@mui/icons-material';
import { eventsApi } from '../services/api';

/* ── helpers ─────────────────────────────────────────────────────── */

const EVENT_COLORS: Record<string, string> = {
    person: '#4F8EF7',
    vehicle: '#FF9800',
    car: '#FF9800',
    truck: '#FF9800',
    bus: '#FF9800',
    motorcycle: '#FF9800',
    bicycle: '#66BB6A',
    animal: '#4CAF50',
    dog: '#4CAF50',
    cat: '#4CAF50',
    face_known: '#00BCD4',
    face_unknown: '#FF5252',
};

const eventColor = (type: string) => EVENT_COLORS[type?.toLowerCase()] || '#78909C';

const eventIcon = (type: string) => {
    const t = type?.toLowerCase() || '';
    if (['car', 'vehicle', 'truck', 'bus', 'motorcycle', 'bicycle'].includes(t)) return <DirectionsCar sx={{ fontSize: 16 }} />;
    if (['person'].includes(t)) return <Person sx={{ fontSize: 16 }} />;
    if (['dog', 'cat', 'animal'].includes(t)) return <Pets sx={{ fontSize: 16 }} />;
    return <CameraAlt sx={{ fontSize: 16 }} />;
};

const formatTime = (ts: string) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const PAGE_SIZE = 20;

/* ── component ───────────────────────────────────────────────────── */

const Events: React.FC = () => {
    const [events, setEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [selectedEvent, setSelectedEvent] = useState<any>(null);

    const fetchEvents = useCallback(async () => {
        setLoading(true);
        try {
            const params: any = {
                page_size: PAGE_SIZE,
                page: page,
            };
            if (typeFilter !== 'all') params.event_type = typeFilter;
            const res = await eventsApi.list(params);
            const data = Array.isArray(res.data) ? res.data : res.data.events || [];
            setEvents(data);
            // If the API returns a total, use it; otherwise estimate
            setTotal(res.data.total || data.length);
        } catch {
            setEvents([]);
        }
        setLoading(false);
    }, [page, typeFilter]);

    useEffect(() => { fetchEvents(); }, [fetchEvents]);

    const handleDelete = async (id: string) => {
        try {
            await eventsApi.delete(id);
            setEvents(prev => prev.filter(e => e.id !== id));
        } catch { /* ignore */ }
    };

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <Box>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h4" sx={{ mb: 0.5, fontWeight: 700 }}>Events</Typography>
                    <Typography variant="body2" color="text.secondary">
                        AI-detected events from all cameras
                        {total > 0 && <Chip label={`${total} total`} size="small" sx={{ ml: 1, height: 20, fontSize: 11, background: 'rgba(79,142,247,0.12)', color: '#4F8EF7' }} />}
                    </Typography>
                </Box>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Event Type</InputLabel>
                    <Select value={typeFilter} label="Event Type" onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
                        <MenuItem value="all">All Types</MenuItem>
                        <MenuItem value="person">Person</MenuItem>
                        <MenuItem value="vehicle">Vehicle</MenuItem>
                        <MenuItem value="car">Car</MenuItem>
                        <MenuItem value="truck">Truck</MenuItem>
                        <MenuItem value="animal">Animal</MenuItem>
                        <MenuItem value="face_known">Known Face</MenuItem>
                        <MenuItem value="face_unknown">Unknown Face</MenuItem>
                    </Select>
                </FormControl>
            </Box>

            {/* Grid */}
            {events.length === 0 && !loading ? (
                <Card>
                    <CardContent sx={{ p: 5, textAlign: 'center' }}>
                        <CameraAlt sx={{ fontSize: 56, color: 'text.secondary', mb: 2, opacity: 0.4 }} />
                        <Typography variant="h6" color="text.secondary">No events found</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {typeFilter !== 'all' ? 'Try a different filter' : 'Events will appear here when the detection pipeline is active'}
                        </Typography>
                    </CardContent>
                </Card>
            ) : (
                <Grid container spacing={2}>
                    {(loading ? Array(8).fill(null) : events).map((event, i) => (
                        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={event?.id || i}>
                            <Card sx={{
                                height: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                transition: 'all 0.2s ease',
                                cursor: 'pointer',
                                '&:hover': {
                                    borderColor: 'primary.main',
                                    transform: 'translateY(-2px)',
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                                },
                            }}
                                onClick={() => !loading && setSelectedEvent(event)}
                            >
                                {/* Thumbnail */}
                                {loading ? (
                                    <Skeleton variant="rectangular" height={180} sx={{ borderRadius: '12px 12px 0 0' }} />
                                ) : event?.snapshot_path ? (
                                    <CardMedia
                                        component="img"
                                        height={180}
                                        image={event.snapshot_path}
                                        alt={event.event_type}
                                        sx={{
                                            objectFit: 'cover',
                                            borderRadius: '12px 12px 0 0',
                                            background: '#0d1117',
                                        }}
                                        onError={(e: any) => {
                                            e.target.style.display = 'none';
                                        }}
                                    />
                                ) : (
                                    <Box sx={{
                                        height: 180,
                                        background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        borderRadius: '12px 12px 0 0',
                                    }}>
                                        <CameraAlt sx={{ color: 'rgba(255,255,255,0.08)', fontSize: 48 }} />
                                    </Box>
                                )}

                                {/* Details */}
                                <CardContent sx={{ p: 2, flex: 1, display: 'flex', flexDirection: 'column' }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                        <Chip
                                            icon={loading ? undefined : eventIcon(event?.event_type)}
                                            label={loading ? <Skeleton width={50} /> : event?.event_type}
                                            size="small"
                                            sx={{
                                                height: 24,
                                                fontSize: 11,
                                                fontWeight: 600,
                                                textTransform: 'capitalize',
                                                background: `${eventColor(event?.event_type)}18`,
                                                color: eventColor(event?.event_type),
                                                borderColor: `${eventColor(event?.event_type)}40`,
                                                border: '1px solid',
                                                '& .MuiChip-icon': { color: 'inherit' },
                                            }}
                                        />
                                        {!loading && (
                                            <Chip
                                                label={`${Math.round((event?.confidence || 0) * 100)}%`}
                                                size="small"
                                                sx={{
                                                    height: 22, fontSize: 11, fontWeight: 700,
                                                    background: 'rgba(79,142,247,0.12)',
                                                    color: '#4F8EF7',
                                                }}
                                            />
                                        )}
                                    </Box>

                                    {/* Camera + Time */}
                                    <Stack direction="row" spacing={1.5} sx={{ mt: 1, color: 'text.secondary' }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Videocam sx={{ fontSize: 13 }} />
                                            <Typography variant="caption" noWrap>
                                                {loading ? <Skeleton width={60} /> : (event?.camera_name || 'Camera')}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <AccessTime sx={{ fontSize: 13 }} />
                                            <Typography variant="caption">
                                                {loading ? <Skeleton width={40} /> : formatTime(event?.timestamp || event?.created_at)}
                                            </Typography>
                                        </Box>
                                    </Stack>

                                    {/* AI Summary */}
                                    {!loading && event?.ai_summary && event.ai_summary !== 'Event detected.' && (
                                        <Typography variant="body2" sx={{
                                            mt: 1, color: 'text.secondary', fontSize: '0.75rem',
                                            lineHeight: 1.4,
                                            overflow: 'hidden', textOverflow: 'ellipsis',
                                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                        }}>
                                            {event.ai_summary}
                                        </Typography>
                                    )}

                                    {/* Actions */}
                                    {!loading && (
                                        <Box sx={{ mt: 'auto', pt: 1, display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                                            <Tooltip title="Delete">
                                                <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); handleDelete(event.id); }}
                                                    sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}>
                                                    <Delete sx={{ fontSize: 16 }} />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    )}
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                    <Pagination count={totalPages} page={page} onChange={(_, p) => setPage(p)}
                        color="primary" shape="rounded" size="small" />
                </Box>
            )}

            {/* Detail Dialog */}
            <Dialog open={!!selectedEvent} onClose={() => setSelectedEvent(null)} maxWidth="md" fullWidth
                PaperProps={{ sx: { background: '#0f1419', borderRadius: 3, border: '1px solid rgba(148,163,184,0.08)' } }}>
                {selectedEvent && (
                    <>
                        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {eventIcon(selectedEvent.event_type)}
                                <Typography variant="h6" sx={{ textTransform: 'capitalize' }}>{selectedEvent.event_type}</Typography>
                                <Chip label={`${Math.round((selectedEvent.confidence || 0) * 100)}%`}
                                    size="small" sx={{ background: 'rgba(79,142,247,0.12)', color: '#4F8EF7' }} />
                            </Box>
                            <Typography variant="caption" color="text.secondary">
                                {formatTime(selectedEvent.timestamp || selectedEvent.created_at)}
                            </Typography>
                        </DialogTitle>
                        <DialogContent>
                            {selectedEvent.snapshot_path && (
                                <Box sx={{ mb: 2, borderRadius: 2, overflow: 'hidden', background: '#0d1117' }}>
                                    <img src={selectedEvent.snapshot_path} alt="Event snapshot"
                                        style={{ width: '100%', display: 'block', maxHeight: 480, objectFit: 'contain' }} />
                                </Box>
                            )}
                            <Grid container spacing={2}>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="caption" color="text.secondary">Camera</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{selectedEvent.camera_name || 'Camera'}</Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="caption" color="text.secondary">Confidence</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{Math.round((selectedEvent.confidence || 0) * 100)}%</Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="caption" color="text.secondary">Bounding Box</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {selectedEvent.bounding_box ? `${selectedEvent.bounding_box.x}, ${selectedEvent.bounding_box.y} (${selectedEvent.bounding_box.w}×${selectedEvent.bounding_box.h})` : 'N/A'}
                                    </Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="caption" color="text.secondary">Objects Detected</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {selectedEvent.detected_objects?.length || 0}
                                    </Typography>
                                </Grid>
                                {selectedEvent.ai_summary && selectedEvent.ai_summary !== 'Event detected.' && (
                                    <Grid size={{ xs: 12 }}>
                                        <Typography variant="caption" color="text.secondary">AI Summary</Typography>
                                        <Typography variant="body2" sx={{ mt: 0.5 }}>{selectedEvent.ai_summary}</Typography>
                                    </Grid>
                                )}
                            </Grid>
                        </DialogContent>
                        <DialogActions sx={{ px: 3, pb: 2 }}>
                            <Button onClick={() => setSelectedEvent(null)} variant="outlined" size="small">Close</Button>
                            <Button onClick={() => { handleDelete(selectedEvent.id); setSelectedEvent(null); }}
                                color="error" variant="outlined" size="small" startIcon={<Delete />}>Delete</Button>
                        </DialogActions>
                    </>
                )}
            </Dialog>
        </Box>
    );
};
export default Events;
