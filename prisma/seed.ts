/**
 * Comprehensive Prisma seed script (idempotent & environment‑controlled)
 * Usage:
 *  Basic (additive – safe):          npm run seed
 *  Full sample content:              $env:FULL_SEED=1; npm run seed   (PowerShell)
 *  Force destructive wipe + re-seed: $env:FORCE_WIPE=1; $env:FULL_SEED=1; npm run seed
 *
 * Behaviour:
 *  - By default does NOT delete existing data (additive / upsert strategy)
 *  - FORCE_WIPE=1 performs a truncated reseed of core lookup tables & sample data
 *  - FULL_SEED enables creation of sample content (articles, short news, devices, metrics)
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Env flags
const FORCE_WIPE = process.env.FORCE_WIPE === '1';
const FULL_SEED = process.env.FULL_SEED === '1' || process.env.SEED_MODE === 'full';

// --- Static Reference Data -------------------------------------------------
// Add core roles plus requested HRCI roles (MEMBER, HRCI_ADMIN, VITTEAM)
const roles = [
    'SUPER_ADMIN',
    'LANGUAGE_ADMIN',
    'NEWS_DESK',
    'REPORTER',
    'ADMIN',
    'CITIZEN_REPORTER',
    'GUEST',
    'MEMBER',
    'HRCI_ADMIN',
    'VITTEAM',
];

// Permissions JSON can be arrays of strings or nested objects depending on role needs
const defaultPermissions: Record<string, any> = {
    SUPER_ADMIN: ['create','read','update','delete','approve','reject'],
    LANGUAGE_ADMIN: ['articles:create','articles:read','articles:update','articles:delete','articles:approve','articles:reject','users:read'],
    NEWS_DESK: [],
    REPORTER: [],
    ADMIN: [],
    CITIZEN_REPORTER: [
        'shortnews:create','shortnews:update:own','shortnews:list','shortnews:moderation:self',
        'ai:rewrite','ai:shortnews:article',
        'profile:read','profile:update',
        'user:self:read','user:self:update'
    ],
    GUEST: [],
    // Members: basic self-service permissions (expand as needed)
    MEMBER: [
        'member:read',
        'idcard:read',
        'kyc:read','kyc:update',
        'profile:read','profile:update',
        'user:self:read','user:self:update'
    ],
    // HRCI Admin: structured permissions aligned with HRCI admin activities
    HRCI_ADMIN: {
        hrc: {
            teams: ['create','read','update'],
            volunteers: ['onboard','assign'],
            idcards: ['issue','renew','revoke'],
            payments: ['create','refund','read'],
            cases: ['create','read','update','assign','close'],
            donations: ['read']
        }
    },
    // VITTEAM: placeholder; specific APIs/permissions to be added later
    VITTEAM: [],
};

const languages: { name: string; code: string; nativeName: string; direction: string; isDeleted: boolean }[] = [
    { name: 'English', code: 'en', nativeName: 'English', direction: 'ltr', isDeleted: false },
    { name: 'Hindi', code: 'hi', nativeName: 'हिन्दी', direction: 'ltr', isDeleted: false },
    { name: 'Telugu', code: 'te', nativeName: 'తెలుగు', direction: 'ltr', isDeleted: false },
    { name: 'Tamil', code: 'ta', nativeName: 'தமிழ்', direction: 'ltr', isDeleted: false },
    { name: 'Kannada', code: 'kn', nativeName: 'ಕನ್ನಡ', direction: 'ltr', isDeleted: false },
    { name: 'Malayalam', code: 'ml', nativeName: 'മലയാളം', direction: 'ltr', isDeleted: false },
];

const categoryKeys = ['NATIONAL','INTERNATIONAL','SPORTS','TECHNOLOGY','ENTERTAINMENT','BUSINESS'] as const;
const categories = categoryKeys.map(k => ({ key: k }));
const categoryTranslations: Record<string, Record<string,string>> = {
    NATIONAL: { en: 'National', te: 'జాతీయం', hi: 'राष्ट्रीय', ta: 'தேசியம்', kn: 'ರಾಷ್ಟ್ರೀಯ', ml: 'ദേശീയ' },
    INTERNATIONAL: { en: 'International', te: 'అంతర్జాతీయం', hi: 'अंतरराष्ट्रीय', ta: 'சர்வதேசம்', kn: 'ಅಂತರರಾಷ್ಟ್ರೀಯ', ml: 'അന്താരാഷ്ട്ര' },
    SPORTS: { en: 'Sports', te: 'క్రీడలు', hi: 'खेल', ta: 'விளையாட்டு', kn: 'ಕ್ರೀಡೆ', ml: 'കായികം' },
    TECHNOLOGY: { en: 'Technology', te: 'సాంకేతికం', hi: 'प्रौद्योगिकी', ta: 'தொழில்நுட்பம்', kn: 'ತಂತ್ರಜ್ಞಾನ', ml: 'സാങ്കേതಿಕം' },
    ENTERTAINMENT: { en: 'Entertainment', te: 'వినోదం', hi: 'मनोरंजन', ta: 'பொழுதுபோக்கு', kn: 'ಮನರಂಜನೆ', ml: 'വിനോദം' },
    BUSINESS: { en: 'Business', te: 'వ్యాపారం', hi: 'व्यापार', ta: 'வணிகம்', kn: 'ವ್ಯಾಪಾರ', ml: 'ബിസിനസ്സ്' },
};

const stateNames = [
    'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'
];

// --- Utility helpers ------------------------------------------------------
function log(section: string, msg: string) {
    console.log(`[seed:${section}] ${msg}`);
}

async function forceWipe() {
    if (!FORCE_WIPE) return;
    log('wipe','FORCE_WIPE=1 detected – deleting selected data (order matters)');
    // Delete child tables first (minimal subset – extend if FULL_SEED grows)
    await prisma.pushNotificationLog.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.contentReaction.deleteMany();
    await prisma.contentRead.deleteMany();
    await prisma.articleRead.deleteMany();
    await prisma.shortNewsRead.deleteMany();
    await prisma.like.deleteMany();
    await prisma.dislike.deleteMany();
    await prisma.articleView.deleteMany();
    await prisma.shortNews.deleteMany();
    await prisma.article.deleteMany();
    await prisma.device.deleteMany();
    await prisma.userProfile.deleteMany();
    await prisma.userLocation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.categoryTranslation.deleteMany();
    await prisma.category.deleteMany();
    await prisma.state.deleteMany();
    await prisma.country.deleteMany();
    await prisma.language.deleteMany();
    await prisma.role.deleteMany();
    await prisma.prompt.deleteMany();
    log('wipe','Completed.');
}

async function seedRoles() {
    log('roles','upserting roles');
    const map: Record<string,string> = {};
    for (const r of roles) {
        const row = await prisma.role.upsert({
            where: { name: r },
            update: { permissions: defaultPermissions[r] },
            create: { name: r, permissions: defaultPermissions[r] },
        });
        map[r] = row.id;
    }
    return map;
}

async function seedLanguages() {
    log('languages','upserting languages');
    const map: Record<string,string> = {};
    for (const l of languages) {
        const row = await prisma.language.upsert({
            where: { code: l.code },
            update: { name: l.name, nativeName: l.nativeName, direction: l.direction, isDeleted: l.isDeleted },
            create: l,
        });
        map[l.code] = row.id;
    }
    return map;
}

async function seedCountryAndStates() {
    log('geo','upserting country + states');
    const india = await prisma.country.upsert({ where: { code: 'IN' }, update: { name: 'India' }, create: { name: 'India', code: 'IN' } });
    for (const s of stateNames) {
        await prisma.state.upsert({ where: { name: s }, update: { countryId: india.id }, create: { name: s, countryId: india.id } });
    }
    return india.id;
}

async function seedCategoriesAndTranslations(languageMap: Record<string,string>) {
    log('categories','upserting categories + translations');
    for (const c of categories) {
        const slug = c.key.toLowerCase();
        const cat = await prisma.category.upsert({ where: { slug }, update: { name: c.key }, create: { name: c.key, slug } });
        const translations = categoryTranslations[c.key];
        if (translations) {
            for (const [langCode, translatedName] of Object.entries(translations)) {
                if (!languageMap[langCode]) continue; // skip unknown language code
                await prisma.categoryTranslation.upsert({
                    where: { categoryId_language: { categoryId: cat.id, language: langCode } },
                    update: { name: translatedName },
                    create: { categoryId: cat.id, language: langCode, name: translatedName },
                });
            }
        }
    }
}

async function seedPrompts() {
    log('prompts','upserting base prompts');
    // Keep aligned with src/lib/prompts.ts (subset – will be enriched later if scripts run)
    const basePrompts: { key: string; content: string; description?: string }[] = [
        { key: 'SEO_GENERATION', content: `You are an SEO assistant. Given a news title and content, produce strict JSON with keys: metaTitle, metaDescription, tags, altTexts.\n- metaTitle: short, compelling, <= 70 chars.\n- metaDescription: <= 160 chars.\n- tags: 5-10 concise tags.\n- altTexts: object mapping provided image URL -> descriptive alt text.\nRespond entirely in language code: {{languageCode}}.\nTitle: {{title}}\nContent: {{content}}\nImages: {{images}}\nOutput JSON schema: {"metaTitle": string, "metaDescription": string, "tags": string[], "altTexts": { [url: string]: string }}`, description: 'SEO meta generator'},
        { key: 'MODERATION', content: `Content moderation for news. Analyze the text for plagiarism likelihood and sensitive content (violence, hate, adult, personal data).\nReturn STRICT JSON: {"plagiarismScore": number (0-1), "sensitiveFlags": string[], "decision": "ALLOW"|"REVIEW"|"BLOCK", "remark": string (short, in {{languageCode}})}.\nText: {{content}}`, description: 'Moderation & safety analysis' },
        { key: 'CATEGORY_TRANSLATION', content: `You are a translator. Translate the news category name exactly into {{targetLanguage}}.\nRules:\n- Respond with ONLY the translated category name.\n- No quotes, no extra words, no punctuation.\n- Use the native script of {{targetLanguage}}{{latinGuard}}.\nCategory: {{text}}`, description: 'Category translation' },
        { key: 'SHORTNEWS_REWRITE', content: `You are a professional short news assistant. Rewrite the provided raw user text into a concise, factual short news draft in the SAME language as the input (language code: {{languageCode}}).\nConstraints:\n- Title: <= 50 characters, punchy, no clickbait, no ALL CAPS, no emojis.\n- Content: <= 60 words. Neutral, factual tone. No repetition. No speculation beyond given facts.\n- Remove greetings, personal opinions, promotional lines, and unrelated chatter.\n- Preserve key facts: who, what, where, when. If missing, do NOT invent.\nOutput STRICT JSON ONLY (no markdown) with schema: {"title": string, "content": string}.\nInputTitle (may be empty): {{title}}\nInputText: {{content}}`, description: 'Short news rewrite' },
        { key: 'SHORTNEWS_AI_ARTICLE', content: `You are a senior news sub-editor. Convert the raw field note into a factual short news item (language: {{languageCode}}). RAW INPUT: {{content}}. Output STRICT JSON: {"title": string, "content": string, "suggestedCategoryName": string}`, description: 'AI short news article drafting' },
    ];
    for (const p of basePrompts) {
        await prisma.prompt.upsert({ where: { key: p.key }, update: { content: p.content, description: p.description }, create: p });
    }
}

async function seedIdCardSettings() {
    // Ensure a default active IdCardSetting exists so that API can be PUT-only
    try {
        const p: any = prisma as any;
        const existing = await (p.idCardSetting?.findFirst?.().catch(() => null));
        if (existing) { log('idcard','settings exist – skip default seed'); return; }
        const created = await (p.idCardSetting?.create?.({
            data: {
                name: 'default',
                isActive: true,
                primaryColor: '#0d6efd',
                secondaryColor: '#6c757d',
                frontH1: 'Human Rights & Civil Initiatives',
                frontH2: 'Identity Card',
                frontFooterText: 'This card remains property of HRCI and must be returned upon request.',
                registerDetails: 'Registered under Societies Act. Valid for 12 months from issue date.'
            }
        }).catch(() => null));
        if (created?.id) {
            // Deactivate any other rows defensively
            try { await p.idCardSetting.updateMany({ where: { id: { not: created.id } }, data: { isActive: false } }); } catch {}
            log('idcard','seeded default IdCardSetting');
        }
    } catch (e: any) {
        log('idcard', `skip seed (client missing or error): ${e?.message || e}`);
    }
}

async function seedCoreUsers(roleMap: Record<string,string>, languageMap: Record<string,string>) {
    log('users','upserting core users');
    const saltRounds = 10;
    const usersToCreate = [
        { mobileNumber: '8282868389', mpin: '1947', roleName: 'SUPER_ADMIN', language: 'en' },
        { mobileNumber: '9502337775', mpin: '1234', roleName: 'LANGUAGE_ADMIN', language: 'te' },
          { mobileNumber: '8906189999', mpin: '1947', roleName: 'HRCI_ADMIN', language: 'en' },
    ];
    for (const u of usersToCreate) {
        const hashed = await bcrypt.hash(u.mpin, saltRounds);
        await prisma.user.upsert({
            where: { mobileNumber: u.mobileNumber },
            update: { mpin: hashed, roleId: roleMap[u.roleName], languageId: languageMap[u.language], status: 'ACTIVE' },
            create: { mobileNumber: u.mobileNumber, mpin: hashed, roleId: roleMap[u.roleName], languageId: languageMap[u.language], status: 'ACTIVE' },
        });
    }
}

async function seedSampleContent(roleMap: Record<string,string>, languageMap: Record<string,string>) {
    if (!FULL_SEED) { log('full','FULL_SEED not set – skipping sample content'); return; }
    log('full','seeding sample articles & short news');

    // Fetch required references (pick first category for simplicity + technology if exists)
    const allCategories = await prisma.category.findMany({ take: 2 });
    if (allCategories.length === 0) { log('full','no categories present – aborting content seed'); return; }
    const [primaryCat, secondaryCat] = allCategories;

    // Ensure we have a reporter (create if missing)
    const reporterMobile = '9000000001';
    const reporterRoleId = roleMap['REPORTER'];
    if (reporterRoleId) {
        const existingReporter = await prisma.user.findUnique({ where: { mobileNumber: reporterMobile } });
        if (!existingReporter) {
            const hashed = await bcrypt.hash('1111', 10);
            await prisma.user.create({ data: { mobileNumber: reporterMobile, mpin: hashed, roleId: reporterRoleId, languageId: languageMap['en'], status: 'ACTIVE' } });
            log('full','created reporter user 9000000001 / mpin 1111');
        }
    }

    const superAdmin = await prisma.user.findUnique({ where: { mobileNumber: '8282868389' } });
    const reporter = await prisma.user.findUnique({ where: { mobileNumber: reporterMobile } });
    if (!superAdmin || !reporter) { log('full','missing core users – skipping content'); return; }

    // ARTICLES ----------------------------------------------------------------
    const existingArticleCount = await prisma.article.count();
    if (existingArticleCount < 3) {
        const toCreate = [
            { title: 'Tech Policy Update', content: 'Government released new guidelines for emerging AI startups today.', authorId: superAdmin.id, categories: [primaryCat.id] },
            { title: 'Local Sports Event', content: 'District level athletics meet concluded with record participation.', authorId: reporter.id, categories: [primaryCat.id] },
            { title: 'Market Opening Gains', content: 'Stocks opened higher on optimism around quarterly earnings.', authorId: reporter.id, categories: [secondaryCat?.id || primaryCat.id] },
        ];
        for (const art of toCreate) {
            try {
                await prisma.article.create({ data: { title: art.title, content: art.content, authorId: art.authorId, type: 'citizen', categories: { connect: art.categories.map(id => ({ id })) }, contentJson: { seed: true } } });
            } catch (e:any) {
                log('full',`article seed skipped (${art.title}): ${e.message}`);
            }
        }
        log('full',`seeded sample articles (created up to 3)`);
    } else {
        log('full','articles already present – skipping sample article creation');
    }

    // SHORT NEWS ---------------------------------------------------------------
    const existingShortNews = await prisma.shortNews.count();
    if (existingShortNews < 5) {
        const snSamples = [
            { title: 'Light Rain In City', content: 'Light showers brought relief to residents this morning.', status: 'AI_APPROVED', authorId: reporter.id },
            { title: 'Highway Repair Works', content: 'Repair works started overnight to fix damaged stretch.', status: 'DESK_PENDING', authorId: reporter.id },
            { title: 'School Science Fair', content: 'Students showcased eco-friendly innovations at annual fair.', status: 'DESK_APPROVED', authorId: superAdmin.id },
            { title: 'Power Outage Restored', content: 'Power supply restored after brief maintenance shutdown.', status: 'DESK_APPROVED', authorId: superAdmin.id },
            { title: 'New Library Opened', content: 'Community library inaugurated with digital access section.', status: 'PENDING', authorId: reporter.id },
        ];
            for (const sn of snSamples) {
                try {
                    // readCount field may not exist in generated client yet (schema drift) – create then update defensively
                    const created = await (prisma as any).shortNews.create({ data: { title: sn.title, content: sn.content, authorId: sn.authorId, categoryId: primaryCat.id, status: sn.status, tags: [], mediaUrls: [], language: 'en' } });
                    try { await (prisma as any).shortNews.update({ where: { id: created.id }, data: { readCount: Math.floor(Math.random()*50) } }); } catch {}
                } catch (e:any) {
                    log('full',`short news seed skipped (${sn.title}): ${e.message}`);
                }
            }
        log('full','seeded sample short news items');
    } else {
        log('full','short news already present – skipping sample items');
    }

    // Basic metrics seeding (content reads + reactions) for first short news & article if they exist
    try {
        const oneArticle = await prisma.article.findFirst();
        const oneShort = await prisma.shortNews.findFirst();
        if (oneArticle && oneShort) {
            const existingReads = await prisma.contentRead.count();
            if (existingReads === 0) {
                await prisma.contentRead.createMany({ data: [
                    { userId: superAdmin.id, contentId: oneArticle.id, contentType: 'ARTICLE', totalTimeMs: 5000, maxScrollPercent: 80 },
                    { userId: reporter.id, contentId: oneShort.id, contentType: 'SHORTNEWS', totalTimeMs: 3000, maxScrollPercent: 100, completed: true },
                ]});
            }
            const existingReactions = await prisma.contentReaction.count();
            if (existingReactions === 0) {
                await prisma.contentReaction.createMany({ data: [
                    { userId: superAdmin.id, contentId: oneShort.id, contentType: 'SHORTNEWS', reaction: 'LIKE' },
                    { userId: reporter.id, contentId: oneArticle.id, contentType: 'ARTICLE', reaction: 'LIKE' },
                ]});
            }
        }
    } catch (e:any) {
        log('full',`metrics seeding partial failure: ${e.message}`);
    }
}

    async function seedDevices(roleMap: Record<string,string>, languageMap: Record<string,string>) {
        log('devices','seeding sample devices');
        const coreUsers = await prisma.user.findMany({ where: { mobileNumber: { in: ['8282868389','9502337775','9000000001'] } } });
        for (const u of coreUsers) {
            const deviceId = `dev-${u.mobileNumber}`;
            const existing = await prisma.device.findUnique({ where: { deviceId } });
            if (!existing) {
                await prisma.device.create({ data: { deviceId, deviceModel: 'SeedPhone 1.0', userId: u.id, pushToken: `debug-token-${u.mobileNumber}`, languageId: u.languageId, roleId: u.roleId } });
            }
        }
        // Guest device (role + language without user)
        const guestDeviceId = 'dev-guest-demo';
        const guestRoleId = roleMap['GUEST'];
        const enId = languageMap['en'];
        if (guestRoleId && enId) {
            const existingGuest = await prisma.device.findUnique({ where: { deviceId: guestDeviceId } });
            if (!existingGuest) {
                await prisma.device.create({ data: { deviceId: guestDeviceId, deviceModel: 'SeedPhone Guest', roleId: guestRoleId, languageId: enId, pushToken: 'debug-token-guest' } });
            }
        }
    }

    async function seedComments() {
        if (!FULL_SEED) return; // only with full content
        log('comments','seeding sample comments');
        const article = await prisma.article.findFirst();
        const shortNews = await prisma.shortNews.findFirst();
        const users = await prisma.user.findMany({ take: 2 });
        if (!users.length) return;
        if (article) {
            const existing = await prisma.comment.findFirst({ where: { articleId: article.id } });
            if (!existing) {
                const parent = await prisma.comment.create({ data: { articleId: article.id, userId: users[0].id, content: 'Great background context.' } });
                await prisma.comment.create({ data: { articleId: article.id, userId: users[1]?.id || users[0].id, content: 'Agree, interesting development.', parentId: parent.id } });
            }
        }
        if (shortNews) {
            const existingSN = await prisma.comment.findFirst({ where: { shortNewsId: shortNews.id } });
            if (!existingSN) {
                await prisma.comment.create({ data: { shortNewsId: shortNews.id, userId: users[0].id, content: 'Concise update.' } });
            }
        }
    }

async function main() {
    log('init', `Starting seed (FORCE_WIPE=${FORCE_WIPE ? 'YES':'no'}, FULL_SEED=${FULL_SEED ? 'YES':'no'})`);
    await forceWipe();
    const roleMap = await seedRoles();
    const languageMap = await seedLanguages();
    await seedCountryAndStates();
    await seedCategoriesAndTranslations(languageMap);
    await seedPrompts();
    await seedIdCardSettings();
    await seedCoreUsers(roleMap, languageMap);
    await seedSampleContent(roleMap, languageMap);
    await seedDevices(roleMap, languageMap);
    await seedComments();
    // Summary counts (best-effort)
    try {
        const [userCount, articleCount, snCount, commentCount, deviceCount, reactCount] = await Promise.all([
            prisma.user.count(), prisma.article.count(), prisma.shortNews.count(), prisma.comment.count(), prisma.device.count(), prisma.contentReaction.count()
        ]);
        log('summary',`users=${userCount} articles=${articleCount} shortNews=${snCount} comments=${commentCount} devices=${deviceCount} reactions=${reactCount}`);
    } catch {}
    log('done','Seed process completed (core phase).');
}

main().catch(e => { console.error('[seed:error]', e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });


