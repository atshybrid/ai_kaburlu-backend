-- Run this on the production server via DigitalOcean Console:
-- sudo -u postgres psql -d khabarxprod
-- OR
-- PGPASSWORD='mMIvTgbmqj8eQc7iiW4TZzKyjGP9JhyO' psql -U khabarx_owner -d khabarxprod

INSERT INTO "DonationEvent" (
  id,
  title,
  description,
  "coverImageUrl",
  "goalAmount",
  currency,
  status,
  presets,
  "allowCustom",
  "collectedAmount",
  "startAt",
  "createdAt",
  "updatedAt"
) VALUES (
  'edu_' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 20),
  'Be the Architect of a Child''s Destiny: Join the Revolution of Knowledge.',
  E'"Every child is born with a dream, but for many, poverty is a silent thief that steals those dreams before they can even take root."\n\nIn the quiet corners of our world, there are eyes filled with tears and hearts heavy with a weight no child should ever carry. They don''t just lack books and pens; they lack the belief that tomorrow will be any different from the struggle of today. To them, a classroom is a distant luxury, and a bright future is a story told only to others.\n\nYour kindness is the hand that reaches out to wipe away those tears. When you choose to support their education, you aren''t just donating money; you are becoming the light that shatters their darkness. You are the bridge over their sea of despair, the strength in their moment of weakness, and the architect who rebuilds their shattered world.\n\n\u2726 A Stroke of Hope: Your contribution transforms a child''s trembling hand into one that holds a pen with confidence.\n\n\u2726 A Legacy of Light: You are turning a story of "what could have been" into a reality of "what they have become."\n\n\u2726 The Power of One: One act of compassion from you can break the chains of generational poverty for them.\n\nJoin us in this sacred revolution. Let us not look away while a child''s potential fades into the shadows. Be the reason a child smiles today and succeeds tomorrow.\n\n"Be more than a donor. Be the miracle they have been praying for."',
  '',
  1000000,
  'INR',
  'ACTIVE',
  ARRAY[500, 1000, 5000, 10000],
  true,
  0,
  NOW(),
  NOW(),
  NOW()
);

-- Verify insert:
SELECT id, title, status, "goalAmount", "createdAt" FROM "DonationEvent" ORDER BY "createdAt" DESC LIMIT 3;
