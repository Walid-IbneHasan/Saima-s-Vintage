import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminUsersFormFilter } from './admin-users-form.filter';
import { AdminUsersService } from './admin-users.service';
import { AuditService } from './audit.service';
import { CreateUserDto, UpdateUserRoleDto } from './dto';

/**
 * Admin team management. Both ADMIN and STAFF (Moderator) can VIEW the team;
 * the method-level @Roles(ADMIN) on every mutation overrides the class-level
 * grant (RolesGuard uses getAllAndOverride), so a moderator who tries to add,
 * delete or re-role anyone is blocked server-side — not just hidden in the UI.
 */
@Controller('admin/users')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
@UseFilters(AdminUsersFormFilter)
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() me: AuthUser,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    res.render('admin/users/list', {
      title: 'Users',
      users: await this.users.list(),
      me,
      error,
    });
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const id = await this.users.create(dto);
    await this.audit.log({
      userId: user.id,
      action: 'user.create',
      entityType: 'User',
      entityId: id,
      after: { email: dto.email, role: dto.role },
      req,
    });
    res.redirect('/admin/users');
  }

  @Post(':id/role')
  @Roles(Role.ADMIN)
  async setRole(
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.users.setRole(id, dto.role as Role, user.id);
    await this.audit.log({
      userId: user.id,
      action: 'user.role',
      entityType: 'User',
      entityId: id,
      after: { role: dto.role },
      req,
    });
    res.redirect('/admin/users');
  }

  @Post(':id/delete')
  @Roles(Role.ADMIN)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.users.remove(id, user.id);
    await this.audit.log({
      userId: user.id,
      action: 'user.delete',
      entityType: 'User',
      entityId: id,
      req,
    });
    res.redirect('/admin/users');
  }
}
