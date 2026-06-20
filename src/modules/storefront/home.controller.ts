import { Controller, Get, Render } from '@nestjs/common';
import { CategoriesService } from '../catalog/categories.service';
import { ProductsService } from '../catalog/products.service';

@Controller()
export class HomeController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
  ) {}

  @Get()
  @Render('pages/home')
  async home(): Promise<Record<string, unknown>> {
    const [featured, categories] = await Promise.all([
      this.products.featured(8),
      this.categories.listTopLevelWithImages(),
    ]);
    return {
      title: "Saima's Vintage — Curated Vintage Treasures",
      metaDescription:
        'Hand-picked vintage clothing, accessories and one-of-a-kind finds. Curated by Saima.',
      featured,
      categories,
    };
  }
}
