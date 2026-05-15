"use client";

import type { TaskListItem } from "@/lib/task-list";
import {
  formatWeekRangeLabel,
  shiftUtcMondayKey,
  utcMondayKeyContaining,
} from "@/lib/week";
import type { DragEvent, FormEvent, KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TASK_STATUSES = ["backlog", "todo", "in_progress", "done"] as const;

const REVIEW_CARRY_STATUSES: readonly string[] = ["todo", "in_progress"];

function sprintTaskBelongsToWeek(
  task: TaskListItem,
  selectedMondayKey: string,
): boolean {
  if (task.weekStart == null) return false;
  const d =
    typeof task.weekStart === "string"
      ? new Date(task.weekStart)
      : task.weekStart;
  if (Number.isNaN(d.getTime())) return false;
  return utcMondayKeyContaining(d) === selectedMondayKey;
}

const COLUMN_LABELS: Record<(typeof TASK_STATUSES)[number], string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "В работе",
  done: "Сделано",
};

const TASK_PRIORITIES = [1, 2, 3, 4, 5] as const;

const TASK_EFFORTS = [1, 2, 3, 5, 8, 13] as const;

const SORT_OPTIONS = [
  { value: "newest", label: "newest" },
  { value: "oldest", label: "oldest" },
  { value: "by_status", label: "by status" },
] as const;

function cx(...parts: (string | false | undefined | null)[]) {
  return parts.filter(Boolean).join(" ");
}

const DESCRIPTION_URL_RE = /https?:\/\/[^\s]+/gi;

function splitUrlAndTrailingPunctuation(raw: string): { href: string; tail: string } {
  let href = raw;
  let tail = "";
  while (href.length > 0 && ".,;:!?".includes(href[href.length - 1]!)) {
    tail = href[href.length - 1]! + tail;
    href = href.slice(0, -1);
  }
  return { href, tail };
}

