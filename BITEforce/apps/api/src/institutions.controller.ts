import { Body, Controller, Get, Param, Post, Req, UseGuards, ForbiddenException, BadRequestException } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { JwtAuthGuard, Roles, RolesGuard } from './common/security';
import { PrismaService } from './prisma.service';
import { DEFAULT_WEIGHTS } from './students/score-engine';

class CreateInstitutionDto {
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(32) code?: string;
  @IsString() @MinLength(2) adminName!: string;
  @IsEmail() adminEmail!: string;
  @IsString() @MinLength(12) adminPassword!: string;
}
class StructureDto { @IsString() @MinLength(2) name!: string; @IsOptional() @IsString() campusId?: string; @IsOptional() @IsString() departmentId?: string; @IsOptional() @IsString() code?: string; }
@Controller('institutions')
export class InstitutionsController {
  constructor(private prisma: PrismaService) {}
  @Post() @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.SUPER_ADMIN)
  async create(@Req() req: any, @Body() input: CreateInstitutionDto) {
    if (!/[A-Z]/.test(input.adminPassword) || !/[a-z]/.test(input.adminPassword) || !/[0-9]/.test(input.adminPassword) || !/[^A-Za-z0-9]/.test(input.adminPassword)) throw new BadRequestException('Admin password must contain uppercase, lowercase, number, and symbol.');
    const email = input.adminEmail.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('An account with that admin email already exists.');
    const institution = await this.prisma.$transaction(async tx => {
      const inst = await tx.institution.create({ data: { name: input.name.trim(), code: input.code?.trim() || undefined } });
      await tx.scoringConfig.create({ data: { institutionId: inst.id, weights: DEFAULT_WEIGHTS, minimumFactors: 3, attendanceThreshold: 75, academicRiskThreshold: 50, placementRiskThreshold: 50 } });
      const admin = await tx.user.create({ data: { institutionId: inst.id, name: input.adminName.trim(), email, passwordHash: await argon2.hash(input.adminPassword), role: Role.INSTITUTION_ADMIN } });
      await tx.auditLog.create({ data: { userId: req.user.id, institutionId: inst.id, action: 'INSTITUTION_CREATED', entityType: 'Institution', entityId: inst.id, afterValue: { name: inst.name, adminId: admin.id } } });
      return { ...inst, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } };
    });
    return institution;
  }
  @Get('current') @UseGuards(JwtAuthGuard)
  async current(@Req() req: any) {
    const user = req.user;
    if (!user.institutionId) throw new ForbiddenException('This account is not assigned to an institution.');
    return this.prisma.institution.findUnique({ where: { id: user.institutionId }, include: { campuses: true, departments: true, programmes: true } });
  }
  @Get('structure') @UseGuards(JwtAuthGuard)
  async structure(@Req() req: any) {
    if (!req.user.institutionId) throw new ForbiddenException('No institution scope.');
    const id = req.user.institutionId;
    const [campuses, departments, programmes, courses] = await Promise.all([
      this.prisma.campus.findMany({ where: { institutionId: id }, orderBy: { name: 'asc' } }),
      this.prisma.department.findMany({ where: { institutionId: id }, orderBy: { name: 'asc' } }),
      this.prisma.programme.findMany({ where: { institutionId: id }, orderBy: { name: 'asc' } }),
      this.prisma.course.findMany({ where: { institutionId: id }, orderBy: { name: 'asc' } }),
    ]);
    return { campuses, departments, programmes, courses };
  }
  @Post('structure/:type') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.INSTITUTION_ADMIN)
  async addStructure(@Req() req: any, @Param('type') type: string, @Body() body: StructureDto) {
    const institutionId = req.user.institutionId;
    if (!institutionId) throw new ForbiddenException('No institution scope.');
    const name = body.name.trim();
    if (req.user.role === Role.DEPARTMENT_ADMIN && !['course'].includes(type)) throw new ForbiddenException('Department administrators cannot modify institution-wide structure.');
    if (req.user.role === Role.DEPARTMENT_ADMIN && req.user.departmentId && body.departmentId !== req.user.departmentId) throw new ForbiddenException('Department scope mismatch.');
    let result: any;
    if (type === 'campus') result = await this.prisma.campus.create({ data: { institutionId, name } });
    else if (type === 'department') { if (body.campusId && !await this.prisma.campus.findFirst({ where: { id: body.campusId, institutionId } })) throw new BadRequestException('Campus is not in this institution.'); result = await this.prisma.department.create({ data: { institutionId, name, campusId: body.campusId || null } }); }
    else if (type === 'programme') { if (body.departmentId && !await this.prisma.department.findFirst({ where: { id: body.departmentId, institutionId } })) throw new BadRequestException('Department is not in this institution.'); result = await this.prisma.programme.create({ data: { institutionId, name, departmentId: body.departmentId || null } }); }
    else if (type === 'course') result = await this.prisma.course.create({ data: { institutionId, name, code: body.code?.trim() || null } });
    else throw new BadRequestException('Unsupported structure type. Use campus, department, programme, or course.');
    await this.prisma.auditLog.create({ data: { institutionId, userId: req.user.id, action: 'STRUCTURE_CREATED', entityType: type, entityId: result.id, afterValue: { name } } });
    return result;
  }
}
