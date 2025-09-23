import 'dotenv/config';
import admin from 'firebase-admin';

let initialized = false;
let initializationResult: {
  success: boolean;
  projectId?: string;
  method?: string;
  errors: string[];
  warnings: string[];
} = {
  success: false,
  errors: [],
  warnings: []
};

// Validate Firebase configuration before initialization
function validateFirebaseConfig() {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  const credsPath = process.env.FIREBASE_CREDENTIALS_PATH;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const googleAppCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  
  // Check if we have any valid configuration method
  const hasCredsFile = !!credsPath;
  const hasEnvCreds = !!(projectId && clientEmail && privateKey);
  const hasGoogleAppCreds = !!googleAppCreds;
  
  if (!hasCredsFile && !hasEnvCreds && !hasGoogleAppCreds) {
    errors.push('No Firebase credentials found. Set either FIREBASE_CREDENTIALS_PATH, environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY), or GOOGLE_APPLICATION_CREDENTIALS');
  }
  
  // Validate project ID format
  if (projectId && !/^[a-z0-9-]+$/.test(projectId)) {
    warnings.push(`Project ID "${projectId}" contains invalid characters. Should only contain lowercase letters, numbers, and hyphens`);
  }
  
  // Validate private key format
  if (privateKey && !privateKey.includes('BEGIN PRIVATE KEY')) {
    warnings.push('FIREBASE_PRIVATE_KEY may be malformed. Should contain "-----BEGIN PRIVATE KEY-----"');
  }
  
  // Validate client email format
  if (clientEmail && !clientEmail.includes('@') && !clientEmail.includes('.iam.gserviceaccount.com')) {
    warnings.push('FIREBASE_CLIENT_EMAIL format looks suspicious. Should be a service account email');
  }
  
  return { errors, warnings, hasCredsFile, hasEnvCreds, hasGoogleAppCreds };
}

function initFirebase() {
  if (initialized) return initializationResult;
  
  console.log('[Firebase Init] 🚀 Initializing Firebase Admin SDK...');
  
  // Validate configuration first
  const validation = validateFirebaseConfig();
  initializationResult.errors = validation.errors;
  initializationResult.warnings = validation.warnings;
  
  if (validation.errors.length > 0) {
    console.error('[Firebase Init] ❌ Configuration validation failed:');
    validation.errors.forEach(error => console.error(`[Firebase Init]   - ${error}`));
    initializationResult.success = false;
    return initializationResult;
  }
  
  if (validation.warnings.length > 0) {
    console.warn('[Firebase Init] ⚠️  Configuration warnings:');
    validation.warnings.forEach(warning => console.warn(`[Firebase Init]   - ${warning}`));
  }
  
  const credsPath = process.env.FIREBASE_CREDENTIALS_PATH;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  
  const expectedProjectId = 'khabarx-f0365';
  console.log('[Firebase Init] Expected project ID:', expectedProjectId);
  console.log('[Firebase Init] Environment project ID:', projectId || 'not set');
  
  try {
    if (validation.hasCredsFile) {
      console.log('[Firebase Init] 📁 Using credentials file:', credsPath);
      try {
        const serviceAccount = require(credsPath!);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        initializationResult.method = 'credentials-file';
        console.log('[Firebase Init] ✅ Initialized with credentials file');
      } catch (fileError: any) {
        throw new Error(`Failed to load credentials file: ${fileError.message}`);
      }
    } else if (validation.hasEnvCreds) {
      console.log('[Firebase Init] 🔐 Using environment credentials for project:', projectId);
      admin.initializeApp({
        credential: admin.credential.cert({ 
          projectId: projectId!, 
          clientEmail: clientEmail!, 
          privateKey: privateKey! 
        }),
      });
      initializationResult.method = 'environment-variables';
      console.log('[Firebase Init] ✅ Initialized with environment variables');
    } else if (validation.hasGoogleAppCreds) {
      console.log('[Firebase Init] 🏔️  Using Google Application Default Credentials');
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      initializationResult.method = 'application-default';
      console.log('[Firebase Init] ✅ Initialized with Application Default Credentials');
    } else {
      console.log('[Firebase Init] 🎲 Using default initialization (last resort)');
      admin.initializeApp();
      initializationResult.method = 'default';
      console.log('[Firebase Init] ⚠️  Initialized with default method (may not work)');
    }
    
    // Verify the initialized project ID
    const app = admin.app();
    const actualProjectId = app.options.projectId;
    initializationResult.projectId = actualProjectId;
    
    console.log('[Firebase Init] 🔍 Actual initialized project ID:', actualProjectId);
    
    if (actualProjectId !== expectedProjectId) {
      const warningMsg = `Project ID mismatch! Expected: ${expectedProjectId}, Got: ${actualProjectId}`;
      console.warn(`[Firebase Init] ⚠️  ${warningMsg}`);
      console.warn('[Firebase Init] This may cause audience mismatch errors in token verification');
      initializationResult.warnings.push(warningMsg);
    } else {
      console.log('[Firebase Init] ✅ Project ID verified correctly');
    }
    
    // Test messaging service availability
    try {
      const messaging = admin.messaging();
      console.log('[Firebase Init] ✅ Messaging service initialized successfully');
    } catch (messagingError: any) {
      const errorMsg = `Messaging service initialization failed: ${messagingError.message}`;
      console.error(`[Firebase Init] ❌ ${errorMsg}`);
      initializationResult.errors.push(errorMsg);
    }
    
    initializationResult.success = true;
    initialized = true;
    console.log('[Firebase Init] 🎉 Firebase initialization completed successfully');
    
  } catch (error: any) {
    const errorMsg = `Firebase initialization failed: ${error.message}`;
    console.error(`[Firebase Init] ❌ ${errorMsg}`);
    console.error('[Firebase Init] Stack trace:', error.stack);
    
    initializationResult.success = false;
    initializationResult.errors.push(errorMsg);
    
    // Don't throw error to prevent app crash, but log it properly
    console.error('[Firebase Init] ⚠️  Continuing without Firebase (push notifications will fail)');
  }
  
  return initializationResult;
}

