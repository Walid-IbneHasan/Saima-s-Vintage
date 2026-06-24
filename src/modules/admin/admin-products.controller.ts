import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { buildPageMeta, parsePage } from '../../common/pagination';
import { AdminCategoriesService } from './admin-categories.service';
import { AdminProductsService } from './admin-products.service';
import { AuditService } from './audit.service';
import { ProductDto, VariantDto } from './dto';
import {
  UPLOAD_ALLOWED_MIME,
  UPLOAD_MAX_BYTES,
  UploadsService,
} from './uploads.service';

@Controller('admin/products')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class AdminProductsController {
  constructor(
    private readonly products: AdminProductsService,
    private readonly categories: AdminCategoriesService,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query('page') page: string, @Res() res: Response): Promise<void> {
    const params = parsePage(page, undefined, 20, 50);
    const { items, total } = await this.products.list(params);
    res.render('admin/products/list', {
      title: 'Products',
      products: items,
      meta: buildPageMeta(params.page, params.limit, total),
      basePath: '/admin/products?',
    });
  }

  @Get('new')
  async newForm(@Res() res: Response): Promise<void> {
    const categories = await this.categories.listForSelect();
    res.render('admin/products/form', {
      title: 'New product',
      product: null,
      categories,
      selectedCategoryIds: [],
    });
  }

  @Post()
  async create(
    @Body() dto: ProductDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    let id: string;
    try {
      id = await this.products.create(dto);
    } catch (e) {
      if (e instanceof BadRequestException) {
        const categories = await this.categories.listForSelect();
        return void res.status(400).render('admin/products/form', {
          title: 'New product',
          product: this.dtoToFormProduct(dto),
          categories,
          selectedCategoryIds: dto.categoryIds ?? [],
          error: e.message,
        });
      }
      throw e;
    }
    await this.audit.log({
      userId: user.id,
      action: 'product.create',
      entityType: 'Product',
      entityId: id,
      after: { name: dto.name },
      req,
    });
    res.redirect(`/admin/products/${id}/edit`);
  }

  @Get(':id/edit')
  async editForm(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const product = await this.products.getForEdit(id);
    if (!product) throw new NotFoundException('Product not found');
    const categories = await this.categories.listForSelect();
    res.render('admin/products/form', {
      title: `Edit: ${product.name}`,
      product,
      categories,
      selectedCategoryIds: product.categories.map((c) => c.categoryId),
    });
  }

  @Post(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: ProductDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      await this.products.update(id, dto);
    } catch (e) {
      if (e instanceof BadRequestException) {
        const existing = await this.products.getForEdit(id);
        const categories = await this.categories.listForSelect();
        return void res.status(400).render('admin/products/form', {
          title: existing ? `Edit: ${existing.name}` : 'Edit product',
          // Keep variants/images/id from the saved product, but show the values
          // the admin just submitted so they can fix the flagged field.
          product: { ...existing, ...this.dtoToFormProduct(dto), id },
          categories,
          selectedCategoryIds: dto.categoryIds ?? [],
          error: e.message,
        });
      }
      throw e;
    }
    await this.audit.log({
      userId: user.id,
      action: 'product.update',
      entityType: 'Product',
      entityId: id,
      after: { name: dto.name },
      req,
    });
    res.redirect(`/admin/products/${id}/edit`);
  }

  /** Shape a submitted DTO back into the fields the product form reads, so a
   *  validation error can re-render the form with the admin's input intact. */
  private dtoToFormProduct(dto: ProductDto): Record<string, unknown> {
    return {
      name: dto.name,
      slug: dto.slug,
      sku: dto.sku,
      shortDescription: dto.shortDescription,
      description: dto.description,
      brand: dto.brand,
      condition: dto.condition,
      basePrice: dto.basePrice,
      salePrice: dto.salePrice,
      flashPrice: dto.flashPrice,
      flashStartAt: dto.flashStartAt,
      flashEndAt: dto.flashEndAt,
      currency: dto.currency,
      isActive: dto.isActive,
      isFeatured: dto.isFeatured,
      allowBackorder: dto.allowBackorder,
      featuredOrder: dto.featuredOrder,
      minPerOrder: dto.minPerOrder,
      maxPerOrder: dto.maxPerOrder,
      seoTitle: dto.seoTitle,
      seoDescription: dto.seoDescription,
    };
  }

  @Post(':id/delete')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.products.remove(id);
    await this.audit.log({
      userId: user.id,
      action: 'product.delete',
      entityType: 'Product',
      entityId: id,
      req,
    });
    res.redirect('/admin/products');
  }

  // --- Variants -----------------------------------------------------------

  @Post(':id/variants')
  async addVariant(
    @Param('id') id: string,
    @Body() dto: VariantDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.products.addVariant(id, dto);
    await this.audit.log({
      userId: user.id,
      action: 'variant.create',
      entityType: 'ProductVariant',
      entityId: id,
      after: { sku: dto.sku },
      req,
    });
    res.redirect(`/admin/products/${id}/edit`);
  }

  @Post(':id/variants/:variantId')
  async updateVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() dto: VariantDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.products.updateVariant(variantId, dto);
    await this.audit.log({
      userId: user.id,
      action: 'variant.update',
      entityType: 'ProductVariant',
      entityId: variantId,
      req,
    });
    res.redirect(`/admin/products/${id}/edit`);
  }

  @Post(':id/variants/:variantId/delete')
  async deleteVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.products.removeVariant(variantId);
    await this.audit.log({
      userId: user.id,
      action: 'variant.delete',
      entityType: 'ProductVariant',
      entityId: variantId,
      req,
    });
    res.redirect(`/admin/products/${id}/edit`);
  }

  // --- Images -------------------------------------------------------------

  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('images', 12, {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (UPLOAD_ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException('Only image uploads are allowed'), false);
      },
    }),
  )
  async uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Choose at least one image to upload');
    }
    // Save sequentially so each image's position/isPrimary is assigned in order.
    for (const file of files) {
      const { url } = await this.uploads.saveProductImage(file);
      await this.products.addImage(id, url);
      await this.audit.log({
        userId: user.id,
        action: 'image.upload',
        entityType: 'Product',
        entityId: id,
        after: { url },
        req,
      });
    }
    res.redirect(`/admin/products/${id}/edit`);
  }

  @Post(':id/images/:imageId/delete')
  async deleteImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.products.removeImage(imageId);
    await this.audit.log({
      userId: user.id,
      action: 'image.delete',
      entityType: 'ProductImage',
      entityId: imageId,
      req,
    });
    res.redirect(`/admin/products/${id}/edit`);
  }
}
