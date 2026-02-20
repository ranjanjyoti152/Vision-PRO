import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
    Box,
    Drawer,
    AppBar,
    Toolbar,
    Typography,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    IconButton,
    Avatar,
    Chip,
    Divider,
    Tooltip,
} from '@mui/material';
import {
    Dashboard as DashboardIcon,
    Videocam as VideocamIcon,
    PlayCircle as PlaybackIcon,
    Face as FaceIcon,
    Settings as SettingsIcon,
    Monitor as MonitorIcon,
    SmartToy as AIIcon,
    Chat as ChatIcon,
    Event as EventIcon,
    Whatshot as HeatmapIcon,
    Analytics as AnalyticsIcon,
    Menu as MenuIcon,
    Logout as LogoutIcon,
    FiberManualRecord as LiveDot,
    PeopleAlt as UsersIcon,
} from '@mui/icons-material';

const DRAWER_WIDTH = 260;

const navItems = [
    { label: 'Dashboard', icon: <DashboardIcon />, path: '/' },
    { label: 'Playback', icon: <PlaybackIcon />, path: '/playback' },
    { label: 'Events', icon: <EventIcon />, path: '/events' },
    { label: 'Faces', icon: <FaceIcon />, path: '/faces' },
    { label: 'Heatmaps', icon: <HeatmapIcon />, path: '/heatmaps' },
    { label: 'Analytics', icon: <AnalyticsIcon />, path: '/analytics' },
    { label: 'AI Assistant', icon: <ChatIcon />, path: '/assistant' },
    { label: 'AI Models', icon: <AIIcon />, path: '/models' },
    { label: 'Users', icon: <UsersIcon />, path: '/users' },
    { label: 'System Monitor', icon: <MonitorIcon />, path: '/system' },
    { label: 'Settings', icon: <SettingsIcon />, path: '/settings' },
];

const Layout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [mobileOpen, setMobileOpen] = useState(false);

    const user = JSON.parse(localStorage.getItem('visionpro_user') || '{}');

    const handleLogout = () => {
        localStorage.removeItem('visionpro_token');
        localStorage.removeItem('visionpro_user');
        navigate('/login');
    };

    const drawer = (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Logo */}
            <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box
                    sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 2,
                        background: 'linear-gradient(135deg, #4F8EF7 0%, #7C4DFF 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <VideocamIcon sx={{ color: '#fff', fontSize: 22 }} />
                </Box>
                <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                        Vision Pro
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
                        Enterprise NVR
                    </Typography>
                </Box>
            </Box>

            <Divider sx={{ mx: 2, opacity: 0.1 }} />

            {/* Navigation */}
            <List sx={{ px: 1.5, py: 1, flex: 1 }}>
                {navItems.map((item) => (
                    <ListItemButton
                        key={item.path}
                        selected={location.pathname === item.path}
                        onClick={() => {
                            navigate(item.path);
                            setMobileOpen(false);
                        }}
                        sx={{
                            borderRadius: 2,
                            mb: 0.5,
                            py: 1,
                            '&.Mui-selected': {
                                background: 'rgba(79, 142, 247, 0.12)',
                                '& .MuiListItemIcon-root': { color: 'primary.main' },
                                '& .MuiListItemText-primary': { color: 'primary.main', fontWeight: 600 },
                            },
                            '&:hover': {
                                background: 'rgba(79, 142, 247, 0.06)',
                            },
                        }}
                    >
                        <ListItemIcon sx={{ minWidth: 40, color: 'text.secondary' }}>
                            {item.icon}
                        </ListItemIcon>
                        <ListItemText
                            primary={item.label}
                            primaryTypographyProps={{ fontSize: '0.875rem' }}
                        />
                    </ListItemButton>
                ))}
            </List>

            <Divider sx={{ mx: 2, opacity: 0.1 }} />

            {/* User section */}
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Avatar
                    sx={{
                        width: 34,
                        height: 34,
                        background: 'linear-gradient(135deg, #4F8EF7, #7C4DFF)',
                        fontSize: '0.875rem',
                    }}
                >
                    {(user.username || 'A')[0].toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }} noWrap>
                        {user.username || 'Admin'}
                    </Typography>
                    <Chip
                        label={user.role || 'admin'}
                        size="small"
                        sx={{
                            height: 18,
                            fontSize: '0.65rem',
                            background: 'rgba(79, 142, 247, 0.15)',
                            color: 'primary.main',
                        }}
                    />
                </Box>
                <Tooltip title="Logout">
                    <IconButton size="small" onClick={handleLogout} sx={{ color: 'text.secondary' }}>
                        <LogoutIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>
        </Box>
    );

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh', background: '#0A0E1A' }}>
            {/* Sidebar */}
            <Drawer
                variant="permanent"
                sx={{
                    width: DRAWER_WIDTH,
                    flexShrink: 0,
                    display: { xs: 'none', md: 'block' },
                    '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
                }}
            >
                {drawer}
            </Drawer>

            {/* Mobile drawer */}
            <Drawer
                variant="temporary"
                open={mobileOpen}
                onClose={() => setMobileOpen(false)}
                sx={{
                    display: { xs: 'block', md: 'none' },
                    '& .MuiDrawer-paper': { width: DRAWER_WIDTH },
                }}
            >
                {drawer}
            </Drawer>

            {/* Main content */}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    minHeight: '100vh',
                    overflow: 'auto',
                }}
            >
                {/* Top bar */}
                <AppBar position="sticky" sx={{ ml: { md: `${DRAWER_WIDTH}px` } }}>
                    <Toolbar>
                        <IconButton
                            edge="start"
                            onClick={() => setMobileOpen(true)}
                            sx={{ mr: 2, display: { md: 'none' } }}
                        >
                            <MenuIcon />
                        </IconButton>
                        <Box sx={{ flex: 1 }} />
                        <Chip
                            icon={<LiveDot sx={{ fontSize: 10, color: '#00E676 !important' }} />}
                            label="System Online"
                            size="small"
                            sx={{
                                background: 'rgba(0, 230, 118, 0.1)',
                                color: '#00E676',
                                border: '1px solid rgba(0, 230, 118, 0.2)',
                            }}
                        />
                    </Toolbar>
                </AppBar>

                {/* Page content */}
                <Box sx={{ p: 3 }}>
                    <Outlet />
                </Box>
            </Box>
        </Box>
    );
};

export default Layout;
