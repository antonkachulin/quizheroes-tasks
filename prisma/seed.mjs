import { PrismaClient } from "@prisma/client";
import { scryptSync } from "node:crypto";

const PASSWORD_SALT = "quizheroes-dev-salt";
const prisma = new PrismaClient();

function hashPassword(plainPassword) {
  return scryptSync(plainPassword, PASSWORD_SALT, 64).toString("hex");
}

async function main() {
  await prisma.user.upsert({
    where: { login: "admin" },
    update: {
      password: hashPassword("1234"),
      role: "admin",
    },
    create: {
      login: "admin",
      password: hashPassword("1234"),
      role: "admin",
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

