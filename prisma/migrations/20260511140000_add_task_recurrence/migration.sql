-- AlterTable
ALTER TABLE "Task" ADD COLUMN "recurrenceType" TEXT;
ALTER TABLE "Task" ADD COLUMN "recurrenceActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "recurrenceParentId" TEXT;
ALTER TABLE "Task" ADD COLUMN "recurrenceNextDate" DATETIME;

-- CreateIndex
CREATE INDEX "Task_recurrenceActive_recurrenceNextDate_idx" ON "Task"("recurrenceActive", "recurrenceNextDate");
