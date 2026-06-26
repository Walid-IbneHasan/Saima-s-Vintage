import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminCategoriesService } from './admin-categories.service';
import { AdminProductsService } from './admin-products.service';

/**
 * Safety net for the admin product/category create/update forms. A validation
 * failure is thrown by the global ValidationPipe *before* the controller runs,
 * so the controller's own try/catch can't see it. Without this, the admin would
 * get the generic error page. Applied via @UseFilters on those four handlers, it
 * re-renders the originating form with the submitted values and the error, so the
 * admin can simply fix the flagged field.
 */
@Injectable()
@Catch(BadRequestException)
export class AdminFormExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly categories: AdminCategoriesService,
    private readonly products: AdminProductsService,
  ) {}

  async catch(exception: BadRequestException, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const error = this.readMessage(exception);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (req.body ?? {}) as Record<string, any>;

    if (req.path.startsWith('/admin/categories')) {
      const id = this.idFrom(req.path, 'categories');
      const parents = (await this.categories.listForSelect()).filter((c) => c.id !== id);
      res.status(400).render('admin/categories/form', {
        title: id ? 'Edit category' : 'New category',
        category: id ? { ...body, id } : body,
        parents,
        error,
      });
      return;
    }

    // products
    const id = this.idFrom(req.path, 'products');
    const categories = await this.categories.listForSelect();
    let product: Record<string, unknown> = { ...body };
    if (id) {
      // Keep the saved variants/images while showing the submitted field values.
      const existing = await this.products.getForEdit(id);
      product = { ...existing, ...body, id };
    }
    res.status(400).render('admin/products/form', {
      title: id ? 'Edit product' : 'New product',
      product,
      categories,
      selectedCategoryIds: ([] as string[]).concat(body.categoryIds ?? []),
      error,
    });
  }

  /** Pull a readable message out of a class-validator / Nest BadRequestException. */
  private readMessage(ex: BadRequestException): string {
    const r = ex.getResponse();
    if (typeof r === 'string') return r;
    const m = (r as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join('. ');
    if (typeof m === 'string') return m;
    return ex.message;
  }

  /** The id segment for an update route (`/admin/<kind>/<id>`), else undefined. */
  private idFrom(path: string, kind: string): string | undefined {
    const m = path.match(new RegExp(`^/admin/${kind}/([^/]+)$`));
    return m ? m[1] : undefined;
  }
}
