import { Body, Controller, Get, ForbiddenException, ConflictException, Post, UnauthorizedException } from '@nestjs/common';
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import * as argon2 from 'argon2';
import { Role } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';

class SetupDto {
  @IsString() @MinLength(8) setupToken!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(12) @MaxLength(200) password!: string;
}
@Controller('setup')
export class SetupController {
  constructor(private prisma: PrismaService, private config: ConfigService) {}
  @Get('status') async status() {
    const count = await this.prisma.user.count({ where: { role: Role.SUPER_ADMIN } });
    return { setupRequired: count === 0 };
  }
  @Post('super-admin') async create(@Body() body: SetupDto) {
    const configured = this.config.get<string>('SETUP_TOKEN');
    if (!configured || configured === 'replace-with-a-one-time-setup-token' || body.setupToken !== configured) throw new UnauthorizedException('The one-time setup token is invalid.');
    if (!/[A-Z]/.test(body.password) || !/[a-z]/.test(body.password) || !/[0-9]/.test(body.password) || !/[^A-Za-z0-9]/.test(body.password)) throw new ForbiddenException('Password must include uppercase, lowercase, number, and symbol.');
    const email = body.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(body.password);
    try {
      // Serializable isolation prevents two first-run requests from both claiming the empty system.
      return await this.prisma.$transaction(async tx => {
        const count = await tx.user.count({ where: { role: Role.SUPER_ADMIN } });
        if (count > 0) throw new ConflictException('First-run setup is permanently locked because a Super Admin already exists.');
        if (await tx.user.findUnique({ where: { email } })) throw new ConflictException('An account with this email already exists.');
        const user = await tx.user.create({ data: { name: body.name.trim(), email, passwordHash, role: Role.SUPER_ADMIN } });
        await tx.auditLog.create({ data: { userId: user.id, action: 'FIRST_SUPER_ADMIN_CREATED', entityType: 'User', entityId: user.id } });
        return { success: true, message: 'Super Admin created. Sign in to create the first institution.', user: { id: user.id, name: user.name, email: user.email, role: user.role } };
      }, { isolationLevel: 'Serializable' });
    } catch (error: any) {
      if (error instanceof ConflictException) throw error;
      if (error?.code === 'P2002' || error?.code === 'P2034') throw new ConflictException('First-run setup was completed by another request. Sign in or refresh the page.');
      throw error;
    }
  }
}
