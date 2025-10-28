require('dotenv-flow').config();
import '../src/config/env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
// Some editors show stale Prisma client types before `npx prisma generate` runs.
// We defensively cast to any for new HRCI delegates to prevent TS compile errors.
const p: any = prisma;

// Minimal authoritative dataset for India -> (Telangana, Andhra Pradesh) with districts and a few mandals samples.
// Extend as needed; structure built for idempotent upserts.

const INDIA_CODE = 'IN';
const SOUTH_ZONE = 'SOUTH';

interface MandalSeed { name: string }
interface DistrictSeed { name: string; mandals: MandalSeed[] }
interface StateSeed { name: string; code?: string; zone: 'NORTH'|'SOUTH'|'EAST'|'WEST'|'CENTRAL'; districts: DistrictSeed[] }

// Zone mapping approach (simplified regional grouping):
// NORTH: JK, HP, PB, HR, CH, DL, UK, RJ
// EAST: BR, JH, WB, OD
// WEST: GJ, MH, GA, DD&DNH (assign to WEST)
// CENTRAL: MP, CG, (we keep CENTRAL small & focused)
// SOUTH: AP, TG, KA, KL, TN, PY, LAK, AN (Lakshadweep), LD (handled as LAK), AN (Andaman & Nicobar)
// NORTH-EAST (not separately in enum, we approximate to EAST): AS, MN, MZ, NL, ML, TR, AR, SK, (Sikkim), Meghalaya etc => map to EAST.
// UTs not fitting above: Ladakh -> NORTH, Chandigarh -> NORTH, Delhi -> NORTH, Puducherry -> SOUTH, Daman & Diu / Dadra & Nagar Haveli -> WEST

