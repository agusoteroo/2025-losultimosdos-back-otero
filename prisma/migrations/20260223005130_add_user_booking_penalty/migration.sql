-- CreateTable
CREATE TABLE "public"."UserBookingPenalty" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "restrictedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBookingPenalty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserBookingPenalty_userId_key" ON "public"."UserBookingPenalty"("userId");

-- CreateIndex
CREATE INDEX "UserBookingPenalty_userId_idx" ON "public"."UserBookingPenalty"("userId");

-- CreateIndex
CREATE INDEX "UserBookingPenalty_restrictedUntil_idx" ON "public"."UserBookingPenalty"("restrictedUntil");
