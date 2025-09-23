# 🔄 Push Token Update Strategy for App Reinstall/Clear Storage

## 🎯 Your Scenario Explained

When user **clears storage** or **deletes/reinstalls app**:

1. **App loses all local data** 📱❌
2. **FCM generates NEW push token** 🔔🆕  
3. **Old token in database becomes invalid** 💾❌
4. **User permissions reset - needs new notification permission** ⚠️

## 🛠️ Complete Solution Strategy

### **Phase 1: App Launch (Fresh Install)**
```javascript
// In your app initialization
async function handleAppLaunch() {
  // 1. Get new FCM token
  const newFCMToken = await getFCMToken();
  
  // 2. Generate/retrieve device ID
  const deviceId = await getOrCreateDeviceId(); // Store this locally
  
  // 3. Create guest user first (default flow)
  await createGuestUser(deviceId, newFCMToken);
}
```

### **Phase 2: User Login (Guest → Citizen Reporter)**
```javascript
async function handleUserLogin(userCredentials) {
  // 1. Authenticate user
  const loginResponse = await login(userCredentials);
  const userId = loginResponse.user.userId;
  
  // 2. Get current FCM token (might be new after reinstall)
  const currentFCMToken = await getFCMToken();
  
  // 3. Update user with new token - CRITICAL STEP
  const updateResponse = await fetch('/api/v1/preferences/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: userId,
      deviceId: deviceId, // Same device, but new token
      pushToken: currentFCMToken, // NEW token after reinstall
      forceUpdate: true // IMPORTANT: Force update old token
    })
  });
  
  console.log('Token updated after login:', updateResponse);
}
```

## 📱 Mobile App Implementation

### **React Native/Expo Example:**
```javascript
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

class PushTokenManager {
  
  // Get or create persistent device ID
  async getDeviceId() {
    let deviceId = await AsyncStorage.getItem('deviceId');
    if (!deviceId) {
      deviceId = `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await AsyncStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
  }
  
  // Get current FCM/Expo push token
  async getCurrentPushToken() {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.log('Push notifications permission denied');
      return null;
    }
    
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    return token;
  }
  
  // Update token in backend
  async updateTokenInBackend(userId = null, deviceId, pushToken) {
    const payload = {
      pushToken,
      deviceModel: Platform.OS === 'ios' ? 'iPhone' : 'Android',
      forceUpdate: true
    };
    
    // Add either userId or deviceId based on login status
    if (userId) {
      payload.userId = userId; // Logged in user
      payload.deviceId = deviceId; // Link to same device
    } else {
      payload.deviceId = deviceId; // Guest user
    }
    
    const response = await fetch(`${API_BASE}/preferences/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    return response.json();
  }
  
  // Main function - call this on app launch AND after login
  async syncPushToken(userId = null) {
    try {
      const deviceId = await this.getDeviceId();
      const currentToken = await this.getCurrentPushToken();
      
      if (currentToken) {
        const result = await this.updateTokenInBackend(userId, deviceId, currentToken);
        console.log('Push token synced:', result.success);
        return result;
      }
    } catch (error) {
      console.error('Push token sync failed:', error);
    }
  }
}

// Usage in your app:
const pushManager = new PushTokenManager();

// On app launch (creates guest user)
await pushManager.syncPushToken(); 

// After user login (updates citizen reporter)
await pushManager.syncPushToken(loggedInUserId);
```

## 📊 API Response Handling

Your API already handles this perfectly:

```json
// When you call preferences/update with new token
{
  "success": true,
  "data": {
    "device": {
      "hasPushToken": true,  // ✅ Confirms new token stored
      "deviceId": "abcd-efgh-1234",
      "deviceModel": "iPhone 15 Pro"
    },
    "updates": {
      "pushTokenChanged": true  // ✅ Confirms old token replaced
    }
  }
}
```

## 🔄 Complete Flow Summary

1. **App Launch**: Get new FCM token → Create guest user with token
2. **User Login**: Get current FCM token → Update citizen reporter with new token
3. **Force Update**: Use `forceUpdate: true` to replace old invalid tokens
4. **Verification**: API returns `hasPushToken: true` when successful

## ✅ Your Backend is Ready!

Your current API already supports this flow perfectly:
- ✅ `forceUpdate: true` replaces old tokens
- ✅ `hasPushToken` confirms token storage
- ✅ Both `userId` and `deviceId` based updates work
- ✅ Guest→Citizen Reporter transition supported

**The key is to always update the token after user login, especially after app reinstall!**