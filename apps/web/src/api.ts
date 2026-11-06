import axios from 'axios';
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api' });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('gloomi.access');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(r => r, async error => {
  const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
  if (error.response?.status === 401 && original && !original._retried && !String(original.url).startsWith('/auth/')) {
    const refreshToken = localStorage.getItem('gloomi.refresh');
    if (refreshToken) {
      original._retried = true;
      try {
        const { data } = await axios.post(`${api.defaults.baseURL}/auth/refresh`, { refreshToken });
        localStorage.setItem('gloomi.access', data.accessToken);
        localStorage.setItem('gloomi.refresh', data.refreshToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch { localStorage.removeItem('gloomi.access'); localStorage.removeItem('gloomi.refresh'); }
    }
  }
  return Promise.reject(new Error(error.response?.data?.message || 'Не удалось выполнить запрос. Проверьте соединение с сервером.'));
});
