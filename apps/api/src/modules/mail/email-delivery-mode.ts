export type EmailDeliveryMode = 'direct' | 'queue';

/** Evaluate after dotenv has loaded, rather than when modules are imported. */
export function emailDeliveryMode(): EmailDeliveryMode {
  const mode = process.env.EMAIL_DELIVERY_MODE || (process.env.NODE_ENV === 'production' ? 'queue' : 'direct');
  if (mode !== 'direct' && mode !== 'queue') throw new Error('EMAIL_DELIVERY_MODE must be direct or queue');
  return mode;
}

export function localDirectEmail() {
  return process.env.NODE_ENV !== 'production' && emailDeliveryMode() === 'direct';
}
