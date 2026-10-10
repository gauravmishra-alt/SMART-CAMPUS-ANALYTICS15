import { Body, Controller, Get, Post, Param, Req, UseGuards, ForbiddenException, BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { randomBytes, createHash } from 'crypto';
import * as argon2 from 'argon2';
import { Role } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { JwtAuthGuard, Roles, RolesGuard } from './common/security';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const INVITABLE = [Role.DEPARTMENT_ADMIN, Role.FACULTY, Role.ACADEMIC_ADVISOR, Role.PLACEMENT_COORDINATOR, Role.STUDENT, Role.AUDITOR];
class CreateInvitationDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsEnum(Role) role!: Role;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() studentRecordId?: string;
}
class AcceptInvitationDto { @IsString() @MinLength(16) token!: string; @IsString() @MinLength(12) @MaxLength(200) password!: string; }

@Controller('invitations')
export class InvitationsController {
  constructor(private prisma: PrismaService) {}
  private scopedActor(req: any) {
    const actor = req.user;
    if (!actor?.institutionId || ![Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN].includes(actor.role)) throw new ForbiddenException('Institution administrator permission is required.');
    return actor;
  }
  @Get() @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN)
  async list(@Req() req: any) {
    const actor = this.scopedActor(req);
    return this.prisma.invitation.findMany({ where: { institutionId: actor.institutionId, ...(actor.role === Role.DEPARTMENT_ADMIN ? { departmentId: actor.departmentId } : {}) }, select: { id: true, email: true, name: true, role: true, departmentId: true, studentRecordId: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true, createdBy: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  @Post() @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN)
  async create(@Req() req: any, @Body() dto: CreateInvitationDto) {
    const actor = this.scopedActor(req);
    if (!INVITABLE.includes(dto.role)) throw new BadRequestException('That role cannot be invited through institution onboarding.');
    if (actor.role === Role.DEPARTMENT_ADMIN && ![Role.FACULTY, Role.ACADEMIC_ADVISOR, Role.STUDENT, Role.AUDITOR].includes(dto.role)) throw new ForbiddenException('Department administrators cannot invite platform- or institution-level administrators.');
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('This email already has an account.');
    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({ where: { id: dto.departmentId, institutionId: actor.institutionId } });
      if (!dept) throw new BadRequestException('Department is not part of this institution.');
      if (actor.role === Role.DEPARTMENT_ADMIN && dto.departmentId !== actor.departmentId) throw new ForbiddenException('Department scope mismatch.');
    } else if (actor.role === Role.DEPARTMENT_ADMIN) throw new BadRequestException('Select your assigned department.');
    let studentRecordId: string | null = null;
    if (dto.role === Role.STUDENT) {
      if (!dto.studentRecordId) throw new BadRequestException('Select the existing student record to link to this account.');
      const student = await this.prisma.student.findFirst({ where: { id: dto.studentRecordId, institutionId: actor.institutionId }, select: { id: true, institutionalEmail: true, userId: true, departmentId: true } });
      if (!student || student.userId) throw new BadRequestException('Student record is unavailable or already linked to an account.');
      if (student.institutionalEmail && student.institutionalEmail.toLowerCase() !== email) throw new BadRequestException('Invite email must match the student record institutional email.');
      if (actor.role === Role.DEPARTMENT_ADMIN && student.departmentId !== actor.departmentId) throw new ForbiddenException('Student is outside your assigned department.');
      studentRecordId = student.id;
    }
    const token = randomBytes(36).toString('base64url');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const row = await this.prisma.invitation.create({ data: { institutionId: actor.institutionId, createdById: actor.id, email, name: dto.name.trim(), role: dto.role, departmentId: dto.departmentId || null, studentRecordId, tokenHash: digest(token), expiresAt } });
    await this.prisma.auditLog.create({ data: { institutionId: actor.institutionId, userId: actor.id, action: 'INVITATION_CREATED', entityType: 'Invitation', entityId: row.id, afterValue: { email, role: dto.role, expiresAt: expiresAt.toISOString() } } });
    const webBase = (process.env.WEB_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
    return { id: row.id, email: row.email, name: row.name, role: row.role, expiresAt, activationUrl: `${webBase}/activate?token=${encodeURIComponent(token)}`, activationToken: token, delivery: 'MANUAL_LINK', notice: 'This single-use link expires in 48 hours. Share it with the invitee through a trusted channel; it is not emailed by this MVP.' };
  }
  @Post('accept') async accept(@Body() dto: AcceptInvitationDto) {
    if (!/[A-Z]/.test(dto.password) || !/[a-z]/.test(dto.password) || !/[0-9]/.test(dto.password) || !/[^A-Za-z0-9]/.test(dto.password)) throw new BadRequestException('Password must include uppercase, lowercase, number, and symbol.');
    const tokenHash = digest(dto.token);
    return this.prisma.$transaction(async tx => {
      const invitation = await tx.invitation.findUnique({ where: { tokenHash } });
      if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= new Date()) throw new UnauthorizedException('This invitation is invalid, expired, revoked, or already used.');
      if (await tx.user.findUnique({ where: { email: invitation.email } })) throw new ConflictException('An account with this email already exists.');
      const user = await tx.user.create({ data: { institutionId: invitation.institutionId, departmentId: invitation.departmentId, name: invitation.name, email: invitation.email, role: invitation.role, passwordHash: await argon2.hash(dto.password) } });
      if (invitation.role === Role.STUDENT) {
        if (!invitation.studentRecordId) throw new BadRequestException('Student invitation has no linked student record.');
        const linked = await tx.student.updateMany({ where: { id: invitation.studentRecordId, institutionId: invitation.institutionId, userId: null }, data: { userId: user.id } });
        if (linked.count !== 1) throw new ConflictException('Student record has already been linked to an account.');
      }
      await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
      await tx.auditLog.create({ data: { institutionId: invitation.institutionId, userId: user.id, action: 'INVITATION_ACCEPTED', entityType: 'Invitation', entityId: invitation.id, afterValue: { role: user.role } } });
      return { success: true, message: 'Account activated. You can now sign in.', email: user.email };
    });
  }
  @Post(':id/revoke') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN)
  async revoke(@Req() req: any, @Param('id') id: string) {
    const actor = this.scopedActor(req);
    const where: any = { id, institutionId: actor.institutionId, acceptedAt: null, revokedAt: null };
    if (actor.role === Role.DEPARTMENT_ADMIN) where.departmentId = actor.departmentId;
    const row = await this.prisma.invitation.updateMany({ where, data: { revokedAt: new Date() } });
    if (row.count) await this.prisma.auditLog.create({ data: { institutionId: actor.institutionId, userId: actor.id, action: 'INVITATION_REVOKED', entityType: 'Invitation', entityId: id } });
    return { success: row.count > 0 };
  }
}

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}
  @Get() @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN)
  async list(@Req() req: any) {
    const actor = req.user;
    if (!actor.institutionId) throw new ForbiddenException('No institution scope.');
    return this.prisma.user.findMany({ where: { institutionId: actor.institutionId, ...(actor.role === Role.DEPARTMENT_ADMIN ? { departmentId: actor.departmentId } : {}) }, select: { id: true, name: true, email: true, role: true, departmentId: true, active: true, createdAt: true }, orderBy: { name: 'asc' }, take: 500 });
  }
}
