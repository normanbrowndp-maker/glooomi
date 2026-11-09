import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

let accessToken: string | null = null;
let csrfTokenValue: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  window.dispatchEvent(new Event('gloomi:auth-changed'));
}
export function getAccessToken() { return accessToken; }
export function setCsrfToken(token: string | null) { csrfTokenValue = token; }

export async function uploadMedia(file: File, intent: 'POST' | 'STORY' | 'AVATAR', onProgress?: (percent: number) => void) {
  const { data: upload } = await api.post('/media/uploads', { contentType: file.type, sizeBytes: file.size, intent });
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields as Record<string, string>)) form.append(key, value);
  form.append('file', file);
  try {
    await axios.post(upload.uploadUrl as string, form, {
      withCredentials: false,
      onUploadProgress: event => { if (event.total) onProgress?.(Math.min(100, Math.round(event.loaded / event.total * 100))); },
    });
  } catch {
    throw new Error('Не удалось загрузить файл в хранилище. Попробуйте ещё раз.');
  }
  await api.post(`/media/uploads/${upload.mediaId}/finalize`);
  return upload.mediaId as string;
}

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
export const api = axios.create({ baseURL, withCredentials: true, withXSRFToken: true, xsrfCookieName: 'gloomi.csrf', xsrfHeaderName: 'X-CSRF-Token' });

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = axios.get(`${baseURL}/auth/csrf`, { withCredentials: true }).then(({ data }) => {
      setCsrfToken(data.csrfToken);
      return axios.post(`${baseURL}/auth/refresh`, null, { withCredentials: true, headers: { 'X-CSRF-Token': csrfTokenValue } });
    }).then(({ data }) => {
      setCsrfToken(data.csrfToken);
      setAccessToken(data.accessToken);
      return data.accessToken as string;
    }).catch(() => {
      setAccessToken(null);
      setCsrfToken(null);
      return null;
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function restoreSession() { return refreshAccessToken(); }

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  if (csrfTokenValue) config.headers['X-CSRF-Token'] = csrfTokenValue;
  return config;
});

api.interceptors.response.use(response => response, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
  const url = String(original?.url || '');
  if (error.response?.status === 401 && original && !original._retried && !url.startsWith('/auth/')) {
    original._retried = true;
    const token = await refreshAccessToken();
    if (token) {
      original.headers.Authorization = `Bearer ${token}`;
      return api(original);
    }
  }
  return Promise.reject(new Error((error.response?.data as { message?: string } | undefined)?.message || 'Не удалось выполнить запрос. Проверьте соединение с сервером.'));
});