// Get Firebase initialization status
export function getFirebaseInitStatus() {
  if (!initialized) {
    initFirebase();
  }
  return initializationResult;
}

// Check if Firebase is properly initialized and ready
export function isFirebaseReady(): boolean {
  if (!initialized) {
    initFirebase();
  }
  return initialized && initializationResult.success && initializationResult.errors.length === 0;
}

// Validate FCM token format
export function validateFCMToken(token: string): { valid: boolean; reason?: string } {
  if (!token) {
    return { valid: false, reason: 'Token is empty' };
  }
  
  if (typeof token !== 'string') {
    return { valid: false, reason: 'Token must be a string' };
  }
  
  // FCM tokens are typically 152+ characters long and contain specific character sets
  if (token.length < 140) {
    return { valid: false, reason: 'Token too short (likely invalid)' };
  }
  
  // Check for basic FCM token pattern (contains colons and alphanumeric characters)
  const fcmTokenPattern = /^[A-Za-z0-9_:-]+$/;
  if (!fcmTokenPattern.test(token)) {
    return { valid: false, reason: 'Token contains invalid characters' };
  }
  
  return { valid: true };
}

// Test Firebase connection and messaging service
export async function testFirebaseConnection(): Promise<{
  success: boolean;
  projectId?: string;
  messagingAvailable: boolean;
  errors: string[];
}> {
  const result: {
    success: boolean;
    projectId?: string;
    messagingAvailable: boolean;
    errors: string[];
  } = {
    success: false,
    messagingAvailable: false,
    errors: []
  };
  
  try {
    if (!initialized) {
      initFirebase();
    }
    
    if (!initializationResult.success) {
      result.errors = [...initializationResult.errors];
      return result;
    }
    
    const app = admin.app();
    result.projectId = app.options.projectId;
    
    // Test messaging service
    try {
      const messaging = admin.messaging();
      
      // Try to create a dummy message (don't send it)
      const testMessage = {
        notification: {
          title: 'Connection Test',
          body: 'This is a test message'
        },
        token: 'dummy-token' // This will fail but shows messaging is available
      };
      
      // We don't actually send this, just check if messaging is accessible
      result.messagingAvailable = true;
      result.success = true;
      
    } catch (messagingError: any) {
      result.errors.push(`Messaging service error: ${messagingError.message}`);
    }
    
  } catch (error: any) {
    result.errors.push(`Firebase connection test failed: ${error.message}`);
  }
  
  return result;
}

export function getMessaging() {
  initFirebase();
  return admin.messaging();
}

export function getAdmin() {
  initFirebase();
  return admin;
}
