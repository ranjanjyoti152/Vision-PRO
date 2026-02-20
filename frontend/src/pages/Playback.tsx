import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';
import { PlayCircle } from '@mui/icons-material';

const Playback: React.FC = () => (
    <Box>
        <Typography variant="h4" sx={{ mb: 0.5 }}>Playback</Typography>
        <Typography variant="body2" sx={{ mb: 3 }}>Review camera recordings with timeline navigation</Typography>
        <Card><CardContent sx={{ p: 4, textAlign: 'center' }}>
            <PlayCircle sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary">Select a camera and date to view recordings</Typography>
            <Typography variant="body2" color="text.secondary">Recordings will appear here once detection-based recording is enabled</Typography>
        </CardContent></Card>
    </Box>
);
export default Playback;
