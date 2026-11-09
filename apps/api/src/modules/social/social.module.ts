import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtModule } from '@nestjs/jwt';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { MessagesGateway } from './messages.gateway';
import { MediaModule } from '../media/media.module';
@Module({ imports: [JwtModule.register({}), MediaModule], controllers: [SocialController], providers: [PrismaService, JwtAuthGuard, SocialService, MessagesGateway] })
export class SocialModule {}