const states: StateSeed[] = [
  // Existing detailed states first (retain full district structure for TG & AP):
  {
    name: 'Telangana', code: 'TG', zone: SOUTH_ZONE, districts: [
      { name: 'Adilabad', mandals: [ { name: 'Adilabad Urban' }, { name: 'Bela' } ] },
      { name: 'Bhadradri Kothagudem', mandals: [ { name: 'Kothagudem' }, { name: 'Paloncha' } ] },
      { name: 'Hanumakonda', mandals: [ { name: 'Hanamkonda' }, { name: 'Khila Warangal' } ] },
      { name: 'Hyderabad', mandals: [ { name: 'Shaikpet' }, { name: 'Ameerpet' } ] },
      { name: 'Jagitial', mandals: [ { name: 'Jagtial Rural' }, { name: 'Mallial' } ] },
      { name: 'Jangoan', mandals: [ { name: 'Jangaon' }, { name: 'Lingalaghanpur' } ] },
      { name: 'Jayashankar Bhupalpally', mandals: [ { name: 'Bhupalpally' }, { name: 'Chityal' } ] },
      { name: 'Jogulamba Gadwal', mandals: [ { name: 'Gadwal' }, { name: 'Ieeja' } ] },
      { name: 'Kamareddy', mandals: [ { name: 'Kamareddy' }, { name: 'Yellareddy' } ] },
      { name: 'Karimnagar', mandals: [ { name: 'Karimnagar Rural' }, { name: 'Choppadandi' } ] },
      { name: 'Khammam', mandals: [ { name: 'Khammam Urban' }, { name: 'Enkoor' } ] },
      { name: 'Kumuram Bheem Asifabad', mandals: [ { name: 'Asifabad' }, { name: 'Kagaznagar' } ] },
      { name: 'Mahabubabad', mandals: [ { name: 'Mahabubabad' }, { name: 'Nellikuduru' } ] },
      { name: 'Mahabubnagar', mandals: [ { name: 'Mahbubnagar' }, { name: 'Bhootpur' } ] },
      { name: 'Mancherial', mandals: [ { name: 'Mancherial' }, { name: 'Luxettipet' } ] },
      { name: 'Medak', mandals: [ { name: 'Medak' }, { name: 'Ramayampet' } ] },
      { name: 'Medchal Malkajgiri', mandals: [ { name: 'Keesara' }, { name: 'Ghatkesar' } ] },
      { name: 'Mulugu', mandals: [ { name: 'Venkatapur' }, { name: 'Eturnagaram' } ] },
      { name: 'Nagarkurnool', mandals: [ { name: 'Nagarkurnool' }, { name: 'Achampet' } ] },
      { name: 'Nalgonda', mandals: [ { name: 'Nalgonda Rural' }, { name: 'Muktyala' } ] },
      { name: 'Narayanpet', mandals: [ { name: 'Narayanpet' }, { name: 'Utkoor' } ] },
      { name: 'Nirmal', mandals: [ { name: 'Nirmal' }, { name: 'Sarangapur' } ] },
      { name: 'Nizamabad', mandals: [ { name: 'Nizamabad North' }, { name: 'Dichpalle' } ] },
      { name: 'Peddapalli', mandals: [ { name: 'Peddapalli' }, { name: 'Manthani' } ] },
      { name: 'Rajanna Sircilla', mandals: [ { name: 'Sircilla' }, { name: 'Gambhiraopet' } ] },
      { name: 'Ranga Reddy', mandals: [ { name: 'Serilingampalle' }, { name: 'Rajendranagar' } ] },
      { name: 'Sangareddy', mandals: [ { name: 'Sangareddy' }, { name: 'Patancheru' } ] },
      { name: 'Siddipet', mandals: [ { name: 'Siddipet Urban' }, { name: 'Dubbak' } ] },
      { name: 'Suryapet', mandals: [ { name: 'Suryapet' }, { name: 'Mothey' } ] },
      { name: 'Vikarabad', mandals: [ { name: 'Vikarabad' }, { name: 'Tandur' } ] },
      { name: 'Wanaparthy', mandals: [ { name: 'Wanaparthy' }, { name: 'Pebbair' } ] },
      { name: 'Warangal', mandals: [ { name: 'Warangal' }, { name: 'Sangem' } ] },
      { name: 'Yadadri Bhuvanagiri', mandals: [ { name: 'Bhongir' }, { name: 'Bibinagar' } ] }
    ]
  },
  {
    name: 'Andhra Pradesh', code: 'AP', zone: SOUTH_ZONE, districts: [
      { name: 'Alluri Sitharama Raju', mandals: [ { name: 'Paderu' }, { name: 'Chintapalle' } ] },
      { name: 'Anakapalli', mandals: [ { name: 'Anakapalle' }, { name: 'Atchutapuram' } ] },
      { name: 'Annamayya', mandals: [ { name: 'Rayachoti' }, { name: 'Lakkireddypalli' } ] },
      { name: 'Bapatla', mandals: [ { name: 'Bapatla' }, { name: 'Karlapalem' } ] },
      { name: 'Chittoor', mandals: [ { name: 'Chittoor' }, { name: 'Palamaner' } ] },
      { name: 'East Godavari', mandals: [ { name: 'Kakinada Rural' }, { name: 'Peddapuram' } ] },
      { name: 'Eluru', mandals: [ { name: 'Eluru' }, { name: 'Pedapadu' } ] },
      { name: 'Guntur', mandals: [ { name: 'Amaravathi' }, { name: 'Mangalagiri' } ] },
      { name: 'Kakinada', mandals: [ { name: 'Kakinada Urban' }, { name: 'Thallarevu' } ] },
      { name: 'Konaseema', mandals: [ { name: 'Amalapuram' }, { name: 'Mummidivaram' } ] },
      { name: 'Krishna', mandals: [ { name: 'Machilipatnam' }, { name: 'Gudivada' } ] },
      { name: 'Kurnool', mandals: [ { name: 'Kurnool' }, { name: 'Panyam' } ] },
      { name: 'Nandyal', mandals: [ { name: 'Nandyal' }, { name: 'Banaganapalli' } ] },
      { name: 'NTR', mandals: [ { name: 'Vijayawada Rural' }, { name: 'G Konduru' } ] },
      { name: 'Palnadu', mandals: [ { name: 'Narasaraopet' }, { name: 'Sattenapalli' } ] },
      { name: 'Parvathipuram Manyam', mandals: [ { name: 'Parvathipuram' }, { name: 'Salur' } ] },
      { name: 'Prakasam', mandals: [ { name: 'Ongole' }, { name: 'Chimakurthy' } ] },
      { name: 'Sri Potti Sriramulu Nellore', mandals: [ { name: 'Nellore' }, { name: 'Kovur' } ] },
      { name: 'Sri Sathya Sai', mandals: [ { name: 'Puttaparthi' }, { name: 'Dharmavaram' } ] },
      { name: 'Srikakulam', mandals: [ { name: 'Srikakulam' }, { name: 'Amadalavalasa' } ] },
      { name: 'Tirupati', mandals: [ { name: 'Tirupati Rural' }, { name: 'Renigunta' } ] },
      { name: 'Visakhapatnam', mandals: [ { name: 'Visakhapatnam Urban' }, { name: 'Gopalapatnam' } ] },
      { name: 'Vizianagaram', mandals: [ { name: 'Vizianagaram' }, { name: 'Gajapathinagaram' } ] },
      { name: 'West Godavari', mandals: [ { name: 'Bhimavaram' }, { name: 'Tanuku' } ] },
      { name: 'YSR Kadapa', mandals: [ { name: 'Kadapa' }, { name: 'Pulivendula' } ] }
    ]
  },
  // Remaining Indian States & Union Territories with placeholder single district matching state name.
  // NORTH
  { name: 'Jammu and Kashmir', code: 'JK', zone: 'NORTH', districts: [ { name: 'Jammu and Kashmir', mandals: [ { name: 'JK Sample' } ] } ] },
  { name: 'Himachal Pradesh', code: 'HP', zone: 'NORTH', districts: [ { name: 'Himachal Pradesh', mandals: [ { name: 'HP Sample' } ] } ] },
  { name: 'Punjab', code: 'PB', zone: 'NORTH', districts: [ { name: 'Punjab', mandals: [ { name: 'PB Sample' } ] } ] },
  { name: 'Haryana', code: 'HR', zone: 'NORTH', districts: [ { name: 'Haryana', mandals: [ { name: 'HR Sample' } ] } ] },
  { name: 'Chandigarh', code: 'CH', zone: 'NORTH', districts: [ { name: 'Chandigarh', mandals: [ { name: 'CH Sample' } ] } ] },
  { name: 'Delhi', code: 'DL', zone: 'NORTH', districts: [ { name: 'Delhi', mandals: [ { name: 'DL Sample' } ] } ] },
  { name: 'Uttarakhand', code: 'UK', zone: 'NORTH', districts: [ { name: 'Uttarakhand', mandals: [ { name: 'UK Sample' } ] } ] },
  { name: 'Rajasthan', code: 'RJ', zone: 'NORTH', districts: [ { name: 'Rajasthan', mandals: [ { name: 'RJ Sample' } ] } ] },
  // EAST (includes North-East approximated)
  { name: 'Bihar', code: 'BR', zone: 'EAST', districts: [ { name: 'Bihar', mandals: [ { name: 'BR Sample' } ] } ] },
  { name: 'Jharkhand', code: 'JH', zone: 'EAST', districts: [ { name: 'Jharkhand', mandals: [ { name: 'JH Sample' } ] } ] },
  { name: 'West Bengal', code: 'WB', zone: 'EAST', districts: [ { name: 'West Bengal', mandals: [ { name: 'WB Sample' } ] } ] },
  { name: 'Odisha', code: 'OD', zone: 'EAST', districts: [ { name: 'Odisha', mandals: [ { name: 'OD Sample' } ] } ] },
  { name: 'Assam', code: 'AS', zone: 'EAST', districts: [ { name: 'Assam', mandals: [ { name: 'AS Sample' } ] } ] },
  { name: 'Manipur', code: 'MN', zone: 'EAST', districts: [ { name: 'Manipur', mandals: [ { name: 'MN Sample' } ] } ] },
  { name: 'Mizoram', code: 'MZ', zone: 'EAST', districts: [ { name: 'Mizoram', mandals: [ { name: 'MZ Sample' } ] } ] },
  { name: 'Nagaland', code: 'NL', zone: 'EAST', districts: [ { name: 'Nagaland', mandals: [ { name: 'NL Sample' } ] } ] },
  { name: 'Meghalaya', code: 'ML', zone: 'EAST', districts: [ { name: 'Meghalaya', mandals: [ { name: 'ML Sample' } ] } ] },
  { name: 'Tripura', code: 'TR', zone: 'EAST', districts: [ { name: 'Tripura', mandals: [ { name: 'TR Sample' } ] } ] },
  { name: 'Arunachal Pradesh', code: 'AR', zone: 'EAST', districts: [ { name: 'Arunachal Pradesh', mandals: [ { name: 'AR Sample' } ] } ] },
  { name: 'Sikkim', code: 'SK', zone: 'EAST', districts: [ { name: 'Sikkim', mandals: [ { name: 'SK Sample' } ] } ] },
  // WEST
  { name: 'Gujarat', code: 'GJ', zone: 'WEST', districts: [ { name: 'Gujarat', mandals: [ { name: 'GJ Sample' } ] } ] },
  { name: 'Maharashtra', code: 'MH', zone: 'WEST', districts: [ { name: 'Maharashtra', mandals: [ { name: 'MH Sample' } ] } ] },
  { name: 'Goa', code: 'GA', zone: 'WEST', districts: [ { name: 'Goa', mandals: [ { name: 'GA Sample' } ] } ] },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', code: 'DN', zone: 'WEST', districts: [ { name: 'Dadra and Nagar Haveli and Daman and Diu', mandals: [ { name: 'DN Sample' } ] } ] },
  // CENTRAL
  { name: 'Madhya Pradesh', code: 'MP', zone: 'CENTRAL', districts: [ { name: 'Madhya Pradesh', mandals: [ { name: 'MP Sample' } ] } ] },
  { name: 'Chhattisgarh', code: 'CG', zone: 'CENTRAL', districts: [ { name: 'Chhattisgarh', mandals: [ { name: 'CG Sample' } ] } ] },
  // SOUTH (remaining)
  { name: 'Karnataka', code: 'KA', zone: 'SOUTH', districts: [ { name: 'Karnataka', mandals: [ { name: 'KA Sample' } ] } ] },
  { name: 'Kerala', code: 'KL', zone: 'SOUTH', districts: [ { name: 'Kerala', mandals: [ { name: 'KL Sample' } ] } ] },
  { name: 'Tamil Nadu', code: 'TN', zone: 'SOUTH', districts: [ { name: 'Tamil Nadu', mandals: [ { name: 'TN Sample' } ] } ] },
  { name: 'Puducherry', code: 'PY', zone: 'SOUTH', districts: [ { name: 'Puducherry', mandals: [ { name: 'PY Sample' } ] } ] },
  { name: 'Andaman and Nicobar Islands', code: 'AN', zone: 'SOUTH', districts: [ { name: 'Andaman and Nicobar Islands', mandals: [ { name: 'AN Sample' } ] } ] },
  { name: 'Lakshadweep', code: 'LD', zone: 'SOUTH', districts: [ { name: 'Lakshadweep', mandals: [ { name: 'LD Sample' } ] } ] },
  { name: 'Ladakh', code: 'LA', zone: 'NORTH', districts: [ { name: 'Ladakh', mandals: [ { name: 'LA Sample' } ] } ] }
];

async function main() {
  console.log('Seeding HRCI locations...');

  if (!p.hrcCountry) {
    throw new Error('Prisma client missing hrcCountry delegate. Run: npx prisma generate');
  }

  const country = await p.hrcCountry.upsert({
    where: { code: INDIA_CODE },
    update: { name: 'India' },
    create: { name: 'India', code: INDIA_CODE }
  });

  for (const state of states) {
  const stateRow = await p.hrcState.upsert({
      where: { name: state.name },
      update: { code: state.code, zone: state.zone, countryId: country.id },
      create: { name: state.name, code: state.code, zone: state.zone, countryId: country.id }
    });

    for (const district of state.districts) {
  const distRow = await p.hrcDistrict.upsert({
        where: { stateId_name: { stateId: stateRow.id, name: district.name } },
        update: {},
        create: { name: district.name, stateId: stateRow.id }
      });

      for (const mandal of district.mandals) {
  await p.hrcMandal.upsert({
          where: { districtId_name: { districtId: distRow.id, name: mandal.name } },
          update: {},
          create: { name: mandal.name, districtId: distRow.id }
        });
      }
    }
  }

  console.log('HRCI locations seed complete.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
