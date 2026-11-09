import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { matchesMediaSignature, MediaStorage } from './storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const READ_TTL = 300;

@Injectable()
export class LocalMediaStorage implements MediaStorage {
  readonly root = resolve(process.env.LOCAL_MEDIA_DIR || resolve(__dirname, '../../../../../uploads'));
  private origin() { return (process.env.API_PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''); }

  path(key: string) {
    const id = key.startsWith('private-media/') ? key.slice('private-media/'.length) : '';
    if (!UUID.test(id)) throw new BadRequestException('Недопустимый идентификатор файла.');
    return resolve(this.root, 'private-media', id);
  }
  async createUpload(key: string) {
    this.path(key);
    return { provider: 'local' as const, method: 'PUT' as const, url: '', fields: {} };
  }
  async write(key: string, source: Readable, contentType: string, sizeBytes: number) {
    const target = this.path(key);
    if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 50 * 1024 * 1024) throw new BadRequestException('Недопустимый размер файла.');
    await mkdir(resolve(this.root, 'private-media'), { recursive: true, mode: 0o700 }).catch(() => { throw new ServiceUnavailableException('Локальное хранилище недоступно для записи. Проверьте права на каталог медиа.'); });
    let bytes = 0; let prefix = Buffer.alloc(0); let created = false;
    const validate = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > sizeBytes) return callback(new BadRequestException('Размер файла превышает заявленный.'));
        if (prefix.length < 64) prefix = Buffer.concat([prefix, chunk.subarray(0, 64 - prefix.length)]);
        callback(null, chunk);
      },
      flush(callback) {
        callback(bytes === sizeBytes && matchesMediaSignature(contentType, prefix) ? undefined : new BadRequestException('Содержимое файла не соответствует его типу или размеру.'));
      },
    });
    const output = createWriteStream(target, { flags: 'wx', mode: 0o600 });
    output.once('open', () => { created = true; });
    const aborted = () => validate.destroy(new BadRequestException('Загрузка отменена.'));
    source.once('aborted', aborted); source.once('error', aborted);
    source.pipe(validate);
    try { await pipeline(validate, output); }
    catch (error) {
      source.unpipe(validate); source.resume();
      if (created) await unlink(target).catch(() => {});
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ConflictException('Файл уже загружен. Завершите публикацию или выберите файл заново.');
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Не удалось сохранить файл на локальном диске. Проверьте свободное место и повторите загрузку.');
    } finally { source.removeListener('aborted', aborted); source.removeListener('error', aborted); }
  }
  async inspect(key: string, contentType?: string) {
    const target = this.path(key);
    const stat = await lstat(target).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new NotFoundException('Файл не найден.');
    const file = await open(target, 'r');
    try {
      const prefix = Buffer.alloc(64); const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
      return { contentType, size: stat.size, prefix: prefix.subarray(0, bytesRead) };
    } finally { await file.close(); }
  }
  private signature(key: string, expires: number) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) throw new Error('JWT_ACCESS_SECRET is required for private media URLs');
    return createHmac('sha256', secret).update(`gloomi:local-media:${key}:${expires}`).digest('hex');
  }
  async readUrl(key: string) {
    this.path(key);
    const expires = Math.floor(Date.now() / 1000) + READ_TTL;
    return `${this.origin()}/api/media/files/${key.slice('private-media/'.length)}?expires=${expires}&signature=${this.signature(key, expires)}`;
  }
  authorize(id: string, expiresInput: string, signature: string) {
    const key = `private-media/${id}`; this.path(key);
    const expires = Number(expiresInput); const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(expires) || expires < now || expires > now + READ_TTL || !/^[0-9a-f]{64}$/.test(signature || '')) throw new NotFoundException('Ссылка на файл недействительна или устарела.');
    const expected = Buffer.from(this.signature(key, expires), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new NotFoundException('Ссылка на файл недействительна или устарела.');
    return key;
  }
  async remove(key: string) { await unlink(this.path(key)).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export function mediaProvider() {
  const provider = process.env.MEDIA_STORAGE_PROVIDER || (process.env.NODE_ENV === 'production' ? 's3' : 'local');
  if (!['local', 's3'].includes(provider)) throw new Error('MEDIA_STORAGE_PROVIDER must be local or s3');
  return provider;
}
