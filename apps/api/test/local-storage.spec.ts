import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { LocalMediaStorage, mediaProvider } from '../src/modules/media/local-storage';

describe('local private filesystem storage (real files)', () => {
  let directory: string; let storage: LocalMediaStorage; let key: string;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2xoAAAAASUVORK5CYII=', 'base64');
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gloomi-media-'));
    vi.stubEnv('LOCAL_MEDIA_DIR', directory); vi.stubEnv('JWT_ACCESS_SECRET', 'local-media-test-only-secret-32-bytes');
    storage = new LocalMediaStorage(); key = `private-media/${randomUUID()}`;
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  it('persists bytes across adapter restarts and inspects their real size/signature', async () => {
    await storage.write(key, Readable.from(png), 'image/png', png.length);
    const restarted = new LocalMediaStorage();
    expect(await readFile(restarted.path(key))).toEqual(png);
    expect(await restarted.inspect(key, 'image/png')).toMatchObject({ size: png.length, contentType: 'image/png' });
    expect((await restarted.createUpload(key)).provider).toBe('local');
  });
  it('rejects spoofed MIME and removes invalid files', async () => {
    const html = Buffer.from('<script>not an image</script>');
    await expect(storage.write(key, Readable.from(html), 'image/png', html.length)).rejects.toMatchObject({ status: 400 });
    await expect(stat(storage.path(key))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('bounds streaming bytes and cleans incomplete uploads', async () => {
    await expect(storage.write(key, Readable.from(png), 'image/png', 4)).rejects.toMatchObject({ status: 400 });
    await expect(stat(storage.path(key))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(storage.write(key, Readable.from(png.subarray(0, 8)), 'image/png', png.length)).rejects.toMatchObject({ status: 400 });
  });
  it('does not overwrite an existing file on concurrent/repeated upload', async () => {
    await storage.write(key, Readable.from(png), 'image/png', png.length);
    await expect(storage.write(key, Readable.from(png), 'image/png', png.length)).rejects.toMatchObject({ status: 409 });
    expect(await readFile(storage.path(key))).toEqual(png);
  });
  it('removes a partially written file when the request is aborted', async () => {
    let started=false;
    const source=new Readable({read(){if(started)return;started=true;this.push(png.subarray(0,8));queueMicrotask(()=>this.emit('aborted'));}});
    await expect(storage.write(key,source,'image/png',png.length)).rejects.toMatchObject({status:400,message:'Загрузка отменена.'});
    source.destroy();
    await expect(stat(storage.path(key))).rejects.toMatchObject({code:'ENOENT'});
  });
  it.each(['../.env', 'private-media/../../.env', 'private-media/..\\.env', '/tmp/file', 'private-media/not-a-uuid'])('rejects traversal/unsafe keys: %s', async invalid => {
    expect(() => storage.path(invalid)).toThrow();
    await expect(storage.remove(invalid)).rejects.toMatchObject({ status: 400 });
  });
  it('requires an unexpired server-signed capability and rejects tampering', async () => {
    const url = new URL(await storage.readUrl(key));
    const id = key.split('/')[1];
    expect(storage.authorize(id, url.searchParams.get('expires')!, url.searchParams.get('signature')!)).toBe(key);
    expect(() => storage.authorize(id, url.searchParams.get('expires')!, '0'.repeat(64))).toThrow();
    expect(() => storage.authorize(randomUUID(), url.searchParams.get('expires')!, url.searchParams.get('signature')!)).toThrow();
    expect(() => storage.authorize(id, '1', url.searchParams.get('signature')!)).toThrow();
  });
  it('deletes only its own validated file and tolerates repeated cleanup', async () => {
    await storage.write(key, Readable.from(png), 'image/png', png.length);
    await storage.remove(key); await storage.remove(key);
    await expect(storage.inspect(key, 'image/png')).rejects.toMatchObject({ status: 404 });
  });
  it('defaults to local in development and preserves explicit S3 support', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('MEDIA_STORAGE_PROVIDER', ''); expect(mediaProvider()).toBe('local');
    vi.stubEnv('MEDIA_STORAGE_PROVIDER', 's3'); expect(mediaProvider()).toBe('s3');
  });
});
