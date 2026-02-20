import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';
import { Whatshot } from '@mui/icons-material';

const Heatmaps: React.FC = () => (
    <Box>
        <Typography variant="h4" sx={{ mb: 0.5 }}>Heatmaps</Typography>
        <Typography variant="body2" sx={{ mb: 3 }}>Activity heatmaps showing movement intensity per camera</Typography>
        <Card><CardContent sx={{ p: 4, textAlign: 'center' }}>
            <Whatshot sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary">Heatmap visualization coming soon</Typography>
            <Typography variant="body2" color="text.secondary">GPU-processed activity heatmaps will be generated from detection data</Typography>
        </CardContent></Card>
    </Box>
);
export default Heatmaps;
