import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'allowed_roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue.');
    try {
      const payload = await this.jwt.verifyAsync(auth.slice(7), { secret: process.env.JWT_ACCESS_SECRET });
      if (!payload.sub || !payload.role) throw new Error('Invalid token');
      req.user = { id: payload.sub, role: payload.role as Role, institutionId: payload.institutionId ?? null, departmentId: payload.departmentId ?? null };
      return true;
    } catch { throw new UnauthorizedException('Your session is invalid or expired. Please sign in again.'); }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const req = context.switchToHttp().getRequest();
    if (!req.user || !roles.includes(req.user.role)) throw new ForbiddenException('Your role does not have permission to do this.');
    return true;
  }
}

export type SafeUser = { id: string; name: string; email: string; role: Role; institutionId: string | null; departmentId: string | null };
export function safeUser(user: any): SafeUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role, institutionId: user.institutionId ?? null, departmentId: user.departmentId ?? null };
}
