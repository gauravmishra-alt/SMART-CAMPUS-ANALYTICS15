import { Body, Controller, ForbiddenException, BadRequestException, Post, Req, UseGuards, Param, Patch } from '@nestjs/common';
import { AttendanceStatus, Role } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { JwtAuthGuard, Roles, RolesGuard } from './common/security';
import { PrismaService } from './prisma.service';
import { ScoreEngine } from './students/score-engine';

class AcademicDto { @IsString() studentId!: string; @IsOptional() @IsString() courseId?: string; @IsString() assessmentType!: string; @IsNumber() @Min(0) marks!: number; @IsNumber() @Min(0.01) maxMarks!: number; @IsOptional() @IsDateString() recordedAt?: string; }
class AttendanceDto { @IsString() studentId!: string; @IsOptional() @IsString() courseId?: string; @IsDateString() date!: string; @IsEnum(AttendanceStatus) status!: AttendanceStatus; @IsOptional() @IsString() period?: string; }
class LmsDto { @IsString() studentId!: string; @IsDateString() periodStart!: string; @IsDateString() periodEnd!: string; @IsOptional() @IsInt() @Min(0) loginCount?: number; @IsOptional() @IsInt() @Min(0) assignmentsCompleted?: number; @IsOptional() @IsInt() @Min(0) assignmentsAssigned?: number; @IsOptional() @IsInt() @Min(0) minutesSpent?: number; }
class SkillDto { @IsString() studentId!: string; @IsString() @MinLength(2) @MaxLength(100) skill!: string; @IsOptional() @IsString() level?: string; @IsOptional() @IsNumber() @Min(0) @Max(100) score?: number; }
class PlacementDto { @IsString() studentId!: string; @IsOptional() @IsNumber() @Min(0) @Max(100) aptitudeScore?: number; @IsOptional() @IsNumber() @Min(0) @Max(100) codingScore?: number; @IsOptional() @IsNumber() @Min(0) @Max(100) communicationScore?: number; @IsOptional() @IsNumber() @Min(0) @Max(100) mockInterviewScore?: number; @IsOptional() @IsBoolean() participated?: boolean; }
class EngagementDto { @IsString() studentId!: string; @IsString() activityType!: string; @IsString() @MinLength(2) title!: string; @IsOptional() @IsNumber() @Min(0) @Max(100) points?: number; @IsOptional() @IsDateString() date?: string; }
class FeedbackDto { @IsString() studentId!: string; @IsString() source!: string; @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number; @IsOptional() @IsString() @MaxLength(5000) comment?: string; }

