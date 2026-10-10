import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { InterventionStatus, Priority, Role } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard, Roles, RolesGuard } from './common/security';
import { PrismaService } from './prisma.service';

class CreateInterventionDto {
  @IsString() studentId!: string;
  @IsString() @MinLength(2) type!: string;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsString() ownerUserId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsString() source?: string;
}
class UpdateInterventionDto {
  @IsOptional() @IsEnum(InterventionStatus) status?: InterventionStatus;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsString() ownerUserId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsString() @MaxLength(2000) updateMessage?: string;
}
@Controller('interventions')
@UseGuards(JwtAuthGuard)
export class InterventionsController {
  constructor(private prisma: PrismaService) {}
  private async allowedStudent(actor: any, id: string) {
    if (!actor.institutionId || actor.role === Role.SUPER_ADMIN || actor.role === Role.STUDENT || actor.role === Role.AUDITOR) throw new ForbiddenException('Your role cannot manage interventions.');
    const where: any = { id, institutionId: actor.institutionId };
    if ([Role.DEPARTMENT_ADMIN, Role.FACULTY].includes(actor.role)) { if (!actor.departmentId) throw new ForbiddenException('No department scope assigned.'); where.departmentId = actor.departmentId; }
    if (actor.role === Role.ACADEMIC_ADVISOR) where.advisorUserId = actor.id;
    const s = await this.prisma.student.findFirst({ where, select: { id: true } });
    if (!s) throw new ForbiddenException('Student is outside your permitted scope.'); return s;
  }
  @Get() async list(@Req() req: any, @Query() q: any) {
    const actor = req.user;
    if (!actor.institutionId || [Role.SUPER_ADMIN, Role.STUDENT].includes(actor.role)) throw new ForbiddenException('Interventions are not available for this account.');
    const where: any = { institutionId: actor.institutionId };
    if (actor.role === Role.DEPARTMENT_ADMIN || actor.role === Role.FACULTY) where.student = { departmentId: actor.departmentId };
    if (actor.role === Role.ACADEMIC_ADVISOR) where.student = { advisorUserId: actor.id };
    if (q.status && Object.values(InterventionStatus).includes(q.status)) where.status = q.status;
    if (q.search) where.student = { ...(where.student || {}), OR: [{ name: { contains: String(q.search), mode: 'insensitive' } }, { studentId: { contains: String(q.search), mode: 'insensitive' } }] };
    return this.prisma.intervention.findMany({ where, include: { student: { select: { id: true, studentId: true, name: true, department: { select: { name: true } } } }, owner: { select: { id: true, name: true, email: true, role: true } }, updates: { orderBy: { createdAt: 'desc' }, take: 5 } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], take: 200 });
  }
  @Post() @UseGuards(RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN, Role.FACULTY, Role.ACADEMIC_ADVISOR)
  async create(@Req() req: any, @Body() dto: CreateInterventionDto) {
    await this.allowedStudent(req.user, dto.studentId);
    if (dto.ownerUserId) {
      const owner = await this.prisma.user.findFirst({ where: { id: dto.ownerUserId, institutionId: req.user.institutionId, active: true } });
      if (!owner || ![Role.FACULTY, Role.ACADEMIC_ADVISOR, Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN].includes(owner.role)) throw new BadRequestException('Intervention owner is not an eligible active user in this institution.');
    }
    const allowedTypes = await this.prisma.interventionType.findMany({ where: { active: true }, select: { key: true } });
    const valid = allowedTypes.some(t => t.key === dto.type) || ['FACULTY_MENTORING', 'ATTENDANCE_FOLLOW_UP', 'REMEDIAL_LEARNING', 'CODING_WORKSHOP', 'MOCK_INTERVIEW_TRAINING', 'OTHER'].includes(dto.type);
    if (!valid) throw new BadRequestException('Select a valid intervention type.');
    const row = await this.prisma.intervention.create({ data: { institutionId: req.user.institutionId, studentId: dto.studentId, type: dto.type, priority: dto.priority ?? Priority.MEDIUM, ownerUserId: dto.ownerUserId || null, dueDate: dto.dueDate ? new Date(dto.dueDate) : null, notes: dto.notes || null, source: dto.source === 'AI' ? 'AI' : 'MANUAL', createdById: req.user.id } });
    await this.prisma.interventionUpdate.create({ data: { interventionId: row.id, userId: req.user.id, message: `Intervention created (${row.source}).`, status: row.status } });
    await this.prisma.auditLog.create({ data: { institutionId: req.user.institutionId, userId: req.user.id, action: 'INTERVENTION_CREATED', entityType: 'Intervention', entityId: row.id, afterValue: { studentId: row.studentId, type: row.type, priority: row.priority, source: row.source } } });
    return this.prisma.intervention.findUnique({ where: { id: row.id }, include: { student: { select: { id: true, studentId: true, name: true } }, owner: { select: { id: true, name: true, role: true } }, updates: true } });
  }
  @Patch(':id') @UseGuards(RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN, Role.FACULTY, Role.ACADEMIC_ADVISOR)
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateInterventionDto) {
    const existing = await this.prisma.intervention.findFirst({ where: { id, institutionId: req.user.institutionId }, include: { student: true } });
    if (!existing) throw new NotFoundException('Intervention not found in your institution.');
    await this.allowedStudent(req.user, existing.studentId);
    if (dto.ownerUserId) {
      const owner = await this.prisma.user.findFirst({ where: { id: dto.ownerUserId, institutionId: req.user.institutionId, active: true } });
      if (!owner || ![Role.FACULTY, Role.ACADEMIC_ADVISOR, Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN].includes(owner.role)) throw new BadRequestException('Owner must be an eligible active staff member in this institution.');
    }
    const data: any = {};
    for (const k of ['status', 'priority', 'ownerUserId', 'notes'] as const) if (dto[k] !== undefined) data[k] = dto[k];
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    const updated = await this.prisma.intervention.update({ where: { id }, data });
    if (dto.updateMessage || dto.status) await this.prisma.interventionUpdate.create({ data: { interventionId: id, userId: req.user.id, message: dto.updateMessage?.trim() || `Status updated to ${dto.status}.`, status: dto.status ?? null } });
    await this.prisma.auditLog.create({ data: { institutionId: req.user.institutionId, userId: req.user.id, action: 'INTERVENTION_UPDATED', entityType: 'Intervention', entityId: id, beforeValue: existing as any, afterValue: updated as any } });
    return updated;
  }
}