function renderDescriptionWithLinks(text: string): ReactNode {
  const content = text.trim();
  if (!content) {
    return "—";
  }

  const nodes: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(DESCRIPTION_URL_RE.source, DESCRIPTION_URL_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const start = m.index;
    if (start > last) {
      nodes.push(content.slice(last, start));
    }
    const raw = m[0];
    const { href, tail } = splitUrlAndTrailingPunctuation(raw);
    if (href) {
      nodes.push(
        <a
          key={`url-${start}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-amber-400 underline decoration-amber-500/50 underline-offset-2 hover:text-amber-300"
        >
          {href}
        </a>,
      );
    }
    if (tail) {
      nodes.push(tail);
    }
    last = start + raw.length;
  }
  if (last < content.length) {
    nodes.push(content.slice(last));
  }

  return <>{nodes}</>;
}

const CHAT_URL_RE = /https?:\/\/[^\s]+/gi;

function renderChatMessageLinks(text: string, messageId: string): ReactNode {
  const nodes: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(CHAT_URL_RE.source, CHAT_URL_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    if (start > last) {
      nodes.push(text.slice(last, start));
    }
    const raw = m[0];
    const { href, tail } = splitUrlAndTrailingPunctuation(raw);
    if (href) {
      nodes.push(
        <a
          key={`${messageId}-url-${start}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-sky-400 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-300"
        >
          {href}
        </a>,
      );
    }
    if (tail) {
      nodes.push(tail);
    }
    last = start + raw.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return <>{nodes}</>;
}

type ChatRow = {
  id: string;
  text: string;
  createdAt: string;
  userId: string;
  user: { login: string };
};

const CHAT_QUICK_EMOJIS = [
  "😀",
  "😄",
  "😂",
  "❤️",
  "👍",
  "👎",
  "🔥",
  "🎉",
  "👀",
  "✅",
  "❌",
  "🙏",
  "🤔",
  "😎",
  "😭",
] as const;

const btnChatPrimarySm =
  "inline-flex shrink-0 items-center justify-center rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-zinc-950 shadow transition hover:bg-amber-400 disabled:pointer-events-none disabled:opacity-50";

const btnChatGhostSm =
  "inline-flex shrink-0 items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-700";

function TasksChatPanel() {
  const [open, setOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/messages");
      if (!res.ok) {
        setError("Не удалось загрузить сообщения");
        return;
      }
      const data = (await res.json()) as { messages: ChatRow[] };
      setMessages(data.messages ?? []);
    } catch {
      setError("Не удалось загрузить сообщения");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadMessages();
  }, [open, loadMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, open, scrollToBottom]);

  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    if (!el) {
      setDraft((d) => d + emoji);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setDraft((prev) => prev.slice(0, start) + emoji + prev.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Не удалось отправить");
        return;
      }
      setDraft("");
      setEmojiOpen(false);
      await loadMessages();
    } catch {
      setError("Не удалось отправить");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[85] flex flex-col items-end gap-2">
      {open ? (
        <div className="pointer-events-auto flex max-h-[min(28rem,calc(100vh-5rem))] w-[min(100vw-2rem,22rem)] flex-col overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-950/98 shadow-2xl shadow-black/50 ring-1 ring-zinc-800/80 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-3 py-2">
            <span className="text-sm font-semibold text-zinc-100">
              Командный чат
            </span>
            <button
              type="button"
              className={btnChatGhostSm}
              aria-label="Свернуть чат"
              onClick={() => {
                setOpen(false);
                setEmojiOpen(false);
              }}
            >
              Свернуть
            </button>
          </div>

          <div
            ref={listRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
          >
            {loading && messages.length === 0 ? (
              <p className="text-center text-xs text-zinc-500">Загрузка…</p>
            ) : messages.length === 0 ? (
              <p className="text-center text-xs text-zinc-500">
                Пока нет сообщений
              </p>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
                    <span className="font-semibold text-amber-400/95">
                      {msg.user.login}
                    </span>
                    <span className="tabular-nums text-zinc-500">
                      {new Date(msg.createdAt).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug text-zinc-200 [overflow-wrap:anywhere]">
                    {renderChatMessageLinks(msg.text, msg.id)}
                  </div>
                </div>
              ))
            )}
          </div>

          {error ? (
            <p className="border-t border-zinc-800/80 px-3 py-1.5 text-xs text-red-400">
              {error}
            </p>
          ) : null}

          <div className="relative border-t border-zinc-800 bg-zinc-900/90 p-2">
            <div className="relative mb-2 flex gap-1.5">
              <textarea
                ref={textareaRef}
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Сообщение…"
                className="min-w-0 flex-1 resize-none rounded-lg border border-zinc-600 bg-zinc-950/80 px-2.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/45 focus:outline-none focus:ring-1 focus:ring-amber-500/25"
              />
              <button
                type="button"
                className={cx(
                  btnChatGhostSm,
                  "size-[2.625rem] shrink-0 items-center justify-center px-0 py-0 text-xl leading-none",
                  emojiOpen && "border-amber-500/50 bg-zinc-700",
                )}
                aria-label="Выбрать эмодзи"
                aria-expanded={emojiOpen}
                onClick={() => setEmojiOpen((o) => !o)}
              >
                😀
              </button>
              {emojiOpen ? (
                <div
                  className="absolute bottom-full right-0 z-20 mb-1 max-h-[min(12rem,40vh)] w-[11.5rem] overflow-y-auto rounded-lg border border-zinc-600 bg-zinc-950 p-2 shadow-xl ring-1 ring-zinc-800"
                  role="listbox"
                  aria-label="Быстрые эмодзи"
                >
                  <div className="grid grid-cols-5 gap-0.5">
                    {CHAT_QUICK_EMOJIS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        role="option"
                        className="flex size-8 items-center justify-center rounded-md text-lg leading-none hover:bg-zinc-800"
                        onClick={() => insertEmoji(em)}
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                className={btnChatPrimarySm}
                disabled={sending || !draft.trim()}
                onClick={() => void handleSend()}
              >
                {sending ? "…" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className={cx(
          "pointer-events-auto rounded-full border border-zinc-600 bg-zinc-900/95 px-4 py-2.5 text-sm font-semibold text-zinc-100 shadow-lg shadow-black/40 ring-1 ring-zinc-700/80 transition hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-100",
        )}
        aria-expanded={open}
        aria-label={open ? "Скрыть чат" : "Открыть чат"}
        onClick={() =>
          setOpen((o) => {
            const next = !o;
            if (!next) setEmojiOpen(false);
            return next;
          })
        }
      >
        Чат
      </button>
    </div>
  );
}

const fieldLabelClass =
  "mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400";

const fieldInputClass =
  "w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 shadow-inner placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20";

const fieldSelectClass =
  "w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20";

/** Компактная панель недели: маленькие квадратные стрелки */
const weekNavArrowBtnClass =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-600 bg-zinc-800 text-sm leading-none text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700";

const weekSelectClass =
  "min-w-0 w-[min(100%,16rem)] max-w-full rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20 sm:w-64";

const btnPrimaryClass =
  "inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow transition hover:bg-amber-400 disabled:pointer-events-none disabled:opacity-50";

const btnSecondaryClass =
  "inline-flex items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700";

const btnDangerClass =
  "inline-flex items-center justify-center rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:border-red-800 hover:bg-red-950/70";

type TaskModalCommentRow = {
  id: string;
  text: string;
  createdAt: string;
  userId: string;
  user: { login: string };
};

function TaskModalCommentsSection({
  comments,
  loading,
  error,
  draft,
  onDraftChange,
  sending,
  onSubmit,
}: {
  comments: TaskModalCommentRow[];
  loading: boolean;
  error: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  sending: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-8 border-t border-zinc-800 pt-6">
      <h3 className="text-sm font-semibold text-zinc-100">Комментарии</h3>
      {error ? (
        <p className="mt-2 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}
      <div className="mt-3 max-h-52 space-y-3 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-3">
        {loading && comments.length === 0 ? (
          <p className="text-center text-xs text-zinc-500">Загрузка…</p>
        ) : comments.length === 0 ? (
          <p className="text-center text-xs text-zinc-500">
            Пока нет комментариев
          </p>
        ) : (
          comments.map((c) => (
            <div
              key={c.id}
              className="border-b border-zinc-800/80 pb-3 last:border-0 last:pb-0"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
                <span className="font-semibold text-amber-400/95">
                  {c.user.login}
                </span>
                <span className="tabular-nums text-zinc-500">
                  {new Date(c.createdAt).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug text-zinc-200 [overflow-wrap:anywhere]">
                {renderChatMessageLinks(c.text, c.id)}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-4">
        <label htmlFor="task-modal-comment" className={fieldLabelClass}>
          Новый комментарий
        </label>
        <textarea
          id="task-modal-comment"
          rows={3}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Текст комментария…"
          className={cx(fieldInputClass, "mt-1 min-h-[72px] resize-y")}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className={btnPrimaryClass}
            disabled={sending || !draft.trim()}
            onClick={() => onSubmit()}
          >
            {sending ? "…" : "Отправить"}
          </button>
        </div>
      </div>
    </div>
  );
}

function priorityBadgeClass(priority: number): string {
  if (priority === 5) {
    return "inline-flex rounded-full border border-red-500/45 bg-red-950/70 px-2 py-0.5 text-xs font-semibold text-red-300";
  }
  if (priority === 4 || priority === 3) {
    return "inline-flex rounded-full border border-amber-500/45 bg-amber-950/60 px-2 py-0.5 text-xs font-semibold text-amber-200";
  }
  return "inline-flex rounded-full border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs font-semibold text-zinc-400";
}

function effortBadgeClass(): string {
  return "inline-flex rounded-full border border-zinc-600 bg-zinc-800/90 px-2 py-0.5 text-xs font-medium text-zinc-300";
}

function priorityPreviewTextClass(priority: unknown): string {
  if (typeof priority !== "number") return "text-zinc-400";
  if (priority === 5) return "font-semibold text-red-400";
  if (priority === 4 || priority === 3) return "font-semibold text-amber-300";
  return "text-zinc-400";
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Старые dueDate сохранялись как «дата без времени» через new Date("YYYY-MM-DD"),
 * то есть UTC-полночь. Эвристика: если UTC-время ровно 00:00:00.000 — это legacy
 * запись без времени, отображаем её как только дату; в остальных случаях
 * показываем и дату, и время.
 */
function isLegacyDateOnlyDueDate(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

function isTaskDueDatePast(
  dueDate: string | Date | null | undefined,
): boolean {
  if (dueDate == null) return false;
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  if (Number.isNaN(due.getTime())) return false;
  if (isLegacyDateOnlyDueDate(due)) {
    const today = startOfLocalDay(new Date());
    const dueDay = startOfLocalDay(due);
    return today > dueDay;
  }
  return Date.now() > due.getTime();
}

function formatTaskDueDate(
  dueDate: string | Date | null | undefined,
): string | null {
  if (dueDate == null) return null;
  const d = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  if (Number.isNaN(d.getTime())) return null;
  if (isLegacyDateOnlyDueDate(d)) {
    return d.toLocaleDateString("ru-RU");
  }
  return d.toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function toDueDateTimeLocalValue(
  dueDate: string | Date | null | undefined,
): string {
  if (dueDate == null) return "";
  const d = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  if (Number.isNaN(d.getTime())) return "";
  if (isLegacyDateOnlyDueDate(d)) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}T00:00`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function toDateTimeLocalValue(
  eventAt: string | Date | null | undefined,
): string {
  if (eventAt == null) return "";
  const d = typeof eventAt === "string" ? new Date(eventAt) : eventAt;
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function formatTaskEventAt(
  eventAt: string | Date | null | undefined,
): string | null {
  if (eventAt == null) return null;
  const d = typeof eventAt === "string" ? new Date(eventAt) : eventAt;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatCalendarEventTime(
  eventAt: string | Date | null | undefined,
): string {
  if (eventAt == null) return "—";
  const d = typeof eventAt === "string" ? new Date(eventAt) : eventAt;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CALENDAR_WEEKDAY_LABELS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;

function localDayKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function taskEventLocalDayKey(task: TaskListItem): string | null {
  if (task.eventAt == null) return null;
  const d =
    typeof task.eventAt === "string" ? new Date(task.eventAt) : task.eventAt;
  if (Number.isNaN(d.getTime())) return null;
  return localDayKeyFromDate(d);
}

function buildCalendarMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(year, month, 1 - lead + i));
  }
  return cells;
}

type UserOption = {
  id: string;
  login: string;
  role: string;
};

type TasksClientProps = {
  initialTasks: TaskListItem[];
  weekMondayKey: string;
  currentUserId: string;
  telegramConnected: boolean;
  isAdmin?: boolean;
};

export default function TasksClient({
  initialTasks,
  weekMondayKey,
  currentUserId,
  telegramConnected,
  isAdmin = false,
}: TasksClientProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskListItem[]>(initialTasks);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [createPriority, setCreatePriority] = useState<number>(3);
  const [createEffort, setCreateEffort] = useState<number>(3);
  const [createStatus, setCreateStatus] =
    useState<(typeof TASK_STATUSES)[number]>("todo");
  const [createDueDate, setCreateDueDate] = useState("");
  const [createEventAt, setCreateEventAt] = useState("");
  const [createAssigneeId, setCreateAssigneeId] = useState("");
  const [createRecurrenceDays, setCreateRecurrenceDays] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalEditing, setIsModalEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState<string>("todo");
  const [editPriority, setEditPriority] = useState<number>(3);
  const [editEffort, setEditEffort] = useState<number>(3);
  const [editAssigneeId, setEditAssigneeId] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editEventAt, setEditEventAt] = useState("");
  const [editRecurrenceDays, setEditRecurrenceDays] = useState("");
  const [sortBy, setSortBy] =
    useState<(typeof SORT_OPTIONS)[number]["value"]>("newest");
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const skipCardClickOpenRef = useRef(false);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [carrySelection, setCarrySelection] = useState<Record<string, boolean>>(
    {},
  );
  const [isCarryingSubmitting, setIsCarryingSubmitting] = useState(false);
  const [tasksViewTab, setTasksViewTab] = useState<"board" | "calendar">(
    "board",
  );
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [assigneeScope, setAssigneeScope] = useState<"all" | "mine">("all");
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [telegramModalCode, setTelegramModalCode] = useState("");
  const [isTelegramLinkSubmitting, setIsTelegramLinkSubmitting] =
    useState(false);
  const [isTelegramTestSubmitting, setIsTelegramTestSubmitting] =
    useState(false);
  const [isUsersModalOpen, setIsUsersModalOpen] = useState(false);
  const [newUserLogin, setNewUserLogin] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "user">("user");
  const [usersModalError, setUsersModalError] = useState<string | null>(null);
  const [isUsersSubmitting, setIsUsersSubmitting] = useState(false);
  const [isRecurrenceRunSubmitting, setIsRecurrenceRunSubmitting] =
    useState(false);
  const [isOverdueRunSubmitting, setIsOverdueRunSubmitting] = useState(false);
  const [modalTaskComments, setModalTaskComments] = useState<
    TaskModalCommentRow[]
  >([]);
  const [modalCommentsLoading, setModalCommentsLoading] = useState(false);
  const [modalCommentDraft, setModalCommentDraft] = useState("");
  const [modalCommentSending, setModalCommentSending] = useState(false);
  const [modalCommentError, setModalCommentError] = useState<string | null>(
    null,
  );

  const selectedTask = selectedTaskId
    ? tasks.find((t) => t.id === selectedTaskId) ?? null
    : null;

  const todayMondayKey = useMemo(
    () => utcMondayKeyContaining(new Date()),
    [],
  );

  const weekSelectOptions = useMemo(() => {
    const keys = new Set<string>();
    for (let i = -8; i <= 8; i++) {
      keys.add(shiftUtcMondayKey(todayMondayKey, i));
    }
    keys.add(weekMondayKey);
    return [...keys].sort().map((key) => ({
      key,
      label:
        key === todayMondayKey
          ? `${formatWeekRangeLabel(key)} · текущая`
          : formatWeekRangeLabel(key),
    }));
  }, [todayMondayKey, weekMondayKey]);

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  useEffect(() => {
    setSelectedTaskId(null);
    setIsModalEditing(false);
    setIsReviewMode(false);
    setCarrySelection({});
  }, [weekMondayKey]);

  const loadUsers = useCallback(async () => {
    const response = await fetch("/api/users");
    if (!response.ok) return;
    const data = (await response.json()) as { users: UserOption[] };
    setUsers(data.users);
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const loadModalTaskComments = useCallback(async (taskId: string) => {
    setModalCommentsLoading(true);
    setModalCommentError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`);
      if (!res.ok) {
        setModalTaskComments([]);
        setModalCommentError("Не удалось загрузить комментарии");
        return;
      }
      const data = (await res.json()) as { comments: TaskModalCommentRow[] };
      setModalTaskComments(data.comments ?? []);
    } catch {
      setModalTaskComments([]);
      setModalCommentError("Не удалось загрузить комментарии");
    } finally {
      setModalCommentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedTaskId) {
      setModalTaskComments([]);
      setModalCommentDraft("");
      setModalCommentError(null);
      setModalCommentsLoading(false);
      return;
    }
    setModalCommentDraft("");
    setModalCommentError(null);
    void loadModalTaskComments(selectedTaskId);
  }, [selectedTaskId, loadModalTaskComments]);

  useEffect(() => {
    setIsModalEditing(false);
  }, [selectedTaskId]);

  const loadEditFormFromTask = useCallback((task: TaskListItem) => {
    setEditTitle(task.title);
    setEditDescription(task.description);
    setEditStatus(task.status);
    setEditPriority(
      typeof task.priority === "number" && task.priority >= 1 && task.priority <= 5
        ? task.priority
        : 3,
    );
    setEditEffort(
      typeof task.effort === "number" &&
        (TASK_EFFORTS as readonly number[]).includes(task.effort)
        ? task.effort
        : 3,
    );
    setEditAssigneeId(task.assigneeId ?? "");
    setEditDueDate(toDueDateTimeLocalValue(task.dueDate));
    setEditEventAt(toDateTimeLocalValue(task.eventAt));
    const interval = task.recurrenceIntervalDays;
    setEditRecurrenceDays(
      task.recurrenceActive &&
        typeof interval === "number" &&
        interval > 0
        ? String(interval)
        : "",
    );
  }, []);

  useEffect(() => {
    if (selectedTaskId == null) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isModalEditing) {
        const t = tasks.find((x) => x.id === selectedTaskId);
        if (t) loadEditFormFromTask(t);
        setIsModalEditing(false);
      } else {
        setSelectedTaskId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedTaskId, isModalEditing, tasks, loadEditFormFromTask]);

  const resetCreateForm = useCallback(() => {
    setTitle("");
    setDescription("");
    setCreateStatus("todo");
    setCreatePriority(3);
    setCreateEffort(3);
    setCreateDueDate("");
    setCreateEventAt("");
    setCreateAssigneeId("");
    setCreateRecurrenceDays("");
  }, []);

  const closeCreateModal = useCallback(() => {
    setIsCreateModalOpen(false);
    resetCreateForm();
  }, [resetCreateForm]);

  useEffect(() => {
    if (!isCreateModalOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeCreateModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isCreateModalOpen, closeCreateModal]);

  function openCreateModal() {
    setSelectedTaskId(null);
    resetCreateForm();
    setIsCreateModalOpen(true);
  }

  function handleCreateDescriptionKeyDown(
    e: KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  const searchFilteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) => {
      const assigneeHaystack =
        task.assignee?.login?.toLowerCase() ?? "";
      return (
        task.title.toLowerCase().includes(q) ||
        task.description.toLowerCase().includes(q) ||
        assigneeHaystack.includes(q)
      );
    });
  }, [tasks, searchQuery]);

  const assigneeScopeTasks = useMemo(() => {
    if (assigneeScope !== "mine") return searchFilteredTasks;
    if (!currentUserId) return [];
    return searchFilteredTasks.filter(
      (task) =>
        task.assigneeId != null &&
        task.assigneeId !== "" &&
        task.assigneeId === currentUserId,
    );
  }, [searchFilteredTasks, assigneeScope, currentUserId]);

  const sortedFilteredTasks = useMemo(() => {
    const list = [...assigneeScopeTasks];
    const t = (d: string | Date) => new Date(d).getTime();

    if (sortBy === "newest") {
      list.sort((a, b) => t(b.createdAt) - t(a.createdAt));
    } else if (sortBy === "oldest") {
      list.sort((a, b) => t(a.createdAt) - t(b.createdAt));
    } else {
      list.sort((a, b) => {
        const ia = TASK_STATUSES.indexOf(
          a.status as (typeof TASK_STATUSES)[number],
        );
        const ib = TASK_STATUSES.indexOf(
          b.status as (typeof TASK_STATUSES)[number],
        );
        const sa = ia === -1 ? TASK_STATUSES.length : ia;
        const sb = ib === -1 ? TASK_STATUSES.length : ib;
        if (sa !== sb) return sa - sb;
        return t(b.createdAt) - t(a.createdAt);
      });
    }
    return list;
  }, [assigneeScopeTasks, sortBy]);

  const calendarMonthGrid = useMemo(
    () => buildCalendarMonthGrid(calendarMonth.year, calendarMonth.month),
    [calendarMonth.year, calendarMonth.month],
  );

  const calendarTasksByDayKey = useMemo(() => {
    const map = new Map<string, TaskListItem[]>();
    for (const task of assigneeScopeTasks) {
      const key = taskEventLocalDayKey(task);
      if (!key) continue;
      const cur = map.get(key);
      if (cur) cur.push(task);
      else map.set(key, [task]);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.eventAt as string | Date).getTime() -
          new Date(b.eventAt as string | Date).getTime(),
      );
    }
    return map;
  }, [assigneeScopeTasks]);

  const calendarMonthTitle = useMemo(
    () =>
      new Date(calendarMonth.year, calendarMonth.month, 1).toLocaleDateString(
        "ru-RU",
        { month: "long", year: "numeric" },
      ),
    [calendarMonth.year, calendarMonth.month],
  );

  const taskStats = useMemo(() => {
    return {
      total: tasks.length,
      done: tasks.filter((t) => t.status === "done").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      todo: tasks.filter((t) => t.status === "todo").length,
    };
  }, [tasks]);

  const doneWorkloadByAssignee = useMemo(() => {
    const done = tasks.filter(
      (t) =>
        t.status === "done" &&
        sprintTaskBelongsToWeek(t, weekMondayKey),
    );
    const map = new Map<
      string,
      { label: string; count: number; effortSum: number }
    >();

    for (const t of done) {
      const noAssignee = t.assigneeId == null || t.assigneeId === "";
      const key = noAssignee ? "__none__" : String(t.assigneeId);
      const label = noAssignee
        ? "Без исполнителя"
        : (t.assignee?.login ?? t.assigneeId ?? "?");
      const effort =
        typeof t.effort === "number" && Number.isFinite(t.effort)
          ? t.effort
          : 0;
      const cur = map.get(key);
      if (cur) {
        cur.count += 1;
        cur.effortSum += effort;
      } else {
        map.set(key, { label, count: 1, effortSum: effort });
      }
    }

    const rows = [...map.entries()].map(([key, v]) => ({
      key,
      label: v.label,
      count: v.count,
      effortSum: v.effortSum,
    }));

    rows.sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      return a.label.localeCompare(b.label, "ru");
    });

    return rows;
  }, [tasks, weekMondayKey]);

  const incompleteTasksForReview = useMemo(
    () =>
      tasks.filter(
        (t) =>
          REVIEW_CARRY_STATUSES.includes(t.status) &&
          sprintTaskBelongsToWeek(t, weekMondayKey),
      ),
    [tasks, weekMondayKey],
  );

  function startReview() {
    const next: Record<string, boolean> = {};
    for (const t of incompleteTasksForReview) {
      next[t.id] = true;
    }
    setCarrySelection(next);
    setIsReviewMode(true);
  }

  function toggleReviewCarry(taskId: string) {
    setCarrySelection((prev) => ({
      ...prev,
      [taskId]: !prev[taskId],
    }));
  }

  async function handleCarrySelectedTasks() {
    const ids = incompleteTasksForReview
      .filter((t) => carrySelection[t.id] === true)
      .map((t) => t.id);
    if (ids.length === 0) {
      setError("Отметьте хотя бы одну задачу для переноса");
      return;
    }
    const nextWeekKey = shiftUtcMondayKey(weekMondayKey, 1);
    setError(null);
    setIsCarryingSubmitting(true);
    try {
      for (const taskId of ids) {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart: nextWeekKey }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          setError(payload?.error ?? "Не удалось перенести задачи");
          return;
        }
      }
      setIsReviewMode(false);
      setCarrySelection({});
      router.push(`/tasks?week=${encodeURIComponent(nextWeekKey)}`);
      router.refresh();
    } finally {
      setIsCarryingSubmitting(false);
    }
  }

  async function reloadTasks() {
    const response = await fetch(
      `/api/tasks?week=${encodeURIComponent(weekMondayKey)}`,
    );
    if (!response.ok) {
      setError("Failed to reload tasks");
      return;
    }

    const data = (await response.json()) as { tasks: TaskListItem[] };
    setTasks(data.tasks);
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const recurrencePayload =
      createStatus !== "backlog" && createRecurrenceDays.trim()
        ? (() => {
            const n = parseInt(createRecurrenceDays.trim(), 10);
            if (!Number.isFinite(n) || n <= 0) return {};
            return { recurrenceIntervalDays: n };
          })()
        : {};

    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        status: createStatus,
        priority: createPriority,
        effort: createEffort,
        ...(createStatus === "backlog"
          ? {}
          : { weekStart: weekMondayKey }),
        ...(createDueDate ? { dueDate: createDueDate } : {}),
        ...(createEventAt.trim() ? { eventAt: createEventAt } : {}),
        ...(createAssigneeId ? { assigneeId: createAssigneeId } : {}),
        ...recurrencePayload,
      }),
    });

    setIsSubmitting(false);

    if (!response.ok) {
      const raw = await response.text();
      let message = "Failed to create task";
      try {
        const payload = JSON.parse(raw) as { error?: unknown };
        if (typeof payload.error === "string" && payload.error.length > 0) {
          message = payload.error;
        }
      } catch {
        if (raw.trim().length > 0) {
          message = raw.trim();
        }
      }
      setError(message);
      return;
    }

    const data = (await response.json()) as { task: TaskListItem };
    setTasks((prev) => [data.task, ...prev]);
    closeCreateModal();
  }

  async function handleRecurrenceRun() {
    setError(null);
    setIsRecurrenceRunSubmitting(true);
    try {
      const response = await fetch("/api/tasks/recurring/run", {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Не удалось создать повторяющиеся задачи");
        return;
      }
      await reloadTasks();
    } catch {
      setError("Не удалось создать повторяющиеся задачи");
    } finally {
      setIsRecurrenceRunSubmitting(false);
    }
  }

  async function handleOverdueRun() {
    setError(null);
    setIsOverdueRunSubmitting(true);
    try {
      const response = await fetch("/api/tasks/overdue-reminders/run", {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Не удалось проверить просрочки");
        return;
      }
    } catch {
      setError("Не удалось проверить просрочки");
    } finally {
      setIsOverdueRunSubmitting(false);
    }
  }

  async function handleStopRecurrence() {
    if (!selectedTaskId) return;
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${selectedTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recurrenceStop: true }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Не удалось остановить повторение");
        return;
      }
      await reloadTasks();
    } catch {
      setError("Не удалось остановить повторение");
    }
  }

  async function handleTelegramBind() {
    setError(null);
    setIsTelegramLinkSubmitting(true);
    try {
      const response = await fetch("/api/user/telegram-link", {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Не удалось получить код");
        return;
      }
      const data = (await response.json()) as { code: string };
      setTelegramModalCode(data.code);
      setIsTelegramModalOpen(true);
    } catch {
      setError("Не удалось получить код");
    } finally {
      setIsTelegramLinkSubmitting(false);
    }
  }

  function closeTelegramModal() {
    setIsTelegramModalOpen(false);
    setTelegramModalCode("");
    router.refresh();
  }

  async function handleTelegramTest() {
    setError(null);
    setIsTelegramTestSubmitting(true);
    try {
      const response = await fetch("/api/user/telegram-test", {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Не удалось отправить тест");
        return;
      }
    } catch {
      setError("Не удалось отправить тест");
    } finally {
      setIsTelegramTestSubmitting(false);
    }
  }

  function openUsersModal() {
    setUsersModalError(null);
    setIsUsersModalOpen(true);
    void loadUsers();
  }

  function closeUsersModal() {
    setIsUsersModalOpen(false);
    setUsersModalError(null);
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) return;
    const login = newUserLogin.trim();
    if (!login || !newUserPassword) {
      setUsersModalError("Укажите логин и пароль");
      return;
    }
    setUsersModalError(null);
    setIsUsersSubmitting(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login,
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setUsersModalError(
          payload?.error ?? "Не удалось создать пользователя",
        );
        return;
      }
      setNewUserLogin("");
      setNewUserPassword("");
      setNewUserRole("user");
      await loadUsers();
    } catch {
      setUsersModalError("Не удалось создать пользователя");
    } finally {
      setIsUsersSubmitting(false);
    }
  }

  useEffect(() => {
    if (!isUsersModalOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setIsUsersModalOpen(false);
      setUsersModalError(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isUsersModalOpen]);

  useEffect(() => {
    if (!isTelegramModalOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setIsTelegramModalOpen(false);
      setTelegramModalCode("");
      router.refresh();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isTelegramModalOpen, router]);

  async function handleStatusChange(taskId: string, newStatus: string) {
    setError(null);
    const task = tasks.find((t) => t.id === taskId);
    const body: Record<string, unknown> = { status: newStatus };
    if (task?.status === "backlog" && newStatus !== "backlog") {
      body.weekStart = weekMondayKey;
    }

    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(payload?.error ?? "Failed to update status");
      return;
    }

    await reloadTasks();
  }

  function beginModalEdit() {
    const task = tasks.find((t) => t.id === selectedTaskId);
    if (!task) return;
    loadEditFormFromTask(task);
    setIsModalEditing(true);
  }

  function cancelModalEdit() {
    const task = tasks.find((t) => t.id === selectedTaskId);
    if (!task) return;
    loadEditFormFromTask(task);
    setIsModalEditing(false);
  }

  async function handleSaveEdit() {
    if (!selectedTaskId) return;
    setError(null);

    const prevTask = tasks.find((t) => t.id === selectedTaskId);
    const body: Record<string, unknown> = {
      title: editTitle.trim(),
      description: editDescription.trim(),
      status: editStatus,
      priority: editPriority,
      effort: editEffort,
      assigneeId: editAssigneeId.trim() || null,
      dueDate: editDueDate.trim() ? editDueDate.trim() : null,
      eventAt: editEventAt.trim() ? editEventAt : null,
    };

    const trimmedRec = editRecurrenceDays.trim();
    const nParsed =
      trimmedRec === "" ? NaN : parseInt(trimmedRec, 10);
    const legacyRecurrenceOnly =
      Boolean(prevTask?.recurrenceActive) &&
      !(
        typeof prevTask?.recurrenceIntervalDays === "number" &&
        prevTask.recurrenceIntervalDays > 0
      ) &&
      Boolean(prevTask?.recurrenceType);

    if (trimmedRec === "") {
      if (!legacyRecurrenceOnly) {
        body.recurrenceIntervalDays = null;
      }
    } else if (Number.isFinite(nParsed) && nParsed > 0) {
      body.recurrenceIntervalDays = nParsed;
    } else if (!legacyRecurrenceOnly) {
      body.recurrenceIntervalDays = null;
    }

    if (prevTask?.status === "backlog" && editStatus !== "backlog") {
      body.weekStart = weekMondayKey;
    }

    const response = await fetch(`/api/tasks/${selectedTaskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(payload?.error ?? "Failed to update task");
      return;
    }

    setIsModalEditing(false);
    await reloadTasks();
  }

  async function handleDeleteTask() {
    if (!selectedTaskId) return;
    if (!window.confirm("Удалить задачу?")) return;
    setError(null);

    const id = selectedTaskId;
    const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(payload?.error ?? "Failed to delete task");
      return;
    }

    setSelectedTaskId(null);
    setIsModalEditing(false);
    await reloadTasks();
  }

  async function handleSubmitTaskComment() {
    if (!selectedTaskId || modalCommentSending) return;
    const text = modalCommentDraft.trim();
    if (!text) return;
    setModalCommentSending(true);
    setModalCommentError(null);
    try {
      const response = await fetch(`/api/tasks/${selectedTaskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; comment?: TaskModalCommentRow }
        | null;
      if (!response.ok) {
        setModalCommentError(
          typeof payload?.error === "string"
            ? payload.error
            : "Не удалось отправить комментарий",
        );
        return;
      }
      if (payload?.comment) {
        setModalTaskComments((prev) => [...prev, payload.comment!]);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === selectedTaskId
              ? {
                  ...t,
                  _count: {
                    comments: (t._count?.comments ?? 0) + 1,
                  },
                }
              : t,
          ),
        );
      }
      setModalCommentDraft("");
    } catch {
      setModalCommentError("Не удалось отправить комментарий");
    } finally {
      setModalCommentSending(false);
    }
  }

  function handleColumnDragZone(
    columnStatus: (typeof TASK_STATUSES)[number],
    e: DragEvent<HTMLElement>,
  ) {
    e.preventDefault();
    setDragOverColumn(columnStatus);
  }

  function handleColumnDragLeave(
    columnStatus: (typeof TASK_STATUSES)[number],
    e: DragEvent<HTMLElement>,
  ) {
    const to = e.relatedTarget as Node | null;
    if (to && e.currentTarget.contains(to)) return;
    setDragOverColumn((cur) => (cur === columnStatus ? null : cur));
  }

  function handleColumnDrop(columnStatus: (typeof TASK_STATUSES)[number]) {
    return (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      setDragOverColumn(null);
      const taskId = e.dataTransfer.getData("text/plain");
      if (!taskId) return;
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status === columnStatus) return;
      void handleStatusChange(taskId, columnStatus);
    };
  }

  function handleTaskDragStart(taskId: string) {
    return (e: DragEvent<HTMLLIElement>) => {
      skipCardClickOpenRef.current = true;
      e.dataTransfer.setData("text/plain", taskId);
      e.dataTransfer.effectAllowed = "move";
    };
  }

  return (
    <>
    <div className="relative left-1/2 w-screen max-w-none -translate-x-1/2 px-3 sm:px-5 lg:px-10">
      <div className="w-full max-w-none space-y-5 rounded-2xl border border-zinc-800/90 bg-zinc-950 p-4 shadow-2xl shadow-black/40 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">
          Задачи QuizHeroes
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Канбан-доска задач
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-zinc-700 bg-zinc-900/70 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
          <button
            type="button"
            aria-label="Предыдущая неделя"
            className={weekNavArrowBtnClass}
            onClick={() =>
              router.push(
                `/tasks?week=${encodeURIComponent(
                  shiftUtcMondayKey(weekMondayKey, -1),
                )}`,
              )
            }
          >
            ←
          </button>
          <label
            htmlFor="tasks-week-select"
            className="shrink-0 text-xs font-medium text-zinc-400"
          >
            Неделя
          </label>
          <select
            id="tasks-week-select"
            aria-label="Неделя спринта"
            className={weekSelectClass}
            value={weekMondayKey}
            onChange={(event) => {
              router.push(
                `/tasks?week=${encodeURIComponent(event.target.value)}`,
              );
            }}
          >
            {weekSelectOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Следующая неделя"
            className={weekNavArrowBtnClass}
            onClick={() =>
              router.push(
                `/tasks?week=${encodeURIComponent(
                  shiftUtcMondayKey(weekMondayKey, 1),
                )}`,
              )
            }
          >
            →
          </button>
        </div>
        <div className="flex w-full justify-end sm:w-auto sm:shrink-0">
          {!isReviewMode ? (
            <button
              type="button"
              className={cx(btnSecondaryClass, "whitespace-nowrap")}
              onClick={() => startReview()}
            >
              Начать review
            </button>
          ) : (
            <button
              type="button"
              className={cx(btnSecondaryClass, "whitespace-nowrap")}
              onClick={() => {
                setIsReviewMode(false);
                setCarrySelection({});
              }}
            >
              Выйти из review
            </button>
          )}
        </div>
      </div>

      {isReviewMode ? (
        <div className="rounded-xl border border-amber-600/35 bg-amber-950/15 px-4 py-4">
          <h3 className="text-sm font-semibold text-amber-100">
            Review спринта
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            Незавершённые задачи недели (to do и в работе). Отметьте,
            какие перенести на следующую неделю:{" "}
            <span className="tabular-nums text-zinc-300">
              {formatWeekRangeLabel(shiftUtcMondayKey(weekMondayKey, 1))}
            </span>
            .
          </p>
          {incompleteTasksForReview.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              Нет незавершённых задач.
            </p>
          ) : (
            <ul className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
              {incompleteTasksForReview.map((task) => (
                <li
                  key={task.id}
                  className="flex gap-3 rounded-lg border border-zinc-700/80 bg-zinc-900/40 px-3 py-2"
                >
                  <label className="flex flex-1 cursor-pointer items-start gap-3 text-sm text-zinc-200">
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0 rounded border-zinc-600"
                      checked={carrySelection[task.id] === true}
                      onChange={() => toggleReviewCarry(task.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-zinc-100 break-words">
                        {task.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-zinc-500">
                        {COLUMN_LABELS[
                          task.status as (typeof TASK_STATUSES)[number]
                        ] ?? task.status}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimaryClass}
              disabled={
                isCarryingSubmitting ||
                incompleteTasksForReview.filter(
                  (t) => carrySelection[t.id] === true,
                ).length === 0
              }
              onClick={() => void handleCarrySelectedTasks()}
            >
              {isCarryingSubmitting ? "Перенос…" : "Перенести выбранные задачи"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300">
        <span>
          Всего задач:{" "}
          <span className="font-semibold text-zinc-100">{taskStats.total}</span>
        </span>
        <span>
          done:{" "}
          <span className="font-semibold text-emerald-400/90">
            {taskStats.done}
          </span>
        </span>
        <span>
          in_progress:{" "}
          <span className="font-semibold text-amber-400/90">
            {taskStats.inProgress}
          </span>
        </span>
        <span>
          todo:{" "}
          <span className="font-semibold text-sky-400/90">{taskStats.todo}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {telegramConnected ? (
          <>
            <span className="inline-flex items-center rounded-full border border-emerald-700/55 bg-emerald-950/35 px-3 py-1.5 text-xs font-medium text-emerald-300/95">
              Telegram подключен
            </span>
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={isTelegramTestSubmitting}
              onClick={() => void handleTelegramTest()}
            >
              {isTelegramTestSubmitting ? "Отправка…" : "Тест Telegram"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={btnSecondaryClass}
            disabled={isTelegramLinkSubmitting}
            onClick={() => void handleTelegramBind()}
          >
            {isTelegramLinkSubmitting ? "Код…" : "Привязать Telegram"}
          </button>
        )}
        {isAdmin ? (
          <button
            type="button"
            className={btnSecondaryClass}
            onClick={() => openUsersModal()}
          >
            Пользователи
          </button>
        ) : null}
        {isAdmin ? (
          <button
            type="button"
            className={btnSecondaryClass}
            disabled={isRecurrenceRunSubmitting}
            onClick={() => void handleRecurrenceRun()}
          >
            {isRecurrenceRunSubmitting
              ? "Создание…"
              : "Создать повторяющиеся задачи"}
          </button>
        ) : null}
        {isAdmin ? (
          <button
            type="button"
            className={btnSecondaryClass}
            disabled={isOverdueRunSubmitting}
            onClick={() => void handleOverdueRun()}
          >
            {isOverdueRunSubmitting ? "Проверка…" : "Проверить просрочки"}
          </button>
        ) : null}
        <button
          type="button"
          className={btnPrimaryClass}
          onClick={() => openCreateModal()}
        >
          Создать задачу
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cx(
            "rounded-lg border px-4 py-2 text-sm font-medium transition",
            tasksViewTab === "board"
              ? "border-amber-500/60 bg-amber-500/15 text-amber-100"
              : "border-zinc-600 bg-zinc-800/80 text-zinc-300 hover:border-zinc-500",
          )}
          onClick={() => setTasksViewTab("board")}
        >
          Доска
        </button>
        <button
          type="button"
          className={cx(
            "rounded-lg border px-4 py-2 text-sm font-medium transition",
            tasksViewTab === "calendar"
              ? "border-amber-500/60 bg-amber-500/15 text-amber-100"
              : "border-zinc-600 bg-zinc-800/80 text-zinc-300 hover:border-zinc-500",
          )}
          onClick={() => setTasksViewTab("calendar")}
        >
          Календарь
        </button>
      </div>

      {(tasksViewTab === "calendar" || tasks.length > 0) ? (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="sort-by" className={fieldLabelClass}>
              Сортировка
            </label>
            <select
              id="sort-by"
              className={cx(fieldSelectClass, "min-w-[140px]")}
              value={sortBy}
              onChange={(event) =>
                setSortBy(
                  event.target.value as (typeof SORT_OPTIONS)[number]["value"],
                )
              }
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[180px] flex-1">
            <label htmlFor="task-search" className={fieldLabelClass}>
              Поиск
            </label>
            <input
              id="task-search"
              type="search"
              className={fieldInputClass}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="min-w-[200px]">
            <span className={fieldLabelClass}>Показать</span>
            <div className="mt-1 flex flex-wrap gap-1">
              <button
                type="button"
                className={cx(
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                  assigneeScope === "all"
                    ? "border-amber-500/60 bg-amber-500/15 text-amber-100"
                    : "border-zinc-600 bg-zinc-800/80 text-zinc-300 hover:border-zinc-500",
                )}
                onClick={() => setAssigneeScope("all")}
              >
                Все задачи
              </button>
              <button
                type="button"
                className={cx(
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                  assigneeScope === "mine"
                    ? "border-amber-500/60 bg-amber-500/15 text-amber-100"
                    : "border-zinc-600 bg-zinc-800/80 text-zinc-300 hover:border-zinc-500",
                )}
                onClick={() => setAssigneeScope("mine")}
              >
                Только мои задачи
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tasksViewTab === "calendar" ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-700/90 bg-zinc-900/40 px-4 py-4">
          <div className="mb-4 flex min-w-[280px] flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              aria-label="Предыдущий месяц"
              className={weekNavArrowBtnClass}
              onClick={() =>
                setCalendarMonth((prev) => {
                  const d = new Date(prev.year, prev.month - 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })
              }
            >
              ←
            </button>
            <div className="min-w-0 flex-1 text-center text-base font-semibold capitalize text-zinc-100">
              {calendarMonthTitle}
            </div>
            <button
              type="button"
              aria-label="Следующий месяц"
              className={weekNavArrowBtnClass}
              onClick={() =>
                setCalendarMonth((prev) => {
                  const d = new Date(prev.year, prev.month + 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })
              }
            >
              →
            </button>
          </div>
          <div className="grid min-w-[640px] grid-cols-7 gap-1 border-b border-zinc-800 pb-2">
            {CALENDAR_WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="mt-1 grid min-w-[640px] grid-cols-7 gap-1">
            {calendarMonthGrid.map((cellDate, cellIndex) => {
              const dayKey = localDayKeyFromDate(cellDate);
              const dayTasks = calendarTasksByDayKey.get(dayKey) ?? [];
              const inCurrentMonth =
                cellDate.getMonth() === calendarMonth.month &&
                cellDate.getFullYear() === calendarMonth.year;
              return (
                <div
                  key={`${dayKey}-${cellIndex}`}
                  className={cx(
                    "flex min-h-[92px] flex-col border border-zinc-800/90 bg-zinc-900/45 p-1.5",
                    !inCurrentMonth && "bg-zinc-950/60 opacity-60",
                  )}
                >
                  <div
                    className={cx(
                      "mb-1 text-right text-xs tabular-nums",
                      inCurrentMonth ? "text-zinc-300" : "text-zinc-600",
                    )}
                  >
                    {cellDate.getDate()}
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                    {dayTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        className="w-full rounded border border-zinc-700/70 bg-zinc-800/90 px-1 py-0.5 text-left text-[11px] leading-snug transition hover:border-amber-500/45 hover:bg-zinc-800"
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        <span className="block tabular-nums text-sky-400">
                          {formatCalendarEventTime(task.eventAt)}
                        </span>
                        <span className="line-clamp-2 font-medium text-zinc-200 [overflow-wrap:anywhere]">
                          {task.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">No tasks yet.</p>
      ) : (
        <>
          <div className="rounded-xl border border-zinc-700/90 bg-zinc-900/40 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Выполнено за неделю
            </div>
            {doneWorkloadByAssignee.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">
                Нет выполненных задач на этой неделе.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-800/90">
                {doneWorkloadByAssignee.map((row) => (
                  <li
                    key={row.key}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0 break-words font-medium text-zinc-100">
                      {row.label}
                    </span>
                    <span className="max-w-full shrink-0 text-right text-sm leading-snug text-zinc-400">
                      <span className="text-zinc-400">
                        Выполнено задач:{" "}
                        <span className="font-medium tabular-nums text-zinc-200">
                          {row.count}
                        </span>
                      </span>
                      <span className="mx-2 text-zinc-600">·</span>
                      <span className="text-zinc-400">
                        Объём:{" "}
                        <span className="font-medium tabular-nums text-emerald-400/90">
                          {row.effortSum} SP
                        </span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {TASK_STATUSES.map((columnStatus) => {
              const columnTasks = sortedFilteredTasks.filter((task) => {
                if (task.status !== columnStatus) return false;
                if (columnStatus === "backlog") return true;
                return sprintTaskBelongsToWeek(task, weekMondayKey);
              });
              return (
                <div
                  key={columnStatus}
                  className={cx(
                    "flex min-h-[220px] min-w-0 max-w-full flex-col overflow-x-hidden rounded-xl border border-zinc-800 bg-zinc-900/35 p-3 transition-colors",
                    dragOverColumn === columnStatus &&
                      "border-amber-500/50 bg-amber-950/25 ring-2 ring-amber-500/40",
                  )}
                  onDragEnter={(e) => handleColumnDragZone(columnStatus, e)}
                  onDragOver={(e) => handleColumnDragZone(columnStatus, e)}
                  onDragLeave={(e) => handleColumnDragLeave(columnStatus, e)}
                  onDrop={handleColumnDrop(columnStatus)}
                >
                  <div className="mb-3 min-w-0 max-w-full break-words border-b border-zinc-800 pb-2 text-sm font-semibold text-zinc-200">
                    {COLUMN_LABELS[columnStatus]}
                  </div>
                  <ul
                    className="min-h-0 w-full min-w-0 max-w-full flex-1 space-y-0 overflow-x-hidden p-0 [&>li]:list-none"
                    onDragEnter={(e) => handleColumnDragZone(columnStatus, e)}
                    onDragOver={(e) => handleColumnDragZone(columnStatus, e)}
                  >
                    {columnTasks.map((task) => {
                      const overdue = isTaskDueDatePast(task.dueDate);
                      return (
                        <li
                          key={task.id}
                          className={cx(
                            "mb-3 box-border w-full max-w-full list-none cursor-pointer overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-800/80 p-4 min-w-0 transition hover:border-zinc-600",
                            overdue &&
                              "border-amber-700/55 bg-amber-950/25 ring-1 ring-amber-500/25",
                          )}
                          draggable
                          onDragStart={handleTaskDragStart(task.id)}
                          onDragEnd={() => {
                            setDragOverColumn(null);
                            window.setTimeout(() => {
                              skipCardClickOpenRef.current = false;
                            }, 100);
                          }}
                          onDragEnter={(e) =>
                            handleColumnDragZone(columnStatus, e)
                          }
                          onDragOver={(e) =>
                            handleColumnDragZone(columnStatus, e)
                          }
                          onClick={() => {
                            if (skipCardClickOpenRef.current) return;
                            setSelectedTaskId(task.id);
                          }}
                        >
                          <div className="max-w-full break-words text-lg font-semibold leading-snug text-zinc-50 [overflow-wrap:anywhere]">
                            {task.title}
                          </div>
                          <div className="mt-2 flex max-w-full flex-wrap items-center gap-2 break-words">
                            {typeof task.priority === "number" &&
                            task.priority >= 1 &&
                            task.priority <= 5 ? (
                              <span
                                className={priorityBadgeClass(task.priority)}
                              >
                                P {task.priority}
                              </span>
                            ) : null}
                            {typeof task.effort === "number" ? (
                              <span className={effortBadgeClass()}>
                                E {task.effort}
                              </span>
                            ) : null}
                            {(task._count?.comments ?? 0) > 0 ? (
                              <span className="inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums text-zinc-400">
                                💬 {task._count?.comments ?? 0}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 max-w-full break-words text-xs text-zinc-500 [overflow-wrap:anywhere]">
                            Исполнитель:{" "}
                            <span className="text-zinc-300">
                              {task.assignee?.login ?? "—"}
                            </span>
                          </div>
                          <div className="mt-1 max-w-full break-words text-xs text-zinc-500 [overflow-wrap:anywhere]">
                            Постановщик:{" "}
                            <span className="text-zinc-300">
                              {task.createdBy?.login ?? "—"}
                            </span>
                          </div>
                          <div
                            className={cx(
                              "mt-1 max-w-full break-words text-xs [overflow-wrap:anywhere]",
                              overdue
                                ? "font-semibold text-amber-400"
                                : "text-zinc-500",
                            )}
                          >
                            Дедлайн:{" "}
                            {formatTaskDueDate(task.dueDate) ?? "—"}
                          </div>
                          {task.eventAt ? (
                            <div className="mt-1 max-w-full break-words text-xs text-sky-400/90 [overflow-wrap:anywhere]">
                              Событие:{" "}
                              {formatTaskEventAt(task.eventAt) ?? "—"}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}
      </div>
    </div>

    {isTelegramModalOpen
      ? createPortal(
          <div
            className="fixed inset-0 z-[102] flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="telegram-link-modal-title"
          >
            <div
              className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="telegram-link-modal-title"
                className="text-lg font-semibold text-zinc-50"
              >
                Привязка Telegram
              </h2>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-zinc-300">
                {`Напишите боту код:\n${telegramModalCode}`}
              </p>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  className={btnSecondaryClass}
                  onClick={() => closeTelegramModal()}
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null}

    {isAdmin && isUsersModalOpen
      ? createPortal(
          <div
            className="fixed inset-0 z-[103] flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="users-modal-title"
            onClick={() => closeUsersModal()}
          >
            <div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <h2
                  id="users-modal-title"
                  className="text-xl font-semibold tracking-tight text-zinc-50"
                >
                  Пользователи
                </h2>
                <button
                  type="button"
                  className={btnSecondaryClass}
                  onClick={() => closeUsersModal()}
                >
                  Закрыть
                </button>
              </div>

              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Список
                </div>
                {users.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">Нет пользователей</p>
                ) : (
                  <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2">
                    {users.map((u) => (
                      <li
                        key={u.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-200"
                      >
                        <span className="min-w-0 break-all font-medium">
                          {u.login}
                        </span>
                        <span
                          className={cx(
                            "shrink-0 rounded-full border px-2 py-0.5 text-xs tabular-nums",
                            u.role === "admin"
                              ? "border-amber-500/45 bg-amber-950/50 text-amber-200"
                              : "border-zinc-600 bg-zinc-800 text-zinc-400",
                          )}
                        >
                          {u.role === "admin" ? "admin" : "user"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <form
                onSubmit={(e) => void handleCreateUser(e)}
                className="mt-6 space-y-4 border-t border-zinc-800 pt-6"
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Новый пользователь
                </div>
                {usersModalError ? (
                  <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                    {usersModalError}
                  </p>
                ) : null}
                <div>
                  <label htmlFor="users-new-login" className={fieldLabelClass}>
                    Логин
                  </label>
                  <input
                    id="users-new-login"
                    className={fieldInputClass}
                    value={newUserLogin}
                    onChange={(e) => setNewUserLogin(e.target.value)}
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label
                    htmlFor="users-new-password"
                    className={fieldLabelClass}
                  >
                    Пароль
                  </label>
                  <input
                    id="users-new-password"
                    type="password"
                    className={fieldInputClass}
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label htmlFor="users-new-role" className={fieldLabelClass}>
                    Роль
                  </label>
                  <select
                    id="users-new-role"
                    className={fieldSelectClass}
                    value={newUserRole}
                    onChange={(e) =>
                      setNewUserRole(e.target.value as "admin" | "user")
                    }
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className={btnSecondaryClass}
                    onClick={() => closeUsersModal()}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isUsersSubmitting}
                    className={btnPrimaryClass}
                  >
                    {isUsersSubmitting ? "Создание…" : "Создать"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )
      : null}

    {isCreateModalOpen
      ? createPortal(
          <div
            className="fixed inset-0 z-[101] flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-task-modal-title"
          >
            <div
              className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="create-task-modal-title"
                className="text-xl font-semibold tracking-tight text-zinc-50"
              >
                Новая задача
              </h2>
              <form
                onSubmit={handleCreateSubmit}
                className="mt-4 space-y-4"
              >
                <div>
                  <label
                    htmlFor="modal-create-title"
                    className={fieldLabelClass}
                  >
                    Title
                  </label>
                  <input
                    id="modal-create-title"
                    className={fieldInputClass}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="modal-create-description"
                    className={fieldLabelClass}
                  >
                    Description
                  </label>
                  <textarea
                    id="modal-create-description"
                    className={cx(fieldInputClass, "min-h-[88px] resize-y")}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    onKeyDown={handleCreateDescriptionKeyDown}
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="modal-create-status"
                      className={fieldLabelClass}
                    >
                      Статус
                    </label>
                    <select
                      id="modal-create-status"
                      className={fieldSelectClass}
                      value={createStatus}
                      onChange={(event) => {
                        const v = event.target
                          .value as (typeof TASK_STATUSES)[number];
                        setCreateStatus(v);
                        if (v === "backlog") setCreateRecurrenceDays("");
                      }}
                    >
                      {TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {COLUMN_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="modal-create-due"
                      className={fieldLabelClass}
                    >
                      Дедлайн
                    </label>
                    <input
                      id="modal-create-due"
                      type="datetime-local"
                      className={fieldInputClass}
                      value={createDueDate}
                      onChange={(event) =>
                        setCreateDueDate(event.target.value)
                      }
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="modal-create-event"
                      className={fieldLabelClass}
                    >
                      Дата и время события
                    </label>
                    <input
                      id="modal-create-event"
                      type="datetime-local"
                      className={fieldInputClass}
                      value={createEventAt}
                      onChange={(event) =>
                        setCreateEventAt(event.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="modal-create-priority"
                      className={fieldLabelClass}
                    >
                      Приоритет
                    </label>
                    <select
                      id="modal-create-priority"
                      className={fieldSelectClass}
                      value={createPriority}
                      onChange={(event) =>
                        setCreatePriority(Number(event.target.value))
                      }
                    >
                      {TASK_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="modal-create-effort"
                      className={fieldLabelClass}
                    >
                      Объем
                    </label>
                    <select
                      id="modal-create-effort"
                      className={fieldSelectClass}
                      value={createEffort}
                      onChange={(event) =>
                        setCreateEffort(Number(event.target.value))
                      }
                    >
                      {TASK_EFFORTS.map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="modal-create-assignee"
                      className={fieldLabelClass}
                    >
                      Исполнитель
                    </label>
                    <select
                      id="modal-create-assignee"
                      className={fieldSelectClass}
                      value={createAssigneeId}
                      onChange={(event) =>
                        setCreateAssigneeId(event.target.value)
                      }
                    >
                      <option value="">Не назначено</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.login}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="modal-create-recurrence"
                      className={fieldLabelClass}
                    >
                      Повторять каждые N дней
                    </label>
                    <input
                      id="modal-create-recurrence"
                      type="number"
                      min={1}
                      step={1}
                      placeholder="не повторять"
                      className={fieldInputClass}
                      disabled={createStatus === "backlog"}
                      value={createRecurrenceDays}
                      onChange={(event) =>
                        setCreateRecurrenceDays(event.target.value)
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
                  <button
                    type="button"
                    className={btnSecondaryClass}
                    onClick={() => closeCreateModal()}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={btnPrimaryClass}
                  >
                    Создать
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )
      : null}

    {selectedTask
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-modal-title"
          >
            <div
              className={cx(
                "max-h-[90vh] w-full overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl",
                isModalEditing ? "max-w-2xl" : "max-w-lg",
                isTaskDueDatePast(selectedTask.dueDate) &&
                  "border-amber-700/50 ring-1 ring-amber-500/30",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {!isModalEditing ? (
                <>
                  <h2
                    id="task-modal-title"
                    className="max-w-full break-words text-xl font-semibold text-zinc-50 [overflow-wrap:anywhere]"
                  >
                    {selectedTask.title}
                  </h2>
                  <p className="mt-4 max-w-full whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-400 [overflow-wrap:anywhere]">
                    {renderDescriptionWithLinks(selectedTask.description)}
                  </p>
                  <dl className="mt-6 space-y-3 text-sm text-zinc-300">
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      <dt className="text-zinc-500">Статус</dt>
                      <dd className="font-medium text-zinc-100">
                        {TASK_STATUSES.includes(
                          selectedTask.status as (typeof TASK_STATUSES)[number],
                        )
                          ? COLUMN_LABELS[
                              selectedTask.status as (typeof TASK_STATUSES)[number]
                            ]
                          : selectedTask.status}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      <dt className="text-zinc-500">Приоритет</dt>
                      <dd
                        className={cx(
                          "font-medium",
                          priorityPreviewTextClass(selectedTask.priority),
                        )}
                      >
                        {typeof selectedTask.priority === "number"
                          ? selectedTask.priority
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      <dt className="text-zinc-500">Объем</dt>
                      <dd className="font-medium text-zinc-100">
                        {typeof selectedTask.effort === "number"
                          ? selectedTask.effort
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      <dt className="text-zinc-500">Исполнитель</dt>
                      <dd className="max-w-full break-words font-medium text-zinc-100 [overflow-wrap:anywhere]">
                        {selectedTask.assignee?.login ?? "—"}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      <dt className="text-zinc-500">Постановщик</dt>
                      <dd className="max-w-full break-words font-medium text-zinc-100 [overflow-wrap:anywhere]">
                        {selectedTask.createdBy?.login ?? "—"}
                      </dd>
                    </div>
                    {selectedTask.recurrenceActive &&
                    typeof selectedTask.recurrenceIntervalDays === "number" &&
                    selectedTask.recurrenceIntervalDays > 0 ? (
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        <dt className="text-zinc-500">Повторение</dt>
                        <dd className="font-medium text-zinc-100">
                          Повторяется каждые{" "}
                          {selectedTask.recurrenceIntervalDays} дней
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      <dt className="text-zinc-500">Дедлайн</dt>
                      <dd
                        className={cx(
                          "font-medium",
                          isTaskDueDatePast(selectedTask.dueDate)
                            ? "text-amber-400"
                            : "text-zinc-100",
                        )}
                      >
                        {formatTaskDueDate(selectedTask.dueDate) ?? "—"}
                      </dd>
                    </div>
                    {selectedTask.eventAt ? (
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        <dt className="text-zinc-500">Событие</dt>
                        <dd className="font-medium text-sky-300">
                          {formatTaskEventAt(selectedTask.eventAt) ?? "—"}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </>
              ) : (
                <>
                  <h2
                    id="task-modal-title"
                    className="max-w-full break-words text-xl font-semibold text-zinc-50 [overflow-wrap:anywhere]"
                  >
                    Редактирование
                  </h2>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label
                        htmlFor="modal-edit-title"
                        className={fieldLabelClass}
                      >
                        Title
                      </label>
                      <input
                        id="modal-edit-title"
                        className={fieldInputClass}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="modal-edit-description"
                        className={fieldLabelClass}
                      >
                        Description
                      </label>
                      <textarea
                        id="modal-edit-description"
                        className={cx(fieldInputClass, "min-h-[88px] resize-y")}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="modal-edit-status"
                          className={fieldLabelClass}
                        >
                          Статус
                        </label>
                        <select
                          id="modal-edit-status"
                          className={fieldSelectClass}
                          value={editStatus}
                          onChange={(e) => {
                            const v = e.target.value;
                            setEditStatus(v);
                            if (v === "backlog") setEditRecurrenceDays("");
                          }}
                        >
                          {TASK_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {COLUMN_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor="modal-edit-due"
                          className={fieldLabelClass}
                        >
                          Дедлайн
                        </label>
                        <input
                          id="modal-edit-due"
                          type="datetime-local"
                          className={fieldInputClass}
                          value={editDueDate}
                          onChange={(e) => setEditDueDate(e.target.value)}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label
                          htmlFor="modal-edit-event"
                          className={fieldLabelClass}
                        >
                          Дата и время события
                        </label>
                        <input
                          id="modal-edit-event"
                          type="datetime-local"
                          className={fieldInputClass}
                          value={editEventAt}
                          onChange={(e) => setEditEventAt(e.target.value)}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="modal-edit-priority"
                          className={fieldLabelClass}
                        >
                          Приоритет
                        </label>
                        <select
                          id="modal-edit-priority"
                          className={fieldSelectClass}
                          value={editPriority}
                          onChange={(e) =>
                            setEditPriority(Number(e.target.value))
                          }
                        >
                          {TASK_PRIORITIES.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor="modal-edit-effort"
                          className={fieldLabelClass}
                        >
                          Объем
                        </label>
                        <select
                          id="modal-edit-effort"
                          className={fieldSelectClass}
                          value={editEffort}
                          onChange={(e) =>
                            setEditEffort(Number(e.target.value))
                          }
                        >
                          {TASK_EFFORTS.map((eff) => (
                            <option key={eff} value={eff}>
                              {eff}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label
                          htmlFor="modal-edit-assignee"
                          className={fieldLabelClass}
                        >
                          Исполнитель
                        </label>
                        <select
                          id="modal-edit-assignee"
                          className={fieldSelectClass}
                          value={editAssigneeId}
                          onChange={(e) => setEditAssigneeId(e.target.value)}
                        >
                          <option value="">Не назначено</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.login}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label
                          htmlFor="modal-edit-recurrence"
                          className={fieldLabelClass}
                        >
                          Повторять каждые N дней
                        </label>
                        <input
                          id="modal-edit-recurrence"
                          type="number"
                          min={1}
                          step={1}
                          placeholder="не повторять"
                          className={fieldInputClass}
                          disabled={editStatus === "backlog"}
                          value={editRecurrenceDays}
                          onChange={(e) =>
                            setEditRecurrenceDays(e.target.value)
                          }
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
              <TaskModalCommentsSection
                comments={modalTaskComments}
                loading={modalCommentsLoading}
                error={modalCommentError}
                draft={modalCommentDraft}
                onDraftChange={setModalCommentDraft}
                sending={modalCommentSending}
                onSubmit={() => void handleSubmitTaskComment()}
              />
              {!isModalEditing ? (
                <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btnDangerClass}
                      onClick={() => void handleDeleteTask()}
                    >
                      Удалить
                    </button>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {selectedTask.recurrenceActive ? (
                      <button
                        type="button"
                        className={btnSecondaryClass}
                        onClick={() => void handleStopRecurrence()}
                      >
                        Остановить повторение
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={btnSecondaryClass}
                      onClick={() => beginModalEdit()}
                    >
                      Редактировать
                    </button>
                    <button
                      type="button"
                      className={btnSecondaryClass}
                      onClick={() => setSelectedTaskId(null)}
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-8 flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
                  <button
                    type="button"
                    className={btnSecondaryClass}
                    onClick={() => cancelModalEdit()}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    className={btnPrimaryClass}
                    onClick={() => void handleSaveEdit()}
                  >
                    Сохранить
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null}
      <TasksChatPanel />
    </>
  );
}
