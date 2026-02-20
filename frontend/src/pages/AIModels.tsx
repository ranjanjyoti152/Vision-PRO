import React, { useEffect, useState } from 'react';
import { Box, Typography, Grid, Card, CardContent, Button, Chip, IconButton, CircularProgress } from '@mui/material';
import { SmartToy, Download, Delete, Star, StarBorder, Upload } from '@mui/icons-material';
import { modelsApi } from '../services/api';

const AIModels: React.FC = () => {
    const [models, setModels] = useState<any[]>([]);
    const [available, setAvailable] = useState<any>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([modelsApi.list(), modelsApi.available()]).then(([m, a]) => {
            setModels(m.data);
            setAvailable(a.data);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h4" sx={{ mb: 0.5 }}>AI Models</Typography>
                    <Typography variant="body2">Manage YOLO detection models</Typography>
                </Box>
                <Button startIcon={<Upload />} variant="contained" size="small">Upload Custom</Button>
            </Box>

            {/* Downloaded Models */}
            <Typography variant="h6" sx={{ mb: 2 }}>Downloaded Models</Typography>
            {models.length === 0 ? (
                <Card sx={{ mb: 3 }}>
                    <CardContent sx={{ p: 3, textAlign: 'center' }}>
                        <SmartToy sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
                        <Typography color="text.secondary">No models downloaded yet</Typography>
                    </CardContent>
                </Card>
            ) : (
                <Grid container spacing={2} sx={{ mb: 4 }}>
                    {models.map(m => (
                        <Grid item xs={12} sm={6} md={4} key={m.id}>
                            <Card>
                                <CardContent sx={{ p: 2 }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                        <Box>
                                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{m.name}</Typography>
                                            <Typography variant="caption" color="text.secondary">{m.version} · {(m.file_size_bytes / 1e6).toFixed(1)} MB</Typography>
                                        </Box>
                                        <Box>
                                            <IconButton size="small" onClick={() => modelsApi.setDefault(m.id)}>{m.is_default ? <Star sx={{ color: '#FFB74D' }} /> : <StarBorder />}</IconButton>
                                            <IconButton size="small" color="error" onClick={() => modelsApi.delete(m.id)}><Delete fontSize="small" /></IconButton>
                                        </Box>
                                    </Box>
                                    {m.is_default && <Chip label="Default" size="small" sx={{ mt: 1, background: 'rgba(255,183,77,0.15)', color: '#FFB74D' }} />}
                                    {m.is_custom && <Chip label="Custom" size="small" sx={{ mt: 1, ml: 0.5, background: 'rgba(124,77,255,0.15)', color: '#7C4DFF' }} />}
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            )}

            {/* Available Models */}
            <Typography variant="h6" sx={{ mb: 2 }}>Available for Download</Typography>
            <Grid container spacing={2}>
                {Object.entries(available).map(([family, variants]: [string, any]) => (
                    <Grid item xs={12} key={family}>
                        <Card>
                            <CardContent sx={{ p: 2 }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>{family}</Typography>
                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                    {(variants as string[]).map(v => (
                                        <Button key={v} size="small" variant="outlined" startIcon={<Download />}
                                            onClick={() => modelsApi.download(v)} disabled={models.some(m => m.name === v)}>
                                            {v}
                                        </Button>
                                    ))}
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>
        </Box>
    );
};
export default AIModels;
