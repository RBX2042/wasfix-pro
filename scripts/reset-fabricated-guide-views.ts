/**
 * One-time cleanup: clear the invented view counts on repair guides.
 *
 * The seed used to ship each guide with a hand-picked view count between about
 * 900 and 4.000, and /gidsen printed it as "N keer bekeken". Nothing had ever
 * counted a view — the counter did not exist. src/data/guides.json now seeds
 * every guide at 0 and the guide page increments for real, but the seed
 * deliberately does not overwrite `views` on update (that would wipe genuine
 * counts on every deploy), so a database seeded before this change still holds
 * the invented numbers.
 *
 * Run this ONCE against such a database, then never again:
 *   DATABASE_URL=... npx tsx scripts/reset-fabricated-guide-views.ts
 *
 * After that the counts are real, and running this would destroy data.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.repairGuide.count({ where: { views: { gt: 0 } } });
  if (before === 0) {
    console.log("Nothing to do — no guide carries a view count.");
    return;
  }
  const { count } = await prisma.repairGuide.updateMany({ where: { views: { gt: 0 } }, data: { views: 0 } });
  console.log(`Cleared invented view counts on ${count} guide(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
