import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminCategoriesService } from './admin-categories.service';
import { AdminFormExceptionFilter } from './admin-form-exception.filter';
import { AuditService } from './audit.service';
import { CategoryDto } from './dto';
import {
  UPLOAD_ALLOWED_MIME,
  UPLOAD_MAX_BYTES,
  UploadsService,
} from './uploads.service';

// Shared multer config for the optional category cover image.
const categoryImageInterceptor = FileInterceptor('image', {
  storage: memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (UPLOAD_ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new BadRequestException('Only image uploads are allowed'), false);
  },
});

@Controller('admin/categories')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class AdminCategoriesController {
  constructor(
    private readonly categories: AdminCategoriesService,
    private readonly uploads: UploadsService,
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
  @UseFilters(AdminFormExceptionFilter)
  @UseInterceptors(categoryImageInterceptor)
  async create(
    @Body() dto: CategoryDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const imageUrl = image ? (await this.uploads.saveCategoryImage(image)).url : undefined;
    const id = await this.categories.create(dto, imageUrl);
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
  @UseFilters(AdminFormExceptionFilter)
  @UseInterceptors(categoryImageInterceptor)
  async update(
    @Param('id') id: string,
    @Body() dto: CategoryDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const imageUrl = image ? (await this.uploads.saveCategoryImage(image)).url : undefined;
    await this.categories.update(id, dto, imageUrl);
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
