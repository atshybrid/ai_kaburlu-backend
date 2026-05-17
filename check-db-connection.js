#!/usr/bin/env node

/**
 * Check DigitalOcean Droplet Database Connectivity
 * Diagnoses connection issues to production database
 */

const net = require('net');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const DB_HOST = '64.23.234.90';
const DB_PORT = 5432;

async function checkConnectivity() {
  console.log(`\n🔌 DATABASE CONNECTIVITY CHECK\n`);
  console.log(`Database Host: ${DB_HOST}`);
  console.log(`Database Port: ${DB_PORT}\n`);
  
  // Step 1: TCP connectivity test
  console.log('Step 1️⃣: TCP Port Test...');
  try {
    const result = await new Promise((resolve, reject) => {
      const socket = net.createConnection(DB_PORT, DB_HOST);
      socket.setTimeout(5000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      });
      
      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });
    });
    
    console.log(`✅ TCP connection successful\n`);
  } catch (err) {
    console.log(`❌ TCP connection FAILED: ${err.message}\n`);
    console.log(`Possible causes:`);
    console.log(`  1. Droplet is down or stopped`);
    console.log(`  2. Firewall/security group blocking port 5432`);
    console.log(`  3. Network unreachable`);
    console.log(`  4. PostgreSQL service not running on droplet\n`);
    
    console.log(`Solutions:`);
    console.log(`  1. SSH to droplet and check status:`);
    console.log(`     ssh root@${DB_HOST}`);
    console.log(`     systemctl status postgresql\n`);
    
    console.log(`  2. Try restarting PostgreSQL:`);
    console.log(`     systemctl restart postgresql\n`);
    
    console.log(`  3. Check firewall rules in DigitalOcean console\n`);
    
    return;
  }
  
  // Step 2: Environment check
  console.log('Step 2️⃣: Environment Variables...');
  if (process.env.DATABASE_URL) {
    console.log(`✅ DATABASE_URL set`);
    console.log(`   Host: ${process.env.DATABASE_URL.match(/@([^:]+)/)?.[1] || 'N/A'}`);
  } else {
    console.log(`⚠️  DATABASE_URL not set in current environment`);
  }
  
  if (process.env.PROD_DATABASE_URL) {
    console.log(`✅ PROD_DATABASE_URL set`);
  }
  
  // Step 3: Suggest using development database as fallback
  if (process.env.DEV_DATABASE_URL) {
    console.log(`\n✅ DEV_DATABASE_URL available (Neon cloud database)`);
    console.log(`   You can test with development database if production is down\n`);
  }
}

checkConnectivity().catch(console.error);
