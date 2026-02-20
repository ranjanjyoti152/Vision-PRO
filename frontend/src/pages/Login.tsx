import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Card,
    CardContent,
    Typography,
    TextField,
    Button,
    Alert,
    InputAdornment,
    IconButton,
    Tabs,
    Tab,
} from '@mui/material';
import {
    Videocam,
    Visibility,
    VisibilityOff,
    Person,
    Lock,
    Email,
} from '@mui/icons-material';
import { authApi } from '../services/api';

const Login: React.FC = () => {
    const navigate = useNavigate();
    const [tab, setTab] = useState(0); // 0 = login, 1 = signup
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            let response;
            if (tab === 0) {
                response = await authApi.login(username, password);
            } else {
                response = await authApi.signup({ username, email, password });
            }

            const { access_token, user } = response.data;
            localStorage.setItem('visionpro_token', access_token);
            localStorage.setItem('visionpro_user', JSON.stringify(user));
            navigate('/');
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Authentication failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'radial-gradient(ellipse at 50% 0%, rgba(79,142,247,0.15) 0%, #0A0E1A 60%)',
                p: 2,
            }}
        >
            <Card
                sx={{
                    width: '100%',
                    maxWidth: 420,
                    background: 'rgba(17, 24, 39, 0.8)',
                    backdropFilter: 'blur(40px)',
                    border: '1px solid rgba(148, 163, 184, 0.1)',
                }}
            >
                <CardContent sx={{ p: 4 }}>
                    {/* Logo */}
                    <Box sx={{ textAlign: 'center', mb: 3 }}>
                        <Box
                            sx={{
                                width: 56,
                                height: 56,
                                borderRadius: 3,
                                background: 'linear-gradient(135deg, #4F8EF7 0%, #7C4DFF 100%)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                mb: 1.5,
                            }}
                        >
                            <Videocam sx={{ color: '#fff', fontSize: 28 }} />
                        </Box>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                            Vision Pro
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                            AI-Powered NVR System
                        </Typography>
                    </Box>

                    <Tabs
                        value={tab}
                        onChange={(_, v) => { setTab(v); setError(''); }}
                        centered
                        sx={{ mb: 3, '& .MuiTab-root': { fontWeight: 600 } }}
                    >
                        <Tab label="Login" />
                        <Tab label="Sign Up" />
                    </Tabs>

                    {error && (
                        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                            {error}
                        </Alert>
                    )}

                    <form onSubmit={handleSubmit}>
                        <TextField
                            fullWidth
                            label="Username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            sx={{ mb: 2 }}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <Person sx={{ color: 'text.secondary' }} />
                                    </InputAdornment>
                                ),
                            }}
                        />

                        {tab === 1 && (
                            <TextField
                                fullWidth
                                label="Email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                sx={{ mb: 2 }}
                                InputProps={{
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <Email sx={{ color: 'text.secondary' }} />
                                        </InputAdornment>
                                    ),
                                }}
                            />
                        )}

                        <TextField
                            fullWidth
                            label="Password"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            sx={{ mb: 3 }}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <Lock sx={{ color: 'text.secondary' }} />
                                    </InputAdornment>
                                ),
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton onClick={() => setShowPassword(!showPassword)} size="small">
                                            {showPassword ? <VisibilityOff /> : <Visibility />}
                                        </IconButton>
                                    </InputAdornment>
                                ),
                            }}
                        />

                        <Button
                            type="submit"
                            fullWidth
                            variant="contained"
                            size="large"
                            disabled={loading}
                            sx={{ py: 1.5 }}
                        >
                            {loading ? 'Processing...' : tab === 0 ? 'Login' : 'Create Account'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </Box>
    );
};

export default Login;
