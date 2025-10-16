-- CreateEnum
CREATE TYPE "public"."CaseStatus" AS ENUM ('NEW', 'TRIAGED', 'IN_PROGRESS', 'LEGAL_REVIEW', 'ACTION_TAKEN', 'RESOLVED', 'REJECTED', 'CLOSED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "public"."CasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."CaseVisibility" AS ENUM ('PRIVATE', 'PUBLIC_LINK');

-- CreateEnum
CREATE TYPE "public"."LegalStatus" AS ENUM ('NOT_REQUIRED', 'ADVISED', 'FILED', 'IN_COURT');
