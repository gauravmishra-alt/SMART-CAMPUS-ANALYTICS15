import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { JwtAuthGuard, Roles, RolesGuard } from '../common/security';
import { AiService } from './ai.service';

class StudentIdDto { @IsString() studentId!: string; }
class ChatDto { @IsString() @MinLength(1) @MaxLength(4000) message!: string; @IsOptional() @IsString() studentId?: string; @IsOptional() @IsString() conversationId?: string; }
@Controller('ai')
export class AiController {
  constructor(private service: AiService) {}
  @Get('health') health() { return this.service.health(); }
  @Post('summaries') @UseGuards(JwtAuthGuard) summary(@Req() req: any, @Body() body: StudentIdDto) { return this.service.summary(req.user, body.studentId); }
  @Post('recommendations/students/:id') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.INSTITUTION_ADMIN, Role.DEPARTMENT_ADMIN, Role.FACULTY, Role.ACADEMIC_ADVISOR, Role.PLACEMENT_COORDINATOR)
  recommendations(@Req() req: any, @Param('id') id: string) { return this.service.recommendations(req.user, id); }
  @Post('chat') @UseGuards(JwtAuthGuard) chat(@Req() req: any, @Body() body: ChatDto) { return this.service.chat(req.user, body.message, body.studentId, body.conversationId); }
  @Get('conversations') @UseGuards(JwtAuthGuard) list(@Req() req: any) { return this.service.listConversations(req.user); }
  @Delete('conversations/:id') @UseGuards(JwtAuthGuard) delete(@Req() req: any, @Param('id') id: string) { return this.service.deleteConversation(req.user, id); }
}
