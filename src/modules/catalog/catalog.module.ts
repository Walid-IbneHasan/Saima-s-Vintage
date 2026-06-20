import { Module } from '@nestjs/common';
import { ReviewsModule } from '../reviews/reviews.module';
import { SeoModule } from '../seo/seo.module';
import { CatalogController } from './catalog.controller';
import { CategoriesService } from './categories.service';
import { CategoryNavService } from './category-nav.service';
import { ProductsService } from './products.service';
import { RedirectService } from './redirect.service';
import { SearchService } from './search.service';

@Module({
  imports: [SeoModule, ReviewsModule],
  controllers: [CatalogController],
  providers: [
    ProductsService,
    CategoriesService,
    CategoryNavService,
    SearchService,
    RedirectService,
  ],
  exports: [
    ProductsService,
    CategoriesService,
    CategoryNavService,
    SearchService,
    RedirectService,
  ],
})
export class CatalogModule {}
