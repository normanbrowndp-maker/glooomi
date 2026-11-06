import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto, RegisterDto, ResendDto, VerifyDto } from './dto';
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto); }
  @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Post('verify-email') verify(@Body() dto: VerifyDto) { return this.auth.verify(dto); }
  @Post('refresh') refresh(@Body('refreshToken') token: string) { return this.auth.refresh(token); }
  @Post('resend-code') resend(@Body() dto: ResendDto) { return this.auth.resend(dto.email); }
  @Post('logout') @UseGuards(JwtAuthGuard) logout(@Body('refreshToken') token: string) { return this.auth.logout(token); }
  @Get('me') @UseGuards(JwtAuthGuard) me(@Req() req: any) { return this.auth.me(req.user.sub); }
}
