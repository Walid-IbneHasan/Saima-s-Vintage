-- DropForeignKey
ALTER TABLE `SslcommerzSession` DROP FOREIGN KEY `SslcommerzSession_orderId_fkey`;

-- DropIndex
DROP INDEX `Payment_valId_idx` ON `Payment`;

-- AlterTable
ALTER TABLE `Payment` DROP COLUMN `bankTranId`,
    DROP COLUMN `cardIssuer`,
    DROP COLUMN `cardType`,
    DROP COLUMN `riskLevel`,
    DROP COLUMN `riskTitle`,
    DROP COLUMN `storeAmount`,
    DROP COLUMN `valId`,
    ADD COLUMN `bkashPaymentID` VARCHAR(191) NULL,
    ADD COLUMN `bkashTrxID` VARCHAR(191) NULL,
    ADD COLUMN `payerAccount` VARCHAR(32) NULL,
    MODIFY `provider` VARCHAR(32) NOT NULL DEFAULT 'bkash';

-- DropTable
DROP TABLE `SslcommerzSession`;

-- CreateIndex
CREATE UNIQUE INDEX `Payment_bkashPaymentID_key` ON `Payment`(`bkashPaymentID`);
