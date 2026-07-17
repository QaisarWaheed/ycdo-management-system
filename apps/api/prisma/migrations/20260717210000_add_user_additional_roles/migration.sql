-- CreateTable
CREATE TABLE "UserAdditionalRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAdditionalRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAdditionalRole_userId_idx" ON "UserAdditionalRole"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAdditionalRole_userId_role_key" ON "UserAdditionalRole"("userId", "role");

-- AddForeignKey
ALTER TABLE "UserAdditionalRole" ADD CONSTRAINT "UserAdditionalRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
