import TelegramBot from "node-telegram-bot-api";
import { prisma } from "@/lib/prisma";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

type TelegramGlobal = typeof globalThis & {
  __quizheroesTelegramBot?: TelegramBot | null;
};

function getOrCreateTelegramBot(): TelegramBot | null {
  if (!token) {
    return null;
  }

  const g = globalThis as TelegramGlobal;

  if (g.__quizheroesTelegramBot !== undefined) {
    return g.__quizheroesTelegramBot;
  }

  try {
    const bot = new TelegramBot(token, { polling: true });
    bot.onText(/\/start/, (msg) => {
      void bot.sendMessage(msg.chat.id, "QuizHeroes Tasks Bot подключен.");
    });
    bot.onText(/^(\d{6})$/, async (msg, match) => {
      const code = match?.[1];
      if (!code) return;
      const user = await prisma.user.findFirst({
        where: { telegramLinkCode: code },
      });
      if (!user) {
        void bot.sendMessage(msg.chat.id, "Код не найден.");
        return;
      }
      await prisma.user.update({
        where: { id: user.id },
        data: {
          telegramChatId: String(msg.chat.id),
          telegramLinkCode: null,
        },
      });
      void bot.sendMessage(msg.chat.id, "Telegram успешно привязан.");
    });
    g.__quizheroesTelegramBot = bot;
    return bot;
  } catch {
    g.__quizheroesTelegramBot = null;
    return null;
  }
}

export const telegramBot: TelegramBot | null = getOrCreateTelegramBot();

/** Telegram Bot API: сообщение не длиннее 4096 символов. */
const TELEGRAM_MESSAGE_MAX_LEN = 4096;

/** Отправка в чат; без токена / бота — no-op; ошибки API не пробрасываются. */
export async function sendTelegramChatMessage(
  chatId: string,
  text: string,
): Promise<void> {
  if (!telegramBot) return;
  const safe =
    text.length > TELEGRAM_MESSAGE_MAX_LEN
      ? `${text.slice(0, TELEGRAM_MESSAGE_MAX_LEN - 1)}…`
      : text;
  try {
    await telegramBot.sendMessage(chatId, safe);
  } catch {
    /* optional */
  }
}
