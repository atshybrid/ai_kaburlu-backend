// DEPRECATED: Prefer running TypeScript seed (prisma/seed.ts) via `npm run seed`.
// This legacy JS seed only inserts basic categories and is kept for backward compatibility.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const categories = [
    { name: 'Technology', slug: 'technology', isDeleted: false },
    { name: 'Politics', slug: 'politics', isDeleted: false },
    { name: 'Sports', slug: 'sports', isDeleted: false },
    { name: 'Health', slug: 'health', isDeleted: false },
    { name: 'Education', slug: 'education', isDeleted: false },
    { name: 'Entertainment', slug: 'entertainment', isDeleted: false },
    { name: 'Business', slug: 'business', isDeleted: false },
    { name: 'Travel', slug: 'travel', isDeleted: false }
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: category
    });
  }

  console.log('Categories seeded!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
