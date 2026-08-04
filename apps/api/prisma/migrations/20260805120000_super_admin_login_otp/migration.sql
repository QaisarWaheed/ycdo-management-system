-- CreateTable
CREATE TABLE "LoginOtpChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "sentTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginOtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginOtpChallenge_userId_idx" ON "LoginOtpChallenge"("userId");

-- CreateIndex
CREATE INDEX "LoginOtpChallenge_expiresAt_idx" ON "LoginOtpChallenge"("expiresAt");

-- AddForeignKey
ALTER TABLE "LoginOtpChallenge" ADD CONSTRAINT "LoginOtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
