/** Shared include + task shape for list/detail (matches Prisma Task + assignee). */
export const taskListInclude = {
  assignee: { select: { id: true, login: true } },
  createdBy: { select: { id: true, login: true } },
  _count: {
    select: { comments: true },
  },
} as const;

export type TaskListItem = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  effort: number;
  dueDate: Date | null;
  eventAt: Date | string | null;
  weekStart: Date | string | null;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  createdById: string | null;
  assigneeId: string | null;
  assignee: { id: string; login: string } | null;
  createdBy: { id: string; login: string } | null;
  recurrenceType?: string | null;
  recurrenceIntervalDays?: number | null;
  recurrenceActive?: boolean;
  recurrenceParentId?: string | null;
  recurrenceNextDate?: Date | string | null;
  _count?: {
    comments: number;
  };
};
