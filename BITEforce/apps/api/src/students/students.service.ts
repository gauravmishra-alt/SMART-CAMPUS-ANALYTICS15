import { Injectable, ForbiddenException, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ScoreEngine } from './score-engine';

const ADMIN_ROLES: Role[] = [Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN];
type Actor = { id: string; role: Role; institutionId: string | null; departmentId?: string | null };

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService, private scores: ScoreEngine) {}
  private institution(actor: Actor) { if (!actor.institutionId || actor.role === Role.SUPER_ADMIN) throw new ForbiddenException('Platform administrators must use audited support access to view student data.'); return actor.institutionId; }
  private scope(actor: Actor): Prisma.StudentWhereInput {
    const institutionId = this.institution(actor);
    const where: Prisma.StudentWhereInput = { institutionId };
    if (actor.role === Role.STUDENT) where.userId = actor.id;
    if (actor.role === Role.ACADEMIC_ADVISOR) where.advisorUserId = actor.id;
    if ([Role.DEPARTMENT_ADMIN, Role.FACULTY].includes(actor.role)) {
      if (!actor.departmentId) throw new ForbiddenException('Your account has no department scope assigned.');
      where.departmentId = actor.departmentId;
    }
    return where;
  }
  private async validateReferences(institutionId: string, refs: { campusId?: string | null; departmentId?: string | null; programmeId?: string | null; advisorUserId?: string | null }) {
    let campus: { id: string } | null = null;
    let department: { id: string; campusId: string | null } | null = null;
    let programme: { id: string; departmentId: string | null } | null = null;
    if (refs.campusId) {
      campus = await this.prisma.campus.findFirst({ where: { id: refs.campusId, institutionId }, select: { id: true } });
      if (!campus) throw new BadRequestException('Campus is not part of your institution.');
    }
    if (refs.departmentId) {
      department = await this.prisma.department.findFirst({ where: { id: refs.departmentId, institutionId }, select: { id: true, campusId: true } });
      if (!department) throw new BadRequestException('Department is not part of your institution.');
      if (campus && department.campusId && department.campusId !== campus.id) throw new BadRequestException('The selected department does not belong to the selected campus.');
    }
    if (refs.programmeId) {
      programme = await this.prisma.programme.findFirst({ where: { id: refs.programmeId, institutionId }, select: { id: true, departmentId: true } });
      if (!programme) throw new BadRequestException('Programme is not part of your institution.');
      if (department && programme.departmentId && programme.departmentId !== department.id) throw new BadRequestException('The selected programme does not belong to the selected department.');
    }
    if (refs.advisorUserId) {
      const advisor = await this.prisma.user.findFirst({ where: { id: refs.advisorUserId, institutionId, active: true, role: { in: [Role.ACADEMIC_ADVISOR, Role.FACULTY] } }, select: { id: true } });
      if (!advisor) throw new BadRequestException('Advisor must be an active faculty member or academic advisor in your institution.');
    }
  }
  async list(actor: Actor, q: any) {
    const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
    const and: Prisma.StudentWhereInput[] = [this.scope(actor)];
    const search = typeof q.search === 'string' ? q.search.trim().slice(0, 120) : '';
    if (search) and.push({ OR: [ { name: { contains: search, mode: 'insensitive' } }, { studentId: { contains: search, mode: 'insensitive' } }, { institutionalEmail: { contains: search, mode: 'insensitive' } } ] });
    for (const [param, field] of [['departmentId', 'departmentId'], ['programmeId', 'programmeId'], ['semester', 'semester']] as const) if (q[param]) and.push({ [field]: String(q[param]) } as Prisma.StudentWhereInput);
    const where: Prisma.StudentWhereInput = { AND: and };
    const orderKey = ['name', 'studentId', 'createdAt'].includes(q.sortBy) ? q.sortBy : 'name';
    const order = q.order === 'desc' ? 'desc' : 'asc';
    const [total, items] = await this.prisma.$transaction([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { [orderKey]: order }, include: { department: { select: { name: true } }, programme: { select: { name: true } }, scoreSnapshots: { orderBy: { calculatedAt: 'desc' }, take: 1 } } }),
    ]);
    return { items: items.map(s => ({ ...s, latestScore: s.scoreSnapshots[0] ?? null, scoreSnapshots: undefined })), page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }
  async create(actor: Actor, input: any) {
    const institutionId = this.institution(actor);
    if (!ADMIN_ROLES.includes(actor.role)) throw new ForbiddenException('Only institution or department administrators can create student records.');
    if (actor.role === Role.DEPARTMENT_ADMIN && input.departmentId !== actor.departmentId) throw new ForbiddenException('Department administrators can only add students to their assigned department.');
    const studentId = String(input.studentId ?? '').trim(); const name = String(input.name ?? '').trim();
    if (!studentId || !name) throw new BadRequestException('Student ID and name are required.');
    await this.validateReferences(institutionId, {
      campusId: input.campusId || null,
      departmentId: input.departmentId || null,
      programmeId: input.programmeId || null,
      advisorUserId: input.advisorUserId || null,
    });
    try {
      const student = await this.prisma.student.create({ data: {
        institutionId, studentId, name,
        institutionalEmail: input.institutionalEmail ? String(input.institutionalEmail).trim().toLowerCase() : null,
        phone: input.phone ? String(input.phone).trim() : null,
        campusId: input.campusId || null, departmentId: input.departmentId || null, programmeId: input.programmeId || null,
        semester: input.semester ? String(input.semester).trim() : null, section: input.section ? String(input.section).trim() : null,
        advisorUserId: input.advisorUserId || null,
      } });
      await this.prisma.auditLog.create({ data: { institutionId, userId: actor.id, action: 'STUDENT_CREATED', entityType: 'Student', entityId: student.id, afterValue: { studentId, name } } });
      return student;
    } catch (e: any) { if (e?.code === 'P2002') throw new ConflictException('A student with that ID already exists in this institution.'); throw e; }
  }
  async get(actor: Actor, id: string) {
    const where = this.scope(actor);
    const student = await this.prisma.student.findFirst({ where: { AND: [where, { id }] }, include: {
      department: { select: { id: true, name: true } }, programme: { select: { id: true, name: true } }, campus: { select: { id: true, name: true } },
      academicRecords: { orderBy: { recordedAt: 'desc' }, take: 20, include: { course: { select: { name: true, code: true } } } },
      attendanceRecords: { orderBy: { date: 'desc' }, take: 40 }, lmsActivities: { orderBy: { periodStart: 'desc' }, take: 12 },
      skills: { orderBy: { createdAt: 'desc' } }, placementAssessments: { orderBy: { assessedAt: 'desc' }, take: 10 },
      engagements: { orderBy: { date: 'desc' }, take: 20 }, feedback: { orderBy: { submittedAt: 'desc' }, take: 20 },
      scoreSnapshots: { orderBy: { calculatedAt: 'desc' }, take: 5 }, interventions: { orderBy: { createdAt: 'desc' }, take: 20 },
    } });
    if (!student) throw new NotFoundException('Student was not found in your permitted scope.');
    await this.prisma.auditLog.create({ data: { institutionId: student.institutionId, userId: actor.id, action: 'STUDENT_PROFILE_VIEWED', entityType: 'Student', entityId: student.id } });
    return student;
  }
  async score(actor: Actor, id: string) {
    const scoped = await this.prisma.student.findFirst({ where: { AND: [this.scope(actor), { id }] }, select: { id: true, institutionId: true } });
    if (!scoped) throw new NotFoundException('Student was not found in your permitted scope.');
    return this.scores.calculate(scoped.id, scoped.institutionId);
  }
  async update(actor: Actor, id: string, input: any) {
    const existing = await this.prisma.student.findFirst({ where: { AND: [this.scope(actor), { id }] } });
    if (!existing) throw new NotFoundException('Student was not found in your permitted scope.');
    if (!ADMIN_ROLES.includes(actor.role)) throw new ForbiddenException('Only authorized administrators can edit institutional student fields.');
    if (actor.role === Role.DEPARTMENT_ADMIN && existing.departmentId !== actor.departmentId) throw new ForbiddenException();
    if (actor.role === Role.DEPARTMENT_ADMIN && input.departmentId !== undefined && input.departmentId !== actor.departmentId) throw new ForbiddenException('Department administrators cannot move a student outside their department.');
    const allowed = ['name', 'institutionalEmail', 'phone', 'semester', 'section', 'departmentId', 'programmeId', 'campusId', 'advisorUserId', 'active'];
    const data: any = {};
    for (const k of allowed) if (input[k] !== undefined) data[k] = input[k];
    if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim())) throw new BadRequestException('Student name cannot be empty.');
    if (data.institutionalEmail !== undefined && data.institutionalEmail !== null) {
      if (typeof data.institutionalEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.institutionalEmail)) throw new BadRequestException('Institutional email is invalid.');
      data.institutionalEmail = data.institutionalEmail.trim().toLowerCase();
    }
    if (data.active !== undefined && typeof data.active !== 'boolean') throw new BadRequestException('Active must be a boolean.');
    await this.validateReferences(existing.institutionId, {
      campusId: data.campusId !== undefined ? data.campusId : existing.campusId,
      departmentId: data.departmentId !== undefined ? data.departmentId : existing.departmentId,
      programmeId: data.programmeId !== undefined ? data.programmeId : existing.programmeId,
      advisorUserId: data.advisorUserId !== undefined ? data.advisorUserId : existing.advisorUserId,
    });
    const updated = await this.prisma.student.update({ where: { id }, data });
    await this.prisma.$transaction([
      this.prisma.recordRevision.create({ data: { studentId: id, userId: actor.id, recordType: 'Student', recordId: id, beforeValue: existing as any, afterValue: updated as any } }),
      this.prisma.auditLog.create({ data: { institutionId: existing.institutionId, userId: actor.id, action: 'STUDENT_UPDATED', entityType: 'Student', entityId: id, beforeValue: existing as any, afterValue: updated as any } }),
    ]);
    return updated;
  }
}
