import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { read, utils } from 'xlsx';
import { IsIn, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../common/security';

const HEADERS = ['studentId', 'name', 'institutionalEmail', 'departmentId', 'programmeId', 'campusId', 'semester', 'section', 'phone'];
const text = (v: any) => String(v ?? '').trim();
class CommitDto { @IsString() importId!: string; @IsString() @IsIn(['skip', 'overwrite', 'merge']) strategy!: 'skip' | 'overwrite' | 'merge'; }

@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN)
export class ImportsController {
  constructor(private prisma: PrismaService) {}
  private scope(req: any) {
    if (!req.user.institutionId) throw new ForbiddenException('Institution scope is required.');
    return { institutionId: req.user.institutionId, departmentId: req.user.role === Role.DEPARTMENT_ADMIN ? req.user.departmentId : null };
  }
  @Get('students/template') template(@Req() req: any) {
    this.scope(req);
    return { filename: 'students-import-template.csv', contentType: 'text/csv', content: HEADERS.join(',') + '\n', headers: HEADERS };
  }
  @Post('students/preview')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => {
    const filename = String(file.originalname || '').toLowerCase();
    if (!filename.endsWith('.csv') && !filename.endsWith('.xlsx')) return cb(new BadRequestException('Upload a .csv or .xlsx file.'), false);
    cb(null, true);
  } }))
  async preview(@Req() req: any, @UploadedFile() file?: Express.Multer.File) {
    const scope = this.scope(req);
    if (!file?.buffer?.length) throw new BadRequestException('Choose a CSV or XLSX file to preview.');
    let rows: any[];
    try {
      const workbook = read(file.buffer, { type: 'buffer', cellDates: false, dense: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('No worksheet found');
      rows = utils.sheet_to_json(sheet, { defval: '', raw: false, blankrows: false });
    } catch { throw new BadRequestException('The file could not be read. Download the blank template and try again.'); }
    if (!rows.length) throw new BadRequestException('The file has a header but no data rows.');
    if (rows.length > 10000) throw new BadRequestException('Import is limited to 10,000 rows per file.');
    const keys = Object.keys(rows[0] || {});
    const missingHeaders = ['studentId', 'name'].filter(k => !keys.includes(k));
    if (missingHeaders.length) throw new BadRequestException(`Missing required columns: ${missingHeaders.join(', ')}. Use the blank template for exact column names.`);
    const seen = new Set<string>();
    const normalized = rows.map((raw, i) => {
      const row: any = {}; for (const h of HEADERS) row[h] = text(raw[h]);
      const errors: string[] = [];
      if (!row.studentId) errors.push('Student ID is required.');
      if (!row.name) errors.push('Name is required.');
      if (row.institutionalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.institutionalEmail)) errors.push('Institutional email is invalid.');
      const key = row.studentId.toLowerCase();
      if (key && seen.has(key)) errors.push('Student ID is duplicated within this file.');
      if (key) seen.add(key);
      if (scope.departmentId && row.departmentId && row.departmentId !== scope.departmentId) errors.push('Department admins can only import students into their assigned department.');
      return { rowNumber: i + 2, raw, normalized: row, errors };
    });
    const ids = [...new Set(normalized.map(r => r.normalized.studentId).filter(Boolean))];
    const existing = await this.prisma.student.findMany({ where: { institutionId: scope.institutionId, studentId: { in: ids } }, select: { id: true, studentId: true, name: true } });
    const existingById = new Map(existing.map(s => [s.studentId.toLowerCase(), s]));
    for (const row of normalized) if (existingById.has(row.normalized.studentId.toLowerCase())) row.errors.push('Student ID already exists; choose an import strategy at commit.');
    const importRecord = await this.prisma.dataImport.create({ data: {
      institutionId: scope.institutionId, userId: req.user.id, filename: file.originalname.slice(0, 255), dataType: 'students', status: 'PREVIEWED',
      rowCount: normalized.length, acceptedCount: normalized.filter(r => !r.errors.some(e => !e.includes('already exists'))).length,
      invalidCount: normalized.filter(r => r.errors.some(e => !e.includes('already exists'))).length,
      resultSummary: { missingHeaders, existingMatches: existing.length },
      rows: { create: normalized.map(r => ({ rowNumber: r.rowNumber, rawData: r.raw as any, normalizedData: r.normalized as any, errors: r.errors as any, rowStatus: r.errors.some(e => !e.includes('already exists')) ? 'INVALID' : 'READY', studentDbId: existingById.get(r.normalized.studentId.toLowerCase())?.id })) },
    } });
    return { importId: importRecord.id, filename: file.originalname, totalRows: normalized.length, readyRows: normalized.filter(r => !r.errors.some(e => !e.includes('already exists'))).length, invalidRows: normalized.filter(r => r.errors.some(e => !e.includes('already exists'))).length, existingMatches: existing.length, columns: keys, rows: normalized.map(r => ({ rowNumber: r.rowNumber, values: r.normalized, errors: r.errors, exists: existingById.has(r.normalized.studentId.toLowerCase()) })), strategyOptions: ['skip', 'overwrite', 'merge'], note: 'Preview only; no student records have been changed.' };
  }
  @Post('students/commit') async commit(@Req() req: any, @Body() body: CommitDto) {
    const scope = this.scope(req);
    const imp = await this.prisma.dataImport.findFirst({ where: { id: body.importId, institutionId: scope.institutionId, userId: req.user.id }, include: { rows: { orderBy: { rowNumber: 'asc' } } } });
    if (!imp) throw new BadRequestException('Import preview not found for your account. Preview the file again.');
    if (imp.status === 'COMPLETED') throw new BadRequestException('This import has already been committed.');
    let created = 0, updated = 0, skipped = 0, invalid = 0;
    for (const r of imp.rows) {
      const data: any = r.normalizedData || {};
      const errors: string[] = Array.isArray(r.errors) ? r.errors as string[] : [];
      const substantiveErrors = errors.filter(e => !e.toLowerCase().includes('already exists'));
      if (substantiveErrors.length || !text(data.studentId) || !text(data.name)) { invalid++; continue; }
      if (scope.departmentId && text(data.departmentId) && data.departmentId !== scope.departmentId) { invalid++; continue; }
      for (const [field, model] of [['departmentId', 'department'], ['programmeId', 'programme'], ['campusId', 'campus']] as const) {
        if (text(data[field])) {
          const exists = await (this.prisma as any)[model].findFirst({ where: { id: data[field], institutionId: scope.institutionId }, select: { id: true } });
          if (!exists) { substantiveErrors.push(`${field} is not in this institution.`); }
        }
      }
      if (substantiveErrors.length) { invalid++; await this.prisma.dataImportRow.update({ where: { id: r.id }, data: { rowStatus: 'INVALID', errors: substantiveErrors as any } }); continue; }
      const existing = await this.prisma.student.findFirst({ where: { institutionId: scope.institutionId, studentId: text(data.studentId) } });
      const fields = ['institutionalEmail', 'departmentId', 'programmeId', 'campusId', 'semester', 'section', 'phone'];
      if (existing) {
        if (scope.departmentId && existing.departmentId !== scope.departmentId) {
          invalid++;
          await this.prisma.dataImportRow.update({ where: { id: r.id }, data: { rowStatus: 'INVALID', errors: ['Existing student record is outside your assigned department.'] as any } });
          continue;
        }
        if (body.strategy === 'skip') { skipped++; await this.prisma.dataImportRow.update({ where: { id: r.id }, data: { rowStatus: 'SKIPPED', studentDbId: existing.id } }); continue; }
        const update: any = { name: text(data.name) || existing.name };
        for (const field of fields) if (text(data[field]) && (body.strategy === 'overwrite' || !text((existing as any)[field]))) update[field] = text(data[field]);
        await this.prisma.student.update({ where: { id: existing.id }, data: update });
        await this.prisma.dataImportRow.update({ where: { id: r.id }, data: { rowStatus: 'UPDATED', studentDbId: existing.id } }); updated++;
      } else {
        const student = await this.prisma.student.create({ data: {
          institutionId: scope.institutionId, studentId: text(data.studentId), name: text(data.name),
          institutionalEmail: text(data.institutionalEmail) || null, departmentId: text(data.departmentId) || null, programmeId: text(data.programmeId) || null,
          campusId: text(data.campusId) || null, semester: text(data.semester) || null, section: text(data.section) || null, phone: text(data.phone) || null,
        } });
        await this.prisma.dataImportRow.update({ where: { id: r.id }, data: { rowStatus: 'CREATED', studentDbId: student.id } }); created++;
      }
    }
    await this.prisma.dataImport.update({ where: { id: imp.id }, data: { status: 'COMPLETED', strategy: body.strategy, acceptedCount: created + updated, invalidCount: invalid, resultSummary: { created, updated, skipped, invalid } } });
    await this.prisma.auditLog.create({ data: { institutionId: scope.institutionId, userId: req.user.id, action: 'STUDENT_IMPORT_COMMITTED', entityType: 'DataImport', entityId: imp.id, afterValue: { created, updated, skipped, invalid, strategy: body.strategy } } });
    return { importId: imp.id, status: 'COMPLETED', created, updated, skipped, invalid };
  }
  @Get('history') async history(@Req() req: any) {
    const scope = this.scope(req);
    return this.prisma.dataImport.findMany({ where: { institutionId: scope.institutionId, ...(scope.departmentId ? { userId: req.user.id } : {}) }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, filename: true, dataType: true, status: true, strategy: true, rowCount: true, acceptedCount: true, invalidCount: true, resultSummary: true, createdAt: true, user: { select: { name: true, email: true } } } });
  }
  @Get(':id') async details(@Req() req: any, @Param('id') id: string) {
    const scope = this.scope(req);
    const item = await this.prisma.dataImport.findFirst({ where: { id, institutionId: scope.institutionId, ...(scope.departmentId ? { userId: req.user.id } : {}) }, include: { rows: { orderBy: { rowNumber: 'asc' } } } });
    if (!item) throw new BadRequestException('Import history record not found.');
    return item;
  }
}
