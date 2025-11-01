/**
 * Demo script showing how to update ID card settings with office addresses and contact numbers via API
 * 
 * Usage: 
 * 1. Start the server: npm start
 * 2. Get JWT token by logging in as HRCI admin
 * 3. Use the token in this script or test the API endpoints directly
 */

require('dotenv-flow').config();
import '../src/config/env';

// Example API request to update ID card settings
const DEMO_UPDATE_PAYLOAD = {
  // Office addresses
  headOfficeAddress: `HEAD OFFICE
7/19 CENAL CENTER KARAMCHEDU
PRAKASAM, BAPATLA
Andhra Pradesh - 523138, INDIA`,

  regionalOfficeAddress: `REGIONAL OFFICE
Regional Complex, Main Road
Commercial District
Hyderabad, Telangana - 500001, INDIA`,

  administrationOfficeAddress: `ADMINISTRATION OFFICE
Government Complex, Sector-12
Administrative Wing
New Delhi - 110001, INDIA`,

  // Contact numbers
  contactNumber1: '+91-9876543210',
  contactNumber2: '+91-9876543211',

  // Other existing fields (optional to update)
  frontH1: 'HUMAN RIGHTS COUNCIL FOR INDIA',
  frontH2: 'Identity Card',
  primaryColor: '#0d6efd',
  secondaryColor: '#6c757d'
};

async function demonstrateIdCardSettingsUpdate() {
  console.log('=== ID CARD SETTINGS UPDATE DEMO ===\n');
  
  console.log('📝 Example API Request:');
  console.log('PUT /api/v1/hrci/idcard/settings/{settingId}');
  console.log('Authorization: Bearer <JWT_TOKEN>');
  console.log('Content-Type: application/json\n');
  
  console.log('📦 Request Body:');
  console.log(JSON.stringify(DEMO_UPDATE_PAYLOAD, null, 2));
  
  console.log('\n🔍 What this will do:');
  console.log('✅ Add HEAD OFFICE address to ID cards');
  console.log('✅ Add REGIONAL OFFICE address to ID cards');
  console.log('✅ Add ADMINISTRATION OFFICE address to ID cards');
  console.log('✅ Add Contact Number 1 and Contact Number 2');
  console.log('✅ Update the back side of the ID card template');
  
  console.log('\n🎯 API Endpoints to test:');
  console.log('1. GET /api/v1/hrci/idcard/settings - List all settings');
  console.log('2. PUT /api/v1/hrci/idcard/settings/{id} - Update settings');
  console.log('3. GET /api/v1/hrci/idcard/{cardNumber}/html - See updated card design');
  
  console.log('\n📋 Steps to test:');
  console.log('1. Login as HRCI admin to get JWT token');
  console.log('2. GET the current settings to find the ID');
  console.log('3. PUT the update with new address and contact fields');
  console.log('4. Visit any existing ID card HTML view to see changes');
  
  console.log('\n💡 The ID card will now show:');
  console.log('   - Head Office (existing field)');
  console.log('   - Regional Office (new field)');
  console.log('   - Administration Office (new field)');
  console.log('   - Contact: +91-9876543210, +91-9876543211 (new fields)');
}

demonstrateIdCardSettingsUpdate().catch(console.error);