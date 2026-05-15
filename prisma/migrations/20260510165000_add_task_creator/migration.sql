-- Add optional creator link for tasks.
ALTER TABLE "Task" ADD COLUMN "createdById" TEXT;

-- Create FK so deleted users don't break historical tasks.
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" INTEGER NOT NULL,
    "effort" INTEGER NOT NULL,
    "dueDate" DATETIME,
    "eventAt" DATETIME,
    "weekStart" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT,
    "assigneeId" TEXT,
    CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("id", "title", "description", "status", "priority", "effort", "dueDate", "eventAt", "weekStart", "createdAt", "updatedAt", "userId", "createdById", "assigneeId")
SELECT "id", "title", "description", "status", "priority", "effort", "dueDate", "eventAt", "weekStart", "createdAt", "updatedAt", "userId", "createdById", "assigneeId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
