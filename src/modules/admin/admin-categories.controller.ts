import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminCategoriesService } from './admin-categories.service';
import { AuditService } from './audit.service';
import { CategoryDto } from './dto';

@Controller('admin/categories')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class AdminCategoriesController {
  constructor(
    private readonly categories: AdminCategoriesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Res() res: Response): Promise<void> {
    const categories = await this.categories.list();
    res.render('admin/categories/list', { title: 'Categories', categories });
  }

  @Get('new')
  async newForm(@Res() res: Response): Promise<void> {
    const parents = await this.categories.listForSelect();
    res.render('admin/categories/form', {
      title: 'New category',
      category: null,
      parents,
    });
  }

  @Post()
  async create(
    @Body() dto: CategoryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const id = await this.categories.create(dto);
    await this.audit.log({
      userId: user.id,
      action: 'category.create',
      entityType: 'Category',
      entityId: id,
      after: { name: dto.name },
      req,
    });
    res.redirect('/admin/categories');
  }

  @Get(':id/edit')
  async editForm(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const category = await this.categories.getForEdit(id);
    if (!category) throw new NotFoundException('Category not found');
    const parents = (await this.categories.listForSelect()).filter(
      (c) => c.id !== id,
    );
    res.render('admin/categories/form', {
      title: `Edit: ${category.name}`,
      category,
      parents,
    });
  }

  @Post(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: CategoryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.categories.update(id, dto);
    await this.audit.log({
      userId: user.id,
      action: 'category.update',
      entityType: 'Category',
      entityId: id,
      after: { name: dto.name },
      req,
    });
    res.redirect('/admin/categories');
  }

  @Post(':id/delete')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.categories.remove(id);
    await this.audit.log({
      userId: user.id,
      action: 'category.delete',
      entityType: 'Category',
      entityId: id,
      req,
    });
    res.redirect('/admin/categories');
  }
}
