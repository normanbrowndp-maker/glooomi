import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LocalMediaStorage, mediaProvider } from './local-storage';
import { MediaService } from './media.service';

/** Only short-lived signed capabilities issued by authorized API reads work here. */
@Controller('media/files')
export class LocalMediaController {
  constructor(private local: LocalMediaStorage, private media: MediaService) {}
  @Get(':id')
  async read(@Param('id') id: string, @Query('expires') expires: string, @Query('signature') signature: string, @Res() response: Response) {
    if (mediaProvider() !== 'local') throw new NotFoundException();
    const key = this.local.authorize(id, expires, signature);
    const asset = await this.media.localReadAsset(key);
    await this.local.inspect(key, asset.contentType);
    response.setHeader('Content-Type', asset.contentType);
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, max-age=60');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // The configurable root may itself be inside .cache; the only addressable
    // filename is an already validated UUID, never an arbitrary dotfile/path.
    response.sendFile(this.local.path(key), { acceptRanges: true, cacheControl: false, dotfiles: 'allow' }, error => {
      if (error && !response.headersSent) response.status((error as { status?: number }).status === 416 ? 416 : 404).end();
    });
  }
}
