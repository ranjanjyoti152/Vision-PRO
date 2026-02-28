import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
    Box, Typography, Card, CardContent, Grid, Stack, Chip, Button,
    Select, MenuItem, FormControl, InputLabel, IconButton, Tooltip,
    CircularProgress, Skeleton, Divider,
} from '@mui/material';
import {
    PlayCircle, Videocam, CalendarMonth, AccessTime, Storage,
    SkipPrevious, SkipNext, PlayArrow, Pause, VolumeUp, VolumeOff,
    Fullscreen, Speed, Download, ChevronLeft, ChevronRight,
    FiberManualRecord, VideoLibrary,
} from '@mui/icons-material';
import { camerasApi, recordingsApi, eventsApi } from '../services/api';

/* ── helpers ─────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatDuration = (s: number) => {
    if (!s) return '0s';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
};

const formatSize = (bytes: number) => {
    if (!bytes) return '—';
    if (bytes < 1e6) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e9).toFixed(2)} GB`;
};

const formatTime = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatVideoTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const API_BASE = import.meta.env.VITE_API_URL || '';

/* ── component ───────────────────────────────────────────────────── */

const Playback: React.FC = () => {
    const [cameras, setCameras] = useState<any[]>([]);
    const [selectedCamera, setSelectedCamera] = useState<string>('');
    const [loading, setLoading] = useState(true);

    // Calendar state
    const now = new Date();
    const [calYear, setCalYear] = useState(now.getFullYear());
    const [calMonth, setCalMonth] = useState(now.getMonth() + 1); // 1-indexed
    const [calendarDays, setCalendarDays] = useState<any[]>([]);
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [loadingCal, setLoadingCal] = useState(false);

    // Recordings list
    const [recordings, setRecordings] = useState<any[]>([]);
    const [loadingRecs, setLoadingRecs] = useState(false);

    // Video player
    const [activeRecording, setActiveRecording] = useState<any>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [currentTime, setCurrTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1);

    // Fetch cameras
    useEffect(() => {
        (async () => {
            try {
                const res = await camerasApi.list();
                const cams = res.data || [];
                setCameras(cams);
                if (cams.length > 0) {
                    setSelectedCamera(cams[0].id || cams[0]._id);
                }
            } catch { /* ignore */ }
            setLoading(false);
        })();
    }, []);

    // Fetch calendar when camera or month changes
    const fetchCalendar = useCallback(async () => {
        if (!selectedCamera) return;
        setLoadingCal(true);
        try {
            const res = await recordingsApi.calendar(selectedCamera, calYear, calMonth);
            setCalendarDays(res.data || []);
        } catch {
            setCalendarDays([]);
        }
        setLoadingCal(false);
    }, [selectedCamera, calYear, calMonth]);

    useEffect(() => { fetchCalendar(); }, [fetchCalendar]);

    // Fetch recordings + event clips when date is selected
    const fetchRecordings = useCallback(async () => {
        if (!selectedCamera || !selectedDate) { setRecordings([]); return; }
        setLoadingRecs(true);
        try {
            // Try dedicated recordings first
            const res = await recordingsApi.list({ camera_id: selectedCamera, date: selectedDate, page_size: 50 });
            let recs = res.data || [];

            // Also fetch event clips for this date/camera as playable items
            try {
                const dayStart = `${selectedDate}T00:00:00`;
                const dayEnd = `${selectedDate}T23:59:59`;
                const evtRes = await eventsApi.list({ camera_id: selectedCamera, start_date: dayStart, end_date: dayEnd, page_size: 50 });
                const events = evtRes.data?.events || (Array.isArray(evtRes.data) ? evtRes.data : []);
                const eventClips = events
                    .filter((e: any) => e.snapshot_path || e.video_clip_path)
                    .map((e: any) => ({
                        id: e.id,
                        type: 'event',
                        camera_id: e.camera_id,
                        camera_name: e.camera_name,
                        start_time: e.timestamp || e.created_at,
                        end_time: e.timestamp || e.created_at,
                        duration_seconds: 0,
                        file_size_bytes: 0,
                        event_type: e.event_type,
                        confidence: e.confidence,
                        ai_summary: e.ai_summary,
                        snapshot_path: e.snapshot_path,
                        video_clip_path: e.video_clip_path,
                    }));
                recs = [...recs, ...eventClips];
            } catch { /* ignore events fetch failure */ }

            setRecordings(recs);
        } catch {
            setRecordings([]);
        }
        setLoadingRecs(false);
    }, [selectedCamera, selectedDate]);

    useEffect(() => { fetchRecordings(); }, [fetchRecordings]);

    // Get stream URL for a recording or event
    const getStreamUrl = (rec: any) => {
        if (rec.type === 'event') {
            // Prefer video clip over snapshot
            if (rec.video_clip_path) {
                return `${API_BASE}${rec.video_clip_path.startsWith('/') ? '' : '/'}${rec.video_clip_path}`;
            }
            return '';
        }
        return `${API_BASE}/api/recordings/${rec.id}/stream`;
    };

    const hasVideo = (rec: any) => {
        if (rec.type === 'event') return Boolean(rec.video_clip_path);
        return true;
    };

    // Video controls
    const playRecording = (rec: any) => {
        setActiveRecording(rec);
        setPlaying(true);
        setCurrTime(0);
        setDuration(rec.duration_seconds || 0);
    };

    const togglePlay = () => {
        if (!videoRef.current) return;
        if (playing) videoRef.current.pause();
        else videoRef.current.play();
        setPlaying(!playing);
    };

    const handleTimeUpdate = () => {
        if (videoRef.current) setCurrTime(videoRef.current.currentTime);
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!videoRef.current || !duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        videoRef.current.currentTime = pct * duration;
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) setDuration(videoRef.current.duration);
    };

    const cycleSpeed = () => {
        const speeds = [0.5, 1, 1.5, 2, 4];
        const idx = speeds.indexOf(playbackRate);
        const next = speeds[(idx + 1) % speeds.length];
        setPlaybackRate(next);
        if (videoRef.current) videoRef.current.playbackRate = next;
    };

    const handlePrevNext = (dir: -1 | 1) => {
        if (!activeRecording) return;
        const idx = recordings.findIndex(r => r.id === activeRecording.id);
        const nextIdx = idx + dir;
        if (nextIdx >= 0 && nextIdx < recordings.length) playRecording(recordings[nextIdx]);
    };

    const handleFullscreen = () => {
        videoRef.current?.requestFullscreen?.();
    };

    // Calendar grid builder
    const buildCalendarGrid = () => {
        const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
        const daysInMonth = new Date(calYear, calMonth, 0).getDate();
        const calMap = new Map(calendarDays.map(d => [d.date, d]));
        const cells: { day: number; data: any }[] = [];

        for (let i = 0; i < firstDay; i++) cells.push({ day: 0, data: null });
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            cells.push({ day: d, data: calMap.get(dateStr) || null });
        }
        return cells;
    };

    const prevMonth = () => {
        if (calMonth === 1) { setCalMonth(12); setCalYear(y => y - 1); }
        else setCalMonth(m => m - 1);
    };
    const nextMonth = () => {
        if (calMonth === 12) { setCalMonth(1); setCalYear(y => y + 1); }
        else setCalMonth(m => m + 1);
    };

    const selectedCameraName = cameras.find(c => (c.id || c._id) === selectedCamera)?.name || 'Camera';

    if (loading) return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress /></Box>
    );

    return (
        <Box>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>Playback</Typography>
                    <Typography variant="body2" color="text.secondary">Review camera recordings with timeline navigation</Typography>
                </Box>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Camera</InputLabel>
                    <Select value={selectedCamera} label="Camera"
                        onChange={e => { setSelectedCamera(e.target.value); setSelectedDate(''); setActiveRecording(null); }}
                        startAdornment={<Videocam sx={{ fontSize: 18, mr: 0.5, color: 'text.secondary' }} />}>
                        {cameras.map(c => (
                            <MenuItem key={c.id || c._id} value={c.id || c._id}>{c.name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>

            <Grid container spacing={2.5}>
                {/* ── Left: Calendar + Recording List ────────── */}
                <Grid size={{ xs: 12, md: 4, lg: 3 }}>
                    {/* Calendar card */}
                    <Card sx={{ mb: 2.5 }}>
                        <CardContent sx={{ p: 2 }}>
                            {/* Month nav */}
                            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
                                <IconButton size="small" onClick={prevMonth}><ChevronLeft /></IconButton>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    {MONTHS[calMonth - 1]} {calYear}
                                </Typography>
                                <IconButton size="small" onClick={nextMonth}><ChevronRight /></IconButton>
                            </Stack>

                            {/* Day headers */}
                            <Grid container columns={7} sx={{ mb: 0.5 }}>
                                {DAY_NAMES.map(d => (
                                    <Grid size={1} key={d}>
                                        <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600 }}>
                                            {d}
                                        </Typography>
                                    </Grid>
                                ))}
                            </Grid>

                            {/* Days grid */}
                            {loadingCal ? (
                                <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>
                            ) : (
                                <Grid container columns={7}>
                                    {buildCalendarGrid().map((cell, i) => {
                                        const hasRecs = cell.data && cell.data.recording_count > 0;
                                        const dateStr = cell.day > 0
                                            ? `${calYear}-${String(calMonth).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`
                                            : '';
                                        const isSelected = dateStr === selectedDate;
                                        const isToday = dateStr === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

                                        return (
                                            <Grid size={1} key={i}>
                                                {cell.day > 0 ? (
                                                    <Box
                                                        onClick={() => setSelectedDate(dateStr)}
                                                        sx={{
                                                            width: '100%', aspectRatio: '1', display: 'flex',
                                                            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                                            borderRadius: 1.5, cursor: 'pointer',
                                                            position: 'relative',
                                                            background: isSelected ? 'rgba(79,142,247,0.2)' : 'transparent',
                                                            border: isToday ? '1px solid rgba(79,142,247,0.4)' : '1px solid transparent',
                                                            '&:hover': { background: 'rgba(79,142,247,0.1)' },
                                                            transition: 'all 0.15s',
                                                        }}
                                                    >
                                                        <Typography variant="caption" sx={{
                                                            fontWeight: isSelected || isToday ? 700 : 400,
                                                            fontSize: '0.7rem',
                                                            color: hasRecs ? 'text.primary' : 'text.secondary',
                                                        }}>
                                                            {cell.day}
                                                        </Typography>
                                                        {hasRecs && (
                                                            <FiberManualRecord sx={{
                                                                fontSize: 5, color: '#4F8EF7',
                                                                position: 'absolute', bottom: 3,
                                                            }} />
                                                        )}
                                                    </Box>
                                                ) : (
                                                    <Box sx={{ width: '100%', aspectRatio: '1' }} />
                                                )}
                                            </Grid>
                                        );
                                    })}
                                </Grid>
                            )}
                        </CardContent>
                    </Card>

                    {/* Recordings list */}
                    <Card>
                        <CardContent sx={{ p: 2 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <VideoLibrary sx={{ fontSize: 18 }} />
                                Recordings
                                {selectedDate && (
                                    <Chip label={selectedDate} size="small"
                                        sx={{ ml: 'auto', height: 20, fontSize: 10, background: 'rgba(79,142,247,0.12)', color: '#4F8EF7' }} />
                                )}
                            </Typography>

                            {!selectedDate ? (
                                <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center', fontSize: '0.8rem' }}>
                                    Select a date from the calendar
                                </Typography>
                            ) : loadingRecs ? (
                                <Stack spacing={1}>
                                    {[1, 2, 3].map(i => <Skeleton key={i} variant="rounded" height={56} />)}
                                </Stack>
                            ) : recordings.length === 0 ? (
                                <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center', fontSize: '0.8rem' }}>
                                    No recordings for this date
                                </Typography>
                            ) : (
                                <Stack spacing={0.5} sx={{ maxHeight: 400, overflowY: 'auto', pr: 0.5 }}>
                                    {recordings.map(rec => {
                                        const isActive = activeRecording?.id === rec.id;
                                        return (
                                            <Box key={rec.id}
                                                onClick={() => playRecording(rec)}
                                                sx={{
                                                    p: 1.5, borderRadius: 1.5, cursor: 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: 1.5,
                                                    background: isActive ? 'rgba(79,142,247,0.12)' : 'rgba(255,255,255,0.02)',
                                                    border: isActive ? '1px solid rgba(79,142,247,0.3)' : '1px solid transparent',
                                                    '&:hover': { background: 'rgba(79,142,247,0.08)' },
                                                    transition: 'all 0.15s',
                                                }}
                                            >
                                                <Box sx={{
                                                    width: 36, height: 36, borderRadius: 1.5, flexShrink: 0,
                                                    background: isActive ? 'rgba(79,142,247,0.2)' : 'rgba(255,255,255,0.04)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                }}>
                                                    {isActive
                                                        ? <PlayArrow sx={{ fontSize: 18, color: '#4F8EF7' }} />
                                                        : <PlayCircle sx={{ fontSize: 18, color: 'text.secondary' }} />}
                                                </Box>
                                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
                                                        {rec.type === 'event'
                                                            ? `${(rec.event_type || 'Event').charAt(0).toUpperCase() + (rec.event_type || 'event').slice(1)} — ${formatTime(rec.start_time)}`
                                                            : `${formatTime(rec.start_time)} – ${formatTime(rec.end_time)}`}
                                                    </Typography>
                                                    <Stack direction="row" spacing={1}>
                                                        {rec.type === 'event' ? (
                                                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                                                {Math.round((rec.confidence || 0) * 100)}% conf
                                                            </Typography>
                                                        ) : (<>
                                                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                                                {formatDuration(rec.duration_seconds)}
                                                            </Typography>
                                                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                                                {formatSize(rec.file_size_bytes)}
                                                            </Typography>
                                                        </>)}
                                                    </Stack>
                                                </Box>
                                            </Box>
                                        );
                                    })}
                                </Stack>
                            )}
                        </CardContent>
                    </Card>
                </Grid>

                {/* ── Right: Video Player ────────────────────── */}
                <Grid size={{ xs: 12, md: 8, lg: 9 }}>
                    <Card sx={{ overflow: 'hidden' }}>
                        {activeRecording ? (
                            <Box>
                                {/* Video or Image */}
                                <Box sx={{ position: 'relative', background: '#000', aspectRatio: '16/9' }}>
                                    {hasVideo(activeRecording) ? (
                                        <video
                                            ref={videoRef}
                                            src={getStreamUrl(activeRecording)}
                                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                            autoPlay
                                            muted={muted}
                                            onTimeUpdate={handleTimeUpdate}
                                            onLoadedMetadata={handleLoadedMetadata}
                                            onPlay={() => setPlaying(true)}
                                            onPause={() => setPlaying(false)}
                                            onEnded={() => setPlaying(false)}
                                        />
                                    ) : (
                                        <img
                                            src={`${API_BASE}${activeRecording.snapshot_path?.startsWith('/') ? '' : '/'}${activeRecording.snapshot_path}`}
                                            alt={activeRecording.event_type}
                                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                        />
                                    )}
                                    {/* Camera name overlay */}
                                    <Box sx={{
                                        position: 'absolute', top: 12, left: 12,
                                        display: 'flex', alignItems: 'center', gap: 0.5,
                                        px: 1, py: 0.3, borderRadius: 1,
                                        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                                    }}>
                                        <FiberManualRecord sx={{ fontSize: 8, color: '#FF5252' }} />
                                        <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 600 }}>
                                            {selectedCameraName}
                                        </Typography>
                                    </Box>
                                </Box>

                                {/* Timeline seek bar */}
                                <Box
                                    onClick={handleSeek}
                                    sx={{
                                        height: 6, cursor: 'pointer', background: 'rgba(255,255,255,0.08)',
                                        position: 'relative', '&:hover': { height: 10 }, transition: 'height 0.15s',
                                    }}
                                >
                                    <Box sx={{
                                        height: '100%', width: `${duration ? (currentTime / duration) * 100 : 0}%`,
                                        background: 'linear-gradient(90deg, #4F8EF7, #7C4DFF)',
                                        borderRadius: '0 2px 2px 0', transition: 'width 0.1s linear',
                                    }} />
                                </Box>

                                {/* Controls */}
                                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                                    <Stack direction="row" alignItems="center" spacing={0.5}>
                                        <Tooltip title="Previous"><span>
                                            <IconButton size="small" onClick={() => handlePrevNext(-1)}
                                                disabled={!recordings.length || recordings[0]?.id === activeRecording.id}>
                                                <SkipPrevious sx={{ fontSize: 20 }} />
                                            </IconButton>
                                        </span></Tooltip>

                                        <IconButton onClick={togglePlay} sx={{
                                            width: 40, height: 40,
                                            background: 'rgba(79,142,247,0.15)', '&:hover': { background: 'rgba(79,142,247,0.25)' },
                                        }}>
                                            {playing ? <Pause sx={{ fontSize: 22 }} /> : <PlayArrow sx={{ fontSize: 22 }} />}
                                        </IconButton>

                                        <Tooltip title="Next"><span>
                                            <IconButton size="small" onClick={() => handlePrevNext(1)}
                                                disabled={!recordings.length || recordings[recordings.length - 1]?.id === activeRecording.id}>
                                                <SkipNext sx={{ fontSize: 20 }} />
                                            </IconButton>
                                        </span></Tooltip>

                                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', minWidth: 70, mx: 1 }}>
                                            {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
                                        </Typography>

                                        <Box sx={{ flex: 1 }} />

                                        <Tooltip title={`Speed: ${playbackRate}x`}>
                                            <IconButton size="small" onClick={cycleSpeed}>
                                                <Speed sx={{ fontSize: 18 }} />
                                            </IconButton>
                                        </Tooltip>
                                        {playbackRate !== 1 && (
                                            <Chip label={`${playbackRate}x`} size="small"
                                                sx={{ height: 20, fontSize: 10, fontWeight: 700, background: 'rgba(79,142,247,0.12)', color: '#4F8EF7' }} />
                                        )}

                                        <Tooltip title={muted ? 'Unmute' : 'Mute'}>
                                            <IconButton size="small" onClick={() => setMuted(!muted)}>
                                                {muted ? <VolumeOff sx={{ fontSize: 18 }} /> : <VolumeUp sx={{ fontSize: 18 }} />}
                                            </IconButton>
                                        </Tooltip>

                                        <Tooltip title="Fullscreen">
                                            <IconButton size="small" onClick={handleFullscreen}>
                                                <Fullscreen sx={{ fontSize: 18 }} />
                                            </IconButton>
                                        </Tooltip>

                                        <Tooltip title="Download">
                                            <IconButton size="small" component="a"
                                                href={`${API_BASE}/api/recordings/${activeRecording.id}/stream`}
                                                download target="_blank">
                                                <Download sx={{ fontSize: 18 }} />
                                            </IconButton>
                                        </Tooltip>
                                    </Stack>

                                    {/* Recording info */}
                                    <Stack direction="row" spacing={2} sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid rgba(148,163,184,0.08)' }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <CalendarMonth sx={{ fontSize: 14, color: 'text.secondary' }} />
                                            <Typography variant="caption" color="text.secondary">
                                                {new Date(activeRecording.start_time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <AccessTime sx={{ fontSize: 14, color: 'text.secondary' }} />
                                            <Typography variant="caption" color="text.secondary">
                                                {formatTime(activeRecording.start_time)} – {formatTime(activeRecording.end_time)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Storage sx={{ fontSize: 14, color: 'text.secondary' }} />
                                            <Typography variant="caption" color="text.secondary">
                                                {formatSize(activeRecording.file_size_bytes)}
                                            </Typography>
                                        </Box>
                                    </Stack>
                                </CardContent>
                            </Box>
                        ) : (
                            /* Empty state */
                            <CardContent sx={{ py: 12, textAlign: 'center' }}>
                                <Box sx={{
                                    width: 72, height: 72, borderRadius: '50%', mx: 'auto', mb: 2,
                                    background: 'rgba(79,142,247,0.08)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <PlayCircle sx={{ fontSize: 36, color: 'rgba(79,142,247,0.4)' }} />
                                </Box>
                                <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 600 }}>
                                    {selectedCamera ? 'Select a recording to play' : 'Select a camera to begin'}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                    {selectedCamera
                                        ? 'Pick a date from the calendar, then choose a recording clip'
                                        : 'Use the camera dropdown above to select a camera'
                                    }
                                </Typography>
                            </CardContent>
                        )}
                    </Card>
                </Grid>
            </Grid>
        </Box>
    );
};
export default Playback;
