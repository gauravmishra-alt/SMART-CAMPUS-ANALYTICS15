import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/security';

class LoginDto { @IsEmail() email!: string; @IsString() @MinLength(1) password!: string; }
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  private cookieOptions() { return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/v1/auth', maxAge: 7 * 24 * 60 * 60 * 1000 }; }
  @Post('login') async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.login(body.email, body.password);
    res.cookie('sc_refresh', session.refreshToken, this.cookieOptions());
    return { accessToken: session.accessToken, user: session.user };
  }
  @Post('refresh') async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.refresh(req.cookies?.sc_refresh);
    res.cookie('sc_refresh', session.refreshToken, this.cookieOptions());
    return { accessToken: session.accessToken, user: session.user };
  }
  @Post('logout') async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.sc_refresh); res.clearCookie('sc_refresh', this.cookieOptions()); return { success: true };
  }
  @Get('me') @UseGuards(JwtAuthGuard) async me(@Req() req: any) { return this.auth.me(req.user.id); }
}
