import React, { useEffect, useState } from 'react';
import {
    Box,
    Typography,
    Card,
    CardContent,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    IconButton,
    Avatar,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    MenuItem,
    Skeleton,
    Alert,
} from '@mui/material';
import {
    PersonAdd,
    Delete,
    Edit,
    AdminPanelSettings,
    Person,
} from '@mui/icons-material';
import { authApi } from '../services/api';

const Users: React.FC = () => {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editUser, setEditUser] = useState<any>(null);
    const [form, setForm] = useState({ username: '', email: '', password: '', role: 'viewer' });

    const currentUser = JSON.parse(localStorage.getItem('visionpro_user') || '{}');
    const isAdmin = currentUser.role === 'admin';

    const fetchUsers = async () => {
        try {
            const res = await authApi.listUsers();
            setUsers(res.data);
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Failed to load users');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const handleCreate = async () => {
        try {
            await authApi.signup(form);
            setDialogOpen(false);
            setForm({ username: '', email: '', password: '', role: 'viewer' });
            fetchUsers();
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Failed to create user');
        }
    };

    const handleUpdate = async () => {
        if (!editUser) return;
        try {
            await authApi.updateUser(editUser._id || editUser.id, {
                role: form.role,
                ...(form.email && { email: form.email }),
            });
            setEditUser(null);
            fetchUsers();
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Failed to update user');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this user?')) return;
        try {
            await authApi.deleteUser(id);
            fetchUsers();
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Failed to delete user');
        }
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h4" sx={{ mb: 0.5 }}>User Management</Typography>
                    <Typography variant="body2">Manage system users and permissions</Typography>
                </Box>
                {isAdmin && (
                    <Button startIcon={<PersonAdd />} variant="contained" size="small"
                        onClick={() => { setForm({ username: '', email: '', password: '', role: 'viewer' }); setDialogOpen(true); }}>
                        Add User
                    </Button>
                )}
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>{error}</Alert>}

            {!isAdmin ? (
                <Card><CardContent sx={{ p: 4, textAlign: 'center' }}>
                    <AdminPanelSettings sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">Admin access required</Typography>
                    <Typography variant="body2" color="text.secondary">Only administrators can manage users</Typography>
                </CardContent></Card>
            ) : (
                <Card>
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>User</TableCell>
                                    <TableCell>Email</TableCell>
                                    <TableCell>Role</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {loading ? Array(3).fill(null).map((_, i) => (
                                    <TableRow key={i}>
                                        {Array(5).fill(null).map((__, j) => (
                                            <TableCell key={j}><Skeleton /></TableCell>
                                        ))}
                                    </TableRow>
                                )) : users.map((user) => (
                                    <TableRow key={user._id || user.id} sx={{ '&:hover': { bgcolor: 'rgba(79,142,247,0.04)' } }}>
                                        <TableCell>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                                <Avatar sx={{ width: 32, height: 32, background: 'linear-gradient(135deg, #4F8EF7, #7C4DFF)', fontSize: '0.85rem' }}>
                                                    {(user.username || '?')[0].toUpperCase()}
                                                </Avatar>
                                                <Typography variant="body2" sx={{ fontWeight: 600 }}>{user.username}</Typography>
                                            </Box>
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2" color="text.secondary">{user.email || '—'}</Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                icon={user.role === 'admin' ? <AdminPanelSettings sx={{ fontSize: 14 }} /> : <Person sx={{ fontSize: 14 }} />}
                                                label={user.role}
                                                size="small"
                                                sx={{
                                                    background: user.role === 'admin' ? 'rgba(124,77,255,0.15)' : 'rgba(79,142,247,0.15)',
                                                    color: user.role === 'admin' ? '#7C4DFF' : '#4F8EF7',
                                                    textTransform: 'capitalize',
                                                }}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Chip label={user.is_active !== false ? 'Active' : 'Inactive'} size="small"
                                                sx={{
                                                    background: user.is_active !== false ? 'rgba(0,230,118,0.12)' : 'rgba(255,82,82,0.12)',
                                                    color: user.is_active !== false ? '#00E676' : '#FF5252',
                                                }} />
                                        </TableCell>
                                        <TableCell align="right">
                                            <IconButton size="small" onClick={() => {
                                                setEditUser(user);
                                                setForm({ ...form, role: user.role, email: user.email || '' });
                                            }}>
                                                <Edit fontSize="small" />
                                            </IconButton>
                                            <IconButton size="small" color="error"
                                                disabled={user.username === currentUser.username}
                                                onClick={() => handleDelete(user._id || user.id)}>
                                                <Delete fontSize="small" />
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Card>
            )}

            {/* Create User Dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth
                PaperProps={{ sx: { background: '#111827', borderRadius: 3 } }}>
                <DialogTitle>Add New User</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
                    <TextField label="Username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} fullWidth size="small" />
                    <TextField label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} fullWidth size="small" />
                    <TextField label="Password" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} fullWidth size="small" />
                    <TextField label="Role" select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} fullWidth size="small">
                        <MenuItem value="admin">Admin</MenuItem>
                        <MenuItem value="viewer">Viewer</MenuItem>
                    </TextField>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleCreate}>Create</Button>
                </DialogActions>
            </Dialog>

            {/* Edit User Dialog */}
            <Dialog open={!!editUser} onClose={() => setEditUser(null)} maxWidth="xs" fullWidth
                PaperProps={{ sx: { background: '#111827', borderRadius: 3 } }}>
                <DialogTitle>Edit User – {editUser?.username}</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
                    <TextField label="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} fullWidth size="small" />
                    <TextField label="Role" select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} fullWidth size="small">
                        <MenuItem value="admin">Admin</MenuItem>
                        <MenuItem value="viewer">Viewer</MenuItem>
                    </TextField>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={() => setEditUser(null)}>Cancel</Button>
                    <Button variant="contained" onClick={handleUpdate}>Save</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default Users;
