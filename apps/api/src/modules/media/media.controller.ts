import { Body, Controller, Delete, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsString, Max, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MediaService, UploadIntent } from './media.service';

class CreateUploadDto {
  @IsString() @IsIn(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']) contentType!: string;
  @IsInt() @Min(1) @Max(50 * 1024 * 1024) sizeBytes!: number;
  @IsString() @IsIn(['POST', 'STORY', 'AVATAR']) intent!: UploadIntent;
}
class SetAvatarDto { @IsString() @MinLength(1) mediaId!: string; }

@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads') createUpload(@Body() dto: CreateUploadDto, @Req() request: Request & { user: { sub: string } }) {
    return this.media.createUpload(request.user.sub, dto.contentType, dto.sizeBytes, dto.intent);
  }

  @Post('uploads/:id/finalize') finalize(@Param('id') id: string, @Req() request: Request & { user: { sub: string } }) {
    return this.media.finalize(request.user.sub, id);
  }

  @Put('uploads/:id/content') content(@Param('id') id: string, @Req() request: Request & { user: { sub: string } }) {
    return this.media.acceptLocalUpload(request.user.sub, id, request, request.headers['content-type'], request.headers['content-length']);
  }

  @Post('avatar') setAvatar(@Body() dto: SetAvatarDto, @Req() request: Request & { user: { sub: string } }) {
    return this.media.setAvatar(request.user.sub, dto.mediaId);
  }

  @Delete(':id') remove(@Param('id') id: string, @Req() request: Request & { user: { sub: string } }) {
    return this.media.remove(request.user.sub, id);
  }
}
