const https = require('https');
const http = require('http');

const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjbWdxN3UyYjIwMDR4dWdvb3llN3Zydnp5Iiwicm9sZSI6IkhSQ0lfQURNSU4iLCJwZXJtaXNzaW9ucyI6eyJocmMiOnsiY2FzZXMiOlsiY3JlYXRlIiwicmVhZCIsInVwZGF0ZSIsImFzc2lnbiIsImNsb3NlIl0sInRlYW1zIjpbImNyZWF0ZSIsInJlYWQiLCJ1cGRhdGUiXSwiaWRjYXJkcyI6WyJpc3N1ZSIsInJlbmV3IiwicmV2b2tlIl0sInBheW1lbnRzIjpbImNyZWF0ZSIsInJlZnVuZCIsInJlYWQiXSwiZG9uYXRpb25zIjpbInJlYWQiXSwidm9sdW50ZWVycyI6WyJvbmJvYXJkIiwiYXNzaWduIl19fSwiaWF0IjoxNzYxNDY1ODQzLCJleHAiOjE3NjE1NTIyNDN9.D4B1qJIvAZ0cJYSRyuUvT1cOJZ_clvoMfxrWQ-bnDns';
const body = JSON.stringify({
  donationId: 'cmh6htpu30007jr1emt7l9cgm',
  photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/5f/The_official_portrait_of_Shri_Narendra_Modi%2C_the_Prime_Minister_of_the_Republic_of_India.jpg'
});

const PORT = Number(process.env.TEST_PORT || 3001);
const options = {
  hostname: 'localhost',
  port: PORT,
  path: '/donations/admin/donors/photo',
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  },
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      console.log('Body:', JSON.parse(data));
    } catch (e) {
      console.log('Body:', data);
    }
  });
});

req.on('error', (err) => {
  console.error('Request error:', err && (err.stack || err.message || err));
});

req.write(body);
req.end();
