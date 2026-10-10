import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../common/security';
import { StudentsService } from './students.service';

class CreateStudentDto {
  @IsString() @MinLength(1) @MaxLength(80) studentId!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsEmail() institutionalEmail?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() programmeId?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() semester?: string;
  @IsOptional() @IsString() section?: string;
  @IsOptional() @IsString() advisorUserId?: string;
}
@Controller('students')
@UseGuards(JwtAuthGuard)
export class StudentsController {
  constructor(private service: StudentsService) {}
  @Get() list(@Req() req: any, @Query() q: any) { return this.service.list(req.user, q); }
  @Post() create(@Req() req: any, @Body() body: CreateStudentDto) { return this.service.create(req.user, body); }
  @Get(':id/success-score') score(@Req() req: any, @Param('id') id: string) { return this.service.score(req.user, id); }
  @Get(':id') get(@Req() req: any, @Param('id') id: string) { return this.service.get(req.user, id); }
  @Patch(':id') update(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.update(req.user, id, body); }
}
