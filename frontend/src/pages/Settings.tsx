import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';
import { Settings as SettingsIcon } from '@mui/icons-material';

const Settings: React.FC = () => (
    <Box>
        <Typography variant="h4" sx={{ mb: 0.5 }}>Settings</Typography>
        <Typography variant="body2" sx={{ mb: 3 }}>Configure storage, notifications, and AI providers</Typography>
        <Card><CardContent sx={{ p: 4, textAlign: 'center' }}>
            <SettingsIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary">Settings panels coming in next phase</Typography>
            <Typography variant="body2" color="text.secondary">Storage, Notification (Telegram/WhatsApp/Email), and LLM provider configuration</Typography>
        </CardContent></Card>
    </Box>
);
export default Settings;
