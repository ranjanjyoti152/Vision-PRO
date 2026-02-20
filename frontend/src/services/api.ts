import axios from 'axios';

const api = axios.create({
    baseURL: '/api',
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor – attach JWT token
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('visionpro_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Response interceptor – handle 401
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('visionpro_token');
            localStorage.removeItem('visionpro_user');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

export default api;

// --- Auth API ---
export const authApi = {
    login: (username: string, password: string) =>
        api.post('/auth/login', { username, password }),
    signup: (data: { username: string; email: string; password: string }) =>
        api.post('/auth/signup', data),
    getMe: () => api.get('/auth/me'),
    listUsers: () => api.get('/auth/users'),
    updateUser: (id: string, data: any) => api.put(`/auth/users/${id}`, data),
    deleteUser: (id: string) => api.delete(`/auth/users/${id}`),
};

// --- Cameras API ---
export const camerasApi = {
    list: () => api.get('/cameras'),
    get: (id: string) => api.get(`/cameras/${id}`),
    create: (data: any) => api.post('/cameras', data),
    update: (id: string, data: any) => api.put(`/cameras/${id}`, data),
    delete: (id: string) => api.delete(`/cameras/${id}`),
    // Stream control
    startStream: (id: string) => api.post(`/cameras/${id}/start`),
    stopStream: (id: string) => api.post(`/cameras/${id}/stop`),
    snapshotUrl: (id: string) => `/api/cameras/${id}/snapshot`,
    streamStatus: (id: string) => api.get(`/cameras/${id}/stream-status`),
    allStreamStatuses: () => api.get('/cameras/streams/all-status'),
};

// --- Events API ---
export const eventsApi = {
    list: (params?: any) => api.get('/events', { params }),
    get: (id: string) => api.get(`/events/${id}`),
    count: (params?: any) => api.get('/events/count', { params }),
    delete: (id: string) => api.delete(`/events/${id}`),
};

// --- Faces API ---
export const facesApi = {
    list: () => api.get('/faces'),
    listUnknown: () => api.get('/faces/unknown'),
    create: (data: any) => api.post('/faces', data),
    update: (id: string, data: any) => api.put(`/faces/${id}`, data),
    uploadReference: (id: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post(`/faces/${id}/reference`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    delete: (id: string) => api.delete(`/faces/${id}`),
};

// --- Recordings API ---
export const recordingsApi = {
    list: (params?: any) => api.get('/recordings', { params }),
    calendar: (cameraId: string, year: number, month: number) =>
        api.get(`/recordings/calendar/${cameraId}`, { params: { year, month } }),
    export: (data: any) => api.post('/recordings/export', data),
};

// --- Settings API ---
export const settingsApi = {
    getStorage: () => api.get('/settings/storage'),
    updateStorage: (data: any) => api.put('/settings/storage', data),
    getNotifications: () => api.get('/settings/notifications'),
    updateNotifications: (data: any) => api.put('/settings/notifications', data),
    testNotification: (provider: string) =>
        api.post('/settings/notifications/test', { provider }),
    getLLM: () => api.get('/settings/llm'),
    updateLLM: (data: any) => api.put('/settings/llm', data),
};

// --- AI Models API ---
export const modelsApi = {
    list: () => api.get('/models'),
    available: () => api.get('/models/available'),
    download: (modelName: string) => api.post('/models/download', { model_name: modelName }),
    setDefault: (id: string) => api.put(`/models/${id}/default`),
    delete: (id: string) => api.delete(`/models/${id}`),
};

// --- System API ---
export const systemApi = {
    getStats: () => api.get('/system/stats'),
    getInfo: () => api.get('/system/info'),
};

// --- Analytics API ---
export const analyticsApi = {
    overview: (days?: number) => api.get('/analytics/overview', { params: { days } }),
    trends: (days?: number, cameraId?: string) => api.get('/analytics/trends', { params: { days, camera_id: cameraId } }),
    daily: (days?: number, cameraId?: string) => api.get('/analytics/daily', { params: { days, camera_id: cameraId } }),
    cameras: (days?: number) => api.get('/analytics/cameras', { params: { days } }),
    topHours: (days?: number) => api.get('/analytics/top-hours', { params: { days } }),
};

// --- AI Assistant API ---
export const assistantApi = {
    chat: (message: string) => api.post('/assistant/chat', { message }),
    history: (params?: any) => api.get('/assistant/history', { params }),
};

// --- Heatmaps API ---
export const heatmapApi = {
    getHeatmap: (cameraId: string, hours?: number, gridW?: number, gridH?: number) =>
        api.get(`/heatmaps/${cameraId}`, { params: { hours, grid_w: gridW, grid_h: gridH } }),
    summary: (hours?: number) => api.get('/heatmaps/', { params: { hours } }),
};

// Legacy alias
export const heatmapsApi = heatmapApi;
