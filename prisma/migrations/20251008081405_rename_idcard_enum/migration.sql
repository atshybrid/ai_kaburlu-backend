/*
  Warnings:

  - The `status` column on the `IDCard` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `idCardStatus` column on the `Membership` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "public"."IdCardStatus" AS ENUM ('NOT_CREATED', 'GENERATED', 'REVOKED', 'EXPIRED');

-- AlterTable
ALTER TABLE "public"."IDCard" DROP COLUMN "status",
ADD COLUMN     "status" "public"."IdCardStatus" NOT NULL DEFAULT 'GENERATED';

-- AlterTable
ALTER TABLE "public"."Membership" DROP COLUMN "idCardStatus",
ADD COLUMN     "idCardStatus" "public"."IdCardStatus" NOT NULL DEFAULT 'NOT_CREATED';

-- DropEnum
DROP TYPE "public"."IDCardStatus";
