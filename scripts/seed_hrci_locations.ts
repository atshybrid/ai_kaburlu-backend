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

const states: StateSeed[] = [
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
  }
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
