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

// Response interceptor – handle 401 (skip for auth endpoints so login errors display properly)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            const url = error.config?.url || '';
            if (!url.includes('/auth/login') && !url.includes('/auth/signup')) {
                localStorage.removeItem('visionpro_token');
                localStorage.removeItem('visionpro_user');
                window.location.href = '/login';
            }
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
    fetchModels: (provider: string, baseUrl?: string, apiKey?: string) =>
        api.get(`/settings/llm/models/${provider}`, { params: { base_url: baseUrl, api_key: apiKey } }),
};

// --- AI Models API ---
export const modelsApi = {
    list: () => api.get('/models'),
    available: () => api.get('/models/available'),
    getActive: () => api.get('/models/active'),
    download: (modelName: string) => api.post('/models/download', { model_name: modelName }),
    getProgress: (modelId: string) => api.get(`/models/${modelId}/progress`),
    setDefault: (id: string) => api.put(`/models/${id}/default`),
    merge: (name: string, modelIds: string[], selectedClasses: Record<string, string[]> = {}) => api.post('/models/merge', { name, model_ids: modelIds, selected_classes: selectedClasses }),
    upload: (file: File, name: string) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post(`/models/upload?name=${encodeURIComponent(name)}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    reloadDeepstream: () => api.post('/models/deepstream/reload'),
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
    chatStream: (message: string, onChunk: (data: { type: string; text: string; context?: any }) => void): { cancel: () => void } => {
        const controller = new AbortController();
        const token = localStorage.getItem('visionpro_token') || '';
        fetch('/api/assistant/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ message }),
            signal: controller.signal,
        }).then(async (resp) => {
            if (!resp.ok) { onChunk({ type: 'error', text: `HTTP ${resp.status}` }); onChunk({ type: 'done', text: '' }); return; }
            const reader = resp.body?.getReader();
            if (!reader) { onChunk({ type: 'error', text: 'No stream' }); onChunk({ type: 'done', text: '' }); return; }
            const decoder = new TextDecoder();
            let buf = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop() || '';
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try { onChunk(JSON.parse(line.slice(6))); } catch { /* skip */ }
                    }
                }
            }
            if (buf.startsWith('data: ')) {
                try { onChunk(JSON.parse(buf.slice(6))); } catch { /* skip */ }
            }
        }).catch((err) => {
            if (err.name !== 'AbortError') {
                onChunk({ type: 'error', text: err.message || 'Connection failed' });
                onChunk({ type: 'done', text: '' });
            }
        });
        return { cancel: () => controller.abort() };
    },
    history: (page?: number, pageSize?: number) => api.get('/assistant/history', { params: { page, page_size: pageSize } }),
    clearHistory: () => api.delete('/assistant/history'),
};

// --- Heatmaps API ---
export const heatmapApi = {
    getHeatmap: (cameraId: string, hours?: number, gridW?: number, gridH?: number) =>
        api.get(`/heatmaps/${cameraId}`, { params: { hours, grid_w: gridW, grid_h: gridH } }),
    summary: (hours?: number) => api.get('/heatmaps/', { params: { hours } }),
};

// Legacy alias
export const heatmapsApi = heatmapApi;

// --- ROI Zones API ---
export const roiApi = {
    list: (cameraId?: string) => api.get('/roi-zones', { params: { camera_id: cameraId } }),
    create: (data: any) => api.post('/roi-zones', data),
    update: (id: string, data: any) => api.put(`/roi-zones/${id}`, data),
    delete: (id: string) => api.delete(`/roi-zones/${id}`),
    getClasses: () => api.get('/roi-zones/classes'),
};
