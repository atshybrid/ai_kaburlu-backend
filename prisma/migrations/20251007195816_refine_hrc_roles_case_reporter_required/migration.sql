/*
  Warnings:

  - You are about to drop the column `role` on the `HrcTeamMember` table. All the data in the column will be lost.
  - Made the column `reporterId` on table `HrcCase` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "public"."HrcTeamMemberRole" AS ENUM ('MEMBER', 'COORDINATOR', 'ADMIN');

-- DropForeignKey
ALTER TABLE "public"."HrcCase" DROP CONSTRAINT "HrcCase_reporterId_fkey";

-- AlterTable
ALTER TABLE "public"."HrcCase" ALTER COLUMN "reporterId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."HrcTeamMember" DROP COLUMN "role",
ADD COLUMN     "membershipRole" "public"."HrcTeamMemberRole" NOT NULL DEFAULT 'MEMBER';

-- AddForeignKey
ALTER TABLE "public"."HrcCase" ADD CONSTRAINT "HrcCase_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "public"."HrcVolunteerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
