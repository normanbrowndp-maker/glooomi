export function redisConnectionOptions() {
  const raw = process.env.REDIS_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  const database = Number(url.pathname.replace(/^\//, ''));
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    ...(Number.isInteger(database) && database > 0 ? { db: database } : {}),
    maxRetriesPerRequest: null,
  };
}
