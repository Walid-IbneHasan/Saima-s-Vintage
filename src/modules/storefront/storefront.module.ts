import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { HomeController } from './home.controller';

@Module({
  imports: [CatalogModule],
  controllers: [HomeController],
})
export class StorefrontModule {}
