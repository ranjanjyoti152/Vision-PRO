import React, { useEffect, useState } from 'react';
import { Box, Typography, Grid, Card, CardContent, Avatar, Chip, Button, Skeleton } from '@mui/material';
import { Face, PersonAdd, PersonOff } from '@mui/icons-material';
import { facesApi } from '../services/api';

const Faces: React.FC = () => {
    const [knownFaces, setKnownFaces] = useState<any[]>([]);
    const [unknownFaces, setUnknownFaces] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'known' | 'unknown'>('known');

    useEffect(() => {
        Promise.all([facesApi.list(), facesApi.listUnknown()]).then(([known, unknown]) => {
            setKnownFaces(known.data);
            setUnknownFaces(unknown.data);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    const faces = tab === 'known' ? knownFaces : unknownFaces;

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h4" sx={{ mb: 0.5 }}>Face Recognition</Typography>
                    <Typography variant="body2">Manage known faces and identify unknowns</Typography>
                </Box>
                <Button startIcon={<PersonAdd />} variant="contained" size="small">Add Face</Button>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
                <Chip label={`Known (${knownFaces.length})`} onClick={() => setTab('known')} color={tab === 'known' ? 'primary' : 'default'} variant={tab === 'known' ? 'filled' : 'outlined'} />
                <Chip label={`Unknown (${unknownFaces.length})`} onClick={() => setTab('unknown')} color={tab === 'unknown' ? 'primary' : 'default'} variant={tab === 'unknown' ? 'filled' : 'outlined'} />
            </Box>

            {faces.length === 0 && !loading ? (
                <Card><CardContent sx={{ p: 4, textAlign: 'center' }}>
                    {tab === 'known' ? <Face sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} /> : <PersonOff sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />}
                    <Typography variant="h6" color="text.secondary">{tab === 'known' ? 'No known faces registered' : 'No unknown faces detected'}</Typography>
                    <Typography variant="body2" color="text.secondary">{tab === 'known' ? 'Add face profiles with reference images to enable recognition' : 'Unknown faces will appear here when detected by the system'}</Typography>
                </CardContent></Card>
            ) : (
                <Grid container spacing={2}>
                    {faces.map((face) => (
                        <Grid item xs={6} sm={4} md={3} lg={2} key={face.id}>
                            <Card sx={{ textAlign: 'center', '&:hover': { borderColor: 'primary.main' } }}>
                                <CardContent sx={{ p: 2 }}>
                                    <Avatar sx={{ width: 64, height: 64, mx: 'auto', mb: 1.5, background: 'linear-gradient(135deg, #4F8EF7, #7C4DFF)', fontSize: '1.5rem' }}>
                                        {(face.name || '?')[0].toUpperCase()}
                                    </Avatar>
                                    <Typography variant="subtitle2" noWrap>{face.name || 'Unknown'}</Typography>
                                    <Typography variant="caption" color="text.secondary">{face.total_appearances} appearances</Typography>
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            )}
        </Box>
    );
};
export default Faces;
