import { createTheme } from '@mui/material/styles';

const theme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#4F8EF7',
            light: '#7EB1FF',
            dark: '#2D6CE0',
        },
        secondary: {
            main: '#7C4DFF',
            light: '#B388FF',
            dark: '#651FFF',
        },
        background: {
            default: '#0A0E1A',
            paper: '#111827',
        },
        success: {
            main: '#00E676',
        },
        warning: {
            main: '#FFB74D',
        },
        error: {
            main: '#FF5252',
        },
        text: {
            primary: '#F1F5F9',
            secondary: '#94A3B8',
        },
        divider: 'rgba(148, 163, 184, 0.12)',
    },
    typography: {
        fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
        h4: {
            fontWeight: 700,
            letterSpacing: '-0.02em',
        },
        h5: {
            fontWeight: 600,
            letterSpacing: '-0.01em',
        },
        h6: {
            fontWeight: 600,
        },
        body2: {
            color: '#94A3B8',
        },
    },
    shape: {
        borderRadius: 12,
    },
    components: {
        MuiCard: {
            styleOverrides: {
                root: {
                    background: 'rgba(17, 24, 39, 0.7)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(148, 163, 184, 0.08)',
                    borderRadius: 16,
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: 10,
                    textTransform: 'none',
                    fontWeight: 600,
                    padding: '8px 20px',
                },
                containedPrimary: {
                    background: 'linear-gradient(135deg, #4F8EF7 0%, #7C4DFF 100%)',
                    '&:hover': {
                        background: 'linear-gradient(135deg, #2D6CE0 0%, #651FFF 100%)',
                    },
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                },
            },
        },
        MuiDrawer: {
            styleOverrides: {
                paper: {
                    background: 'rgba(10, 14, 26, 0.95)',
                    backdropFilter: 'blur(20px)',
                    borderRight: '1px solid rgba(148, 163, 184, 0.08)',
                },
            },
        },
        MuiAppBar: {
            styleOverrides: {
                root: {
                    background: 'rgba(10, 14, 26, 0.8)',
                    backdropFilter: 'blur(20px)',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                    boxShadow: 'none',
                },
            },
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    borderRadius: 8,
                },
            },
        },
    },
});

export default theme;
