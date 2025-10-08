/*
  Warnings:

  - The `paymentStatus` column on the `Membership` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `MembershipPayment` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "public"."MembershipPaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- AlterTable
ALTER TABLE "public"."Membership" DROP COLUMN "paymentStatus",
ADD COLUMN     "paymentStatus" "public"."MembershipPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- AlterTable
ALTER TABLE "public"."MembershipPayment" DROP COLUMN "status",
ADD COLUMN     "status" "public"."MembershipPaymentStatus" NOT NULL DEFAULT 'PENDING';

-- DropEnum
DROP TYPE "public"."PaymentStatus";
