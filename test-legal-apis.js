// test-legal-apis.js
const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api/v1';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjbWZ3aGZpajQwMDRxdWc2MGFjb2V5ZHh6Iiwicm9sZSI6IlNVUEVSX0FETUlOIiwicGVybWlzc2lvbnMiOlsiY3JlYXRlIiwicmVhZCIsInVwZGF0ZSIsImRlbGV0ZSIsImFwcHJvdmUiLCJyZWplY3QiXSwiaWF0IjoxNzU4OTU0NTU3LCJleHAiOjE3NTkwNDA5NTd9.0LM8STW6gJ3e9GYQXsoFM9hrOyVpzcKofnYQRM6KPJ4';

async function testLegalAPIs() {
  console.log('🧪 Testing Legal Document APIs...\n');

  try {
    // Test 1: Create a Terms & Conditions document
    console.log('1️⃣ Creating Terms & Conditions...');
    const termsData = {
      title: 'KhabarX News Terms & Conditions',
      content: '<h1>Terms and Conditions</h1><p>Welcome to KhabarX News. By using our app, you agree to these terms.</p><h2>1. Use of the App</h2><p>Our app provides news content for personal use.</p>',
      version: '1.0',
      language: 'en'
    };

    const termsResponse = await axios.post(`${BASE_URL}/legal/terms/admin`, termsData, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Terms created:', termsResponse.data);

    // Test 2: Create a Privacy Policy document
    console.log('\n2️⃣ Creating Privacy Policy...');
    const privacyData = {
      title: 'KhabarX News Privacy Policy',
      content: '<h1>Privacy Policy</h1><p>We respect your privacy and are committed to protecting your data.</p><h2>1. Information We Collect</h2><p>We collect information to provide better services.</p>',
      version: '1.0',
      language: 'en'
    };

    const privacyResponse = await axios.post(`${BASE_URL}/legal/privacy/admin`, privacyData, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Privacy Policy created:', privacyResponse.data);

    // Test 3: Activate the Terms document
    console.log('\n3️⃣ Activating Terms & Conditions...');
    const activateTermsResponse = await axios.put(`${BASE_URL}/legal/terms/admin/${termsResponse.data.id}/activate`, {}, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Terms activated:', activateTermsResponse.data);

    // Test 4: Activate the Privacy Policy
    console.log('\n4️⃣ Activating Privacy Policy...');
    const activatePrivacyResponse = await axios.put(`${BASE_URL}/legal/privacy/admin/${privacyResponse.data.id}/activate`, {}, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Privacy Policy activated:', activatePrivacyResponse.data);

    // Test 5: Get public Terms & Conditions (JSON)
    console.log('\n5️⃣ Getting public Terms & Conditions (JSON)...');
    const publicTermsResponse = await axios.get(`${BASE_URL}/legal/terms`);
    console.log('✅ Public Terms (JSON):', publicTermsResponse.data);

    // Test 6: Get public Privacy Policy (JSON)
    console.log('\n6️⃣ Getting public Privacy Policy (JSON)...');
    const publicPrivacyResponse = await axios.get(`${BASE_URL}/legal/privacy`);
    console.log('✅ Public Privacy Policy (JSON):', publicPrivacyResponse.data);

    // Test 7: Get public Terms & Conditions (HTML)
    console.log('\n7️⃣ Getting public Terms & Conditions (HTML)...');
    const publicTermsHtmlResponse = await axios.get(`${BASE_URL}/legal/terms/html`);
    console.log('✅ Public Terms (HTML):', publicTermsHtmlResponse.data.substring(0, 200) + '...');

    // Test 8: Get public Privacy Policy (HTML)
    console.log('\n8️⃣ Getting public Privacy Policy (HTML)...');
    const publicPrivacyHtmlResponse = await axios.get(`${BASE_URL}/legal/privacy/html`);
    console.log('✅ Public Privacy Policy (HTML):', publicPrivacyHtmlResponse.data.substring(0, 200) + '...');

    // Test 9: List all admin documents
    console.log('\n9️⃣ Listing all Terms & Conditions (Admin)...');
    const allTermsResponse = await axios.get(`${BASE_URL}/legal/terms/admin`, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`
      }
    });
    console.log('✅ All Terms (Admin):', allTermsResponse.data);

    console.log('\n🎉 All tests passed! Legal Document APIs are working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
    }
  }
}

// Run the tests
testLegalAPIs();