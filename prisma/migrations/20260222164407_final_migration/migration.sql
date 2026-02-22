-- CreateEnum
CREATE TYPE "public"."BookingStatus" AS ENUM ('RESERVED', 'ATTENDED', 'ABSENT', 'CANCELLED', 'WAITLIST');

-- CreateTable
CREATE TABLE "public"."Booking" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "public"."BookingStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "promotedFromWaitlistAt" TIMESTAMP(3),

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WaitlistEntry" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserNoShowMonthly" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "monthStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNoShowMonthly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Booking_userId_idx" ON "public"."Booking"("userId");

-- CreateIndex
CREATE INDEX "Booking_classId_status_idx" ON "public"."Booking"("classId", "status");

-- CreateIndex
CREATE INDEX "WaitlistEntry_classId_createdAt_idx" ON "public"."WaitlistEntry"("classId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_classId_userId_key" ON "public"."WaitlistEntry"("classId", "userId");

-- CreateIndex
CREATE INDEX "UserNoShowMonthly_userId_idx" ON "public"."UserNoShowMonthly"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNoShowMonthly_userId_monthStart_key" ON "public"."UserNoShowMonthly"("userId", "monthStart");

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_classId_fkey" FOREIGN KEY ("classId") REFERENCES "public"."Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_classId_fkey" FOREIGN KEY ("classId") REFERENCES "public"."Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
