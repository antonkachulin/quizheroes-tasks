-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" INTEGER NOT NULL,
    "effort" INTEGER NOT NULL,
    "dueDate" DATETIME,
    "weekStart" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "assigneeId" TEXT,
    CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeId", "createdAt", "description", "dueDate", "effort", "id", "priority", "status", "title", "updatedAt", "userId", "weekStart")
SELECT
    "assigneeId",
    "createdAt",
    "description",
    "dueDate",
    "effort",
    "id",
    "priority",
    "status",
    "title",
    "updatedAt",
    "userId",
    COALESCE(
        datetime(date("createdAt", '-' || (
            (CAST(strftime('%w', "createdAt") AS INTEGER) + 6) % 7
        ) || ' days') || ' 00:00:00'),
        "createdAt"
    )
FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
