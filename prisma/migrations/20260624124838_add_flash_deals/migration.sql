-- AlterTable
ALTER TABLE `Product` ADD COLUMN `flashEndAt` DATETIME(3) NULL,
    ADD COLUMN `flashPrice` DECIMAL(12, 2) NULL,
    ADD COLUMN `flashStartAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Product_flashEndAt_idx` ON `Product`(`flashEndAt`);
