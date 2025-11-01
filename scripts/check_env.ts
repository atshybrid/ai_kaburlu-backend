require('dotenv-flow').config();
import '../src/config/env'; // This will set DATABASE_URL properly

async function main() {
  console.log('DATABASE_URL is set:', !!process.env.DATABASE_URL);
  console.log('DATABASE_URL (first 50 chars):', process.env.DATABASE_URL?.substring(0, 50));
}

main().catch(console.error);