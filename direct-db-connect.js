#!/usr/bin/env node

/**
 * Direct Database Connection Test & Query
 * Connects directly to PostgreSQL at 64.23.234.90:5432
 */

const { Pool } = require('pg');

const pool = new Pool({
  user: 'khabarx_owner',
  password: 'mMIvTgbmqj8eQc7iiW4TZzKyjGP9JhyO',
  host: '64.23.234.90',
  port: 5432,
  database: 'khabarxprod',
});

async function connectAndTest() {
  try {
    console.log(`\n🔌 Direct Database Connection Test`);
    console.log(`===================================\n`);
    console.log(`Host: 64.23.234.90`);
    console.log(`Port: 5432`);
    console.log(`Database: khabarxprod\n`);
    
    console.log('Connecting...');
    const client = await pool.connect();
    
    console.log('✅ Connected successfully!\n');
    
    // Test query
    const result = await client.query('SELECT version();');
    console.log('📦 PostgreSQL Version:');
    console.log(result.rows[0].version);
    console.log();
    
    // Check if users table exists and has data
    const userCount = await client.query('SELECT COUNT(*) as count FROM "User";');
    console.log(`👥 Total users: ${userCount.rows[0].count}`);
    
    // Check for specific phone number
    const phone = process.argv[2] || '7075663455';
    console.log(`\n🔍 Searching for member: ${phone}\n`);
    
    const userQuery = await client.query(
      `SELECT id, "mobileNumber", "fullName", status FROM "User" 
       WHERE "mobileNumber" = $1 OR "mobileNumber" LIKE $2 
       LIMIT 5`,
      [phone, `%${phone.slice(-10)}%`]
    );
    
    if (userQuery.rows.length === 0) {
      console.log(`❌ Member not found`);
    } else {
      console.log(`✅ Found ${userQuery.rows.length} user(s):\n`);
      userQuery.rows.forEach((user, idx) => {
        console.log(`${idx + 1}. ID: ${user.id}`);
        console.log(`   Phone: ${user.mobileNumber}`);
        console.log(`   Name: ${user.fullName}`);
        console.log(`   Status: ${user.status}\n`);
      });
      
      // Get membership for first user
      if (userQuery.rows.length > 0) {
        const userId = userQuery.rows[0].id;
        const memQuery = await client.query(
          `SELECT id, status, "idCardStatus", "designationId" FROM "Membership" 
           WHERE "userId" = $1`,
          [userId]
        );
        
        if (memQuery.rows.length > 0) {
          console.log(`📋 Membership Details:\n`);
          memQuery.rows.forEach((mem, idx) => {
            console.log(`${idx + 1}. ID: ${mem.id}`);
            console.log(`   Status: ${mem.status}`);
            console.log(`   Card Status: ${mem.idCardStatus}\n`);
          });
        }
      }
    }
    
    client.release();
    
    console.log(`\n✅ DATABASE IS ONLINE AND RESPONDING!\n`);
    console.log(`You can now run:`);
    console.log(`node check-and-issue-card.js ${phone}\n`);
    
  } catch (err) {
    console.error(`\n❌ Connection Failed: ${err.message}\n`);
    console.error(`Possible causes:`);
    console.error(`  1. PostgreSQL daemon not running on droplet`);
    console.error(`  2. Firewall blocking port 5432`);
    console.error(`  3. Database credentials incorrect`);
    console.error(`  4. Network unreachable\n`);
    
  } finally {
    await pool.end();
  }
}

connectAndTest();
