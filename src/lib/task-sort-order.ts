import { prisma } from "@/lib/prisma";

export async function nextSortOrderForStatus(status: string): Promise<number> {
  const agg = await prisma.task.aggregate({
    where: { status },
    _max: { sortOrder: true },
  });
  return (agg._max.sortOrder ?? -1) + 1;
}

export async function applyTaskOrderForStatus(
  status: string,
  taskIds: string[],
): Promise<void> {
  await prisma.$transaction(
    taskIds.map((id, index) =>
      prisma.task.update({
        where: { id },
        data: { sortOrder: index },
      }),
    ),
  );
}
