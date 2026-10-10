import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma.service';
import { safeUser } from '../common/security';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private config: ConfigService) {}

  private async makeSession(user: any) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role, institutionId: user.institutionId, departmentId: user.departmentId }, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: '15m',
    });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({ data: { userId: user.id, tokenHash: digest(refreshToken), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
    return { accessToken, refreshToken, user: safeUser(user) };
  }

  async login(emailRaw: string, password: string) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) throw new UnauthorizedException('Email or password is incorrect.');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new ForbiddenException('Sign-in is temporarily locked. Try again later.');
    const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!valid) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: failed, lockedUntil: failed >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : null } });
      await this.prisma.auditLog.create({ data: { institutionId: user.institutionId, userId: user.id, action: 'LOGIN_FAILED', entityType: 'User', entityId: user.id } });
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await this.prisma.auditLog.create({ data: { institutionId: user.institutionId, userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id } });
    return this.makeSession(user);
  }

  async refresh(rawToken?: string) {
    if (!rawToken) throw new UnauthorizedException('Refresh session is missing. Please sign in again.');
    const oldHash = digest(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: oldHash }, include: { user: true } });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date() || !stored.user.active) {
      if (stored && !stored.revokedAt) await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Refresh session has expired. Please sign in again.');
    }
    const newToken = randomBytes(48).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      const rotated = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });
      // Atomic compare-and-set: if concurrent refresh requests race, only one can rotate.
      if (rotated.count !== 1) throw new UnauthorizedException('Refresh session has already been used. Please sign in again.');
      await tx.refreshToken.create({ data: { userId: stored.userId, tokenHash: digest(newToken), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
    });
    const accessToken = await this.jwt.signAsync({ sub: stored.user.id, role: stored.user.role, institutionId: stored.user.institutionId, departmentId: stored.user.departmentId }, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: '15m',
    });
    return { accessToken, refreshToken: newToken, user: safeUser(stored.user) };
  }

  async logout(rawToken?: string) {
    if (rawToken) await this.prisma.refreshToken.updateMany({ where: { tokenHash: digest(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return { success: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new UnauthorizedException('Account is unavailable.');
    return safeUser(user);
  }
}
