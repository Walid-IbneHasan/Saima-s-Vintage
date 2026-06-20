/*
  Warnings:

  - You are about to drop the column `compareAtPrice` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `compareAtPrice` on the `ProductVariant` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Product` DROP COLUMN `compareAtPrice`,
    ADD COLUMN `featuredOrder` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `salePrice` DECIMAL(12, 2) NULL;

-- AlterTable
ALTER TABLE `ProductVariant` DROP COLUMN `compareAtPrice`,
    ADD COLUMN `salePrice` DECIMAL(12, 2) NULL;
