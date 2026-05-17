import prisma from '../src/lib/prisma';

async function main() {
  const existing = await prisma.donationEvent.findFirst({
    where: { title: { contains: "Architect of a Child's Destiny" } },
  });

  if (existing) {
    console.log('Donation event already exists:', existing.id);
    await prisma.$disconnect();
    return;
  }

  const event = await prisma.donationEvent.create({
    data: {
      title: "Be the Architect of a Child's Destiny: Join the Revolution of Knowledge.",
      description: `"Every child is born with a dream, but for many, poverty is a silent thief that steals those dreams before they can even take root."

In the quiet corners of our world, there are eyes filled with tears and hearts heavy with a weight no child should ever carry. They don't just lack books and pens; they lack the belief that tomorrow will be any different from the struggle of today. To them, a classroom is a distant luxury, and a bright future is a story told only to others.

Your kindness is the hand that reaches out to wipe away those tears. When you choose to support their education, you aren't just donating money; you are becoming the light that shatters their darkness. You are the bridge over their sea of despair, the strength in their moment of weakness, and the architect who rebuilds their shattered world.

✦ A Stroke of Hope: Your contribution transforms a child's trembling hand into one that holds a pen with confidence.

✦ A Legacy of Light: You are turning a story of "what could have been" into a reality of "what they have become."

✦ The Power of One: One act of compassion from you can break the chains of generational poverty for them.

Join us in this sacred revolution. Let us not look away while a child's potential fades into the shadows. Be the reason a child smiles today and succeeds tomorrow.

"Be more than a donor. Be the miracle they have been praying for."`,
      coverImageUrl: '',
      goalAmount: 1000000,
      currency: 'INR',
      status: 'ACTIVE',
      presets: [500, 1000, 5000, 10000],
      allowCustom: true,
      startAt: new Date(),
    },
  });

  console.log('✅ Donation event created:', event.id);
  console.log('   Title:', event.title);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
