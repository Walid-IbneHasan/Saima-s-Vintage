-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `imageUrl` VARCHAR(191) NULL,
    ADD COLUMN `googleId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `CustomerOtp` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `type` ENUM('EMAIL_VERIFY', 'PASSWORD_RESET') NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CustomerOtp_customerId_type_idx`(`customerId`, `type`),
    INDEX `CustomerOtp_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Customer_googleId_key` ON `Customer`(`googleId`);

-- CreateIndex
CREATE UNIQUE INDEX `Review_productId_customerId_key` ON `Review`(`productId`, `customerId`);

-- AddForeignKey
ALTER TABLE `CustomerOtp` ADD CONSTRAINT `CustomerOtp_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
