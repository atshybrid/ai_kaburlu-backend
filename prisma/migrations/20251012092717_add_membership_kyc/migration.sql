-- CreateTable
CREATE TABLE "public"."MembershipKyc" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "aadhaarNumber" TEXT,
    "aadhaarFrontUrl" TEXT,
    "aadhaarBackUrl" TEXT,
    "panNumber" TEXT,
    "panCardUrl" TEXT,
    "llbRegistrationNumber" TEXT,
    "llbSupportDocUrl" TEXT,
    "status" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipKyc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipKyc_membershipId_key" ON "public"."MembershipKyc"("membershipId");

-- AddForeignKey
ALTER TABLE "public"."MembershipKyc" ADD CONSTRAINT "MembershipKyc_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