@Controller('data')
@UseGuards(JwtAuthGuard)
export class DataController {
  constructor(private prisma: PrismaService, private scoreEngine: ScoreEngine) {}
  private async checkStudent(actor: any, studentId: string) {
    if (!actor.institutionId) throw new ForbiddenException('This account has no institution scope.');
    const where: any = { id: studentId, institutionId: actor.institutionId };
    if (actor.role === Role.STUDENT) where.userId = actor.id;
    if ([Role.DEPARTMENT_ADMIN, Role.FACULTY].includes(actor.role)) {
      if (!actor.departmentId) throw new ForbiddenException('Your account has no department scope.');
      where.departmentId = actor.departmentId;
    }
    if (actor.role === Role.ACADEMIC_ADVISOR) where.advisorUserId = actor.id;
    const student = await this.prisma.student.findFirst({ where, select: { id: true, institutionId: true } });
    if (!student) throw new ForbiddenException('Student is outside your permitted scope.');
    return student;
  }
  private async audit(actor: any, type: string, id: string, afterValue: any) {
    await this.prisma.auditLog.create({ data: { institutionId: actor.institutionId, userId: actor.id, action: `${type.toUpperCase()}_CREATED`, entityType: type, entityId: id, afterValue } });
  }
  @Post('academics') @UseGuards(RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN, Role.FACULTY)
  async academic(@Req() req: any, @Body() dto: AcademicDto) {
    if (dto.marks > dto.maxMarks) throw new BadRequestException('Marks cannot exceed maximum marks.');
    await this.checkStudent(req.user, dto.studentId);
    if (dto.courseId && !await this.prisma.course.findFirst({ where: { id: dto.courseId, institutionId: req.user.institutionId } })) throw new BadRequestException('Course is not in this institution.');
    const row = await this.prisma.studentAcademicRecord.create({ data: { studentId: dto.studentId, courseId: dto.courseId || null, assessmentType: dto.assessmentType, marks: dto.marks, maxMarks: dto.maxMarks, recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(), recordedById: req.user.id } });
    await this.audit(req.user, 'ACADEMIC_RECORD', row.id, { studentId: dto.studentId, assessmentType: dto.assessmentType, marks: dto.marks, maxMarks: dto.maxMarks }); await this.scoreEngine.calculate(dto.studentId, req.user.institutionId); return row;
  }
  @Post('attendance') @UseGuards(RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN, Role.FACULTY)
  async attendance(@Req() req: any, @Body() dto: AttendanceDto) {
    await this.checkStudent(req.user, dto.studentId);
    if (dto.courseId && !await this.prisma.course.findFirst({ where: { id: dto.courseId, institutionId: req.user.institutionId } })) throw new BadRequestException('Course is not in this institution.');
    const row = await this.prisma.attendanceRecord.create({ data: { studentId: dto.studentId, courseId: dto.courseId || null, date: new Date(dto.date), status: dto.status, period: dto.period || null, recordedById: req.user.id } });
    await this.audit(req.user, 'ATTENDANCE_RECORD', row.id, { studentId: dto.studentId, status: dto.status, date: dto.date }); await this.scoreEngine.calculate(dto.studentId, req.user.institutionId); return row;
  }
  @Post('lms') @UseGuards(RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN, Role.FACULTY)
  async lms(@Req() req: any, @Body() dto: LmsDto) {
    await this.checkStudent(req.user, dto.studentId);
    const start = new Date(dto.periodStart), end = new Date(dto.periodEnd); if (end < start) throw new BadRequestException('Period end must be on or after start.');
    const row = await this.prisma.lMSActivity.create({ data: { studentId: dto.studentId, periodStart: start, periodEnd: end, loginCount: dto.loginCount ?? 0, assignmentsCompleted: dto.assignmentsCompleted ?? 0, assignmentsAssigned: dto.assignmentsAssigned ?? 0, minutesSpent: dto.minutesSpent ?? 0 } });
    await this.audit(req.user, 'LMS_ACTIVITY', row.id, { studentId: dto.studentId, periodStart: start.toISOString(), periodEnd: end.toISOString() }); await this.scoreEngine.calculate(dto.studentId, req.user.institutionId); return row;
  }
  @Post('skills') @UseGuards(RolesGuard) @Roles(Role.STUDENT, Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN, Role.FACULTY, Role.PLACEMENT_COORDINATOR)
  async skill(@Req() req: any, @Body() dto: SkillDto) {
    await this.checkStudent(req.user, dto.studentId);
    const studentMode = req.user.role === Role.STUDENT;
    const row = await this.prisma.skillAssessment.create({ data: { studentId: dto.studentId, skill: dto.skill.trim(), level: dto.level || null, score: studentMode ? null : (dto.score ?? null), verified: !studentMode && dto.score !== undefined, verifiedById: !studentMode ? req.user.id : null } });
    await this.audit(req.user, 'SKILL_ASSESSMENT', row.id, { studentId: dto.studentId, skill: dto.skill, submittedByStudent: studentMode }); await this.scoreEngine.calculate(dto.studentId, req.user.institutionId); return row;
  }
  @Patch('skills/:id/verify') @UseGuards(RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN, Role.PLACEMENT_COORDINATOR)
  async verifySkill(@Req() req: any, @Param('id') id: string, @Body() body: { score: number }) {
    if (typeof body.score !== 'number' || body.score < 0 || body.score > 100) throw new BadRequestException('Score must be between 0 and 100.');
    const row = await this.prisma.skillAssessment.findFirst({ where: { id, student: { institutionId: req.user.institutionId, ...(req.user.role === Role.DEPARTMENT_ADMIN ? { departmentId: req.user.departmentId } : {}) } } });
    if (!row) throw new ForbiddenException('Skill record is outside your permitted scope.');
    const updated = await this.prisma.skillAssessment.update({ where: { id }, data: { score: body.score, verified: true, verifiedById: req.user.id } });
    await this.audit(req.user, 'SKILL_VERIFIED', id, { score: body.score }); await this.scoreEngine.calculate(row.studentId, req.user.institutionId); return updated;
  }
  @Post('placement') @UseGuards(RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN, Role.PLACEMENT_COORDINATOR)
  async placement(@Req() req: any, @Body() dto: PlacementDto) {
    await this.checkStudent(req.user, dto.studentId);
    const row = await this.prisma.placementAssessment.create({ data: { studentId: dto.studentId, aptitudeScore: dto.aptitudeScore ?? null, codingScore: dto.codingScore ?? null, communicationScore: dto.communicationScore ?? null, mockInterviewScore: dto.mockInterviewScore ?? null, participated: dto.participated ?? false, assessedById: req.user.id } });
    await this.audit(req.user, 'PLACEMENT_ASSESSMENT', row.id, { studentId: dto.studentId }); await this.scoreEngine.calculate(dto.studentId, req.user.institutionId); return row;
  }
  @Post('engagement') @UseGuards(RolesGuard) @Roles(Role.STUDENT, Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN, Role.FACULTY)
  async engagement(@Req() req: any, @Body() dto: EngagementDto) {
    await this.checkStudent(req.user, dto.studentId);
    const studentMode = req.user.role === Role.STUDENT;
    const row = await this.prisma.engagementRecord.create({ data: { studentId: dto.studentId, activityType: dto.activityType.trim(), title: dto.title.trim(), points: studentMode ? 0 : (dto.points ?? 0), date: dto.date ? new Date(dto.date) : new Date(), approved: !studentMode } });
    await this.audit(req.user, 'ENGAGEMENT_RECORD', row.id, { studentId: dto.studentId, title: dto.title, submittedByStudent: studentMode }); await this.scoreEngine.calculate(dto.studentId, req.user.institutionId); return row;
  }
  @Post('feedback') @UseGuards(RolesGuard) @Roles(Role.STUDENT, Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN, Role.FACULTY, Role.ACADEMIC_ADVISOR)
  async feedback(@Req() req: any, @Body() dto: FeedbackDto) {
    await this.checkStudent(req.user, dto.studentId);
    const row = await this.prisma.feedback.create({ data: { studentId: dto.studentId, source: dto.source, rating: dto.rating ?? null, comment: dto.comment || null } });
    await this.audit(req.user, 'FEEDBACK', row.id, { studentId: dto.studentId, source: dto.source, rating: dto.rating }); return row;
  }
}
