import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const indiaCode = 'IN';
const INDIA_STATES: Record<string, string[]> = {
  'Karnataka': [
    'Bengaluru Urban','Bengaluru Rural','Mysuru','Mandya','Hassan','Tumakuru','Chikkaballapura','Kolar','Chitradurga','Shivamogga','Udupi','Dakshina Kannada','Kodagu','Belagavi','Bagalkot','Vijayapura','Dharwad','Gadag','Haveri','Uttara Kannada','Ballari','Raichur','Koppal','Kalaburagi','Yadgir','Bidar','Ramanagara'
  ],
  'Tamil Nadu': [
    'Chennai','Kancheepuram','Chengalpattu','Tiruvallur','Vellore','Ranipet','Tirupathur','Villupuram','Cuddalore','Nagapattinam','Mayiladuthurai','Thanjavur','Tiruvarur','Pudukkottai','Sivaganga','Madurai','Theni','Dindigul','Ramanathapuram','Virudhunagar','Thoothukudi','Tirunelveli','Tenkasi','Kanniyakumari','The Nilgiris','Coimbatore','Erode','Tiruppur','Karur','Salem','Namakkal','Dharmapuri','Krishnagiri','Ariyalur','Perambalur'
  ],
  'Kerala': [
    'Thiruvananthapuram','Kollam','Pathanamthitta','Alappuzha','Kottayam','Idukki','Ernakulam','Thrissur','Palakkad','Malappuram','Kozhikode','Wayanad','Kannur','Kasaragod'
  ],
};

async function upsertCountry(name: string, code?: string) {
  const existing = await prisma.country.findUnique({ where: { name } });
  if (existing) return existing;
  return prisma.country.create({ data: { name, code } });
}

async function upsertState(name: string, countryId: string) {
  const existing = await prisma.state.findUnique({ where: { name } });
  if (existing) return existing;
  return prisma.state.create({ data: { name, countryId } });
}

async function ensureDistrict(stateId: string, name: string) {
  const found = await prisma.district.findFirst({ where: { name, stateId } });
  if (found) return found;
  return prisma.district.create({ data: { name, stateId } });
}

async function main() {
  const india = await upsertCountry('India', indiaCode);
  for (const [stateName, districts] of Object.entries(INDIA_STATES)) {
    const state = await upsertState(stateName, india.id);
    for (const d of districts) {
      await ensureDistrict(state.id, d);
    }
  }
  console.log('Seeded India states/districts (Karnataka, Tamil Nadu, Kerala).');
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
