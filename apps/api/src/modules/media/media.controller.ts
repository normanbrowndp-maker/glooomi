import { BadRequestException, Controller, Post, Req, ServiceUnavailableException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: any) {
    if (!file) throw new BadRequestException('Choose a media file');
    const contentType = file.mimetype;
    if (!/^image\/(jpeg|png|webp|gif)$|^video\/(mp4|webm|quicktime)$/.test(contentType)) throw new BadRequestException('Unsupported media type');
    const maxBytes = contentType.startsWith('video/') ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxBytes) throw new BadRequestException(`Media exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new ServiceUnavailableException('Media storage is not configured. Set S3_BUCKET and AWS credentials.');
    const extension = file.originalname.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    const key = `users/${req.user.sub}/${randomUUID()}.${extension}`;
    const client = new S3Client({ region: process.env.AWS_REGION || 'eu-central-1' });
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: file.buffer, ContentType: contentType, Metadata: { owner: req.user.sub }, CacheControl: 'public, max-age=31536000, immutable' }));
    const base = process.env.MEDIA_PUBLIC_BASE_URL || `https://${bucket}.s3.${process.env.AWS_REGION || 'eu-central-1'}.amazonaws.com`;
    return { publicUrl: `${base.replace(/\/$/, '')}/${key}`, key, contentType, bytes: file.size };
  }
}
