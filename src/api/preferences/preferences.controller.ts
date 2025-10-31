import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { subscribeToTopic, unsubscribeFromTopic } from '../../lib/fcm';
import { withTimeout } from '../../lib/promiseTimeout';

/**
 * Update user preferences (location, language, FCM token)
 * Supports both guest users (via deviceId) and registered users (via userId)
 * 
 * POST /preferences/update
 */
export const updateUserPreferencesController = async (req: Request, res: Response) => {
  try {
    const {
      deviceId,
      userId,
      location,
      languageId,
      pushToken,
      deviceModel,
      forceUpdate = false
    } = req.body as {
      deviceId?: string;
      userId?: string;
      location?: {
        latitude: number;
        longitude: number;
        accuracyMeters?: number;
        placeId?: string;
        placeName?: string;
        address?: string;
        source?: string;
      };
      languageId?: string;
      pushToken?: string;
      deviceModel?: string;
      forceUpdate?: boolean;
    };

    console.log('[Update Preferences] Request received:', {
      hasDeviceId: !!deviceId,
      hasUserId: !!userId,
      hasLocation: !!location,
      hasLanguageId: !!languageId,
      hasPushToken: !!pushToken,
      forceUpdate,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress
    });

    // Validate required parameters
    if (!deviceId && !userId) {
      return res.status(400).json({
        success: false,
        message: 'Either deviceId or userId is required',
        code: 'MISSING_IDENTIFIER'
      });
    }

    // Validate language if provided
    let languageData = null;
    if (languageId) {
  languageData = await withTimeout(prisma.language.findUnique({ where: { id: languageId } }), Number(process.env.API_DB_TIMEOUT_MS || 5000), 'getLanguage');
      if (!languageData) {
        return res.status(400).json({
          success: false,
          message: 'Invalid languageId',
          code: 'INVALID_LANGUAGE'
        });
      }
    }

    let targetUser = null;
    let targetDevice = null;
    let isGuestUser = false;

    // Find user and device based on provided identifier
    if (userId) {
      // Registered user case
      targetUser = await withTimeout(prisma.user.findUnique({
        where: { id: userId },
        include: { 
          role: true,
          language: true,
          devices: deviceId ? { where: { deviceId } } : true
        }
      }), Number(process.env.API_DB_TIMEOUT_MS || 8000), 'getUser');

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Find or use existing device for this user
      if (deviceId) {
        targetDevice = targetUser.devices.find(d => d.deviceId === deviceId);
        if (!targetDevice) {
          targetDevice = await withTimeout(prisma.device.create({
            data: {
              deviceId,
              deviceModel: deviceModel || 'unknown',
              userId: targetUser.id,
              pushToken
            }
          }), Number(process.env.API_DB_TIMEOUT_MS || 8000), 'createDevice');
        }
      } else if ((targetUser as any).devices.length > 0) {
        // Use the most recently updated device if no deviceId specified
        console.log(`[Update Preferences] Found ${(targetUser as any).devices.length} devices for user`);
        targetDevice = (targetUser as any).devices.sort((a: any, b: any) => 
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0];
        console.log(`[Update Preferences] Selected device: ${targetDevice.deviceId}`);
      } else {
        // Create a new device for this user if none exists
        const newDeviceId = `auto-device-${Date.now()}`;
        targetDevice = await withTimeout(prisma.device.create({
          data: {
            deviceId: newDeviceId,
            deviceModel: deviceModel || 'unknown',
            userId: targetUser.id,
            pushToken
          }
        }), Number(process.env.API_DB_TIMEOUT_MS || 8000), 'createDevice');
      }
    } else if (deviceId) {
      // Guest user case - find device first
      targetDevice = await withTimeout(prisma.device.findUnique({
        where: { deviceId },
        include: {
          user: {
            include: { role: true, language: true }
          }
        }
      }), Number(process.env.API_DB_TIMEOUT_MS || 8000), 'getDevice');

      if (targetDevice?.user) {
        targetUser = targetDevice.user;
        isGuestUser = targetUser.role?.name === 'GUEST';
      } else {
        // Create guest user and device
  const guestRole = await withTimeout(prisma.role.findUnique({ where: { name: 'GUEST' } }), Number(process.env.API_DB_TIMEOUT_MS || 5000), 'getGuestRole');
        if (!guestRole) {
          return res.status(500).json({
            success: false,
            message: 'Guest role not found',
            code: 'MISSING_GUEST_ROLE'
          });
        }

        // Use default language or provided language
  const defaultLanguage = languageData || await withTimeout(prisma.language.findFirst({ where: { code: 'en' } }), Number(process.env.API_DB_TIMEOUT_MS || 5000), 'getDefaultLanguage');
        if (!defaultLanguage) {
          return res.status(500).json({
            success: false,
            message: 'Default language not found',
            code: 'MISSING_DEFAULT_LANGUAGE'
          });
        }

        // Create guest user with device
        targetUser = await withTimeout(prisma.user.create({
          data: {
            roleId: guestRole.id,
            languageId: languageId || defaultLanguage.id,
            status: 'ACTIVE',
            devices: {
              create: {
                deviceId,
                deviceModel: deviceModel || 'unknown',
                pushToken
              }
            }
          },
          include: { role: true, language: true, devices: true }
        }), Number(process.env.API_DB_TIMEOUT_MS || 8000), 'createGuestUser');

        targetDevice = targetUser.devices[0];
        isGuestUser = true;
      }
    }

    if (!targetUser || !targetDevice) {
      console.error(`[Update Preferences] Resolution failed - User: ${!!targetUser}, Device: ${!!targetDevice}`);
      console.error(`[Update Preferences] userId: ${userId}, deviceId: ${deviceId}`);
      return res.status(500).json({
        success: false,
        message: 'Failed to resolve user and device',
        code: 'RESOLUTION_FAILED'
      });
    }

    const updates: any = {};
    const deviceUpdates: any = {};
    const locationUpdates: any = {};

    // Handle language update
    let oldLanguageCode = targetUser.language?.code;
    if (languageId && (forceUpdate || targetUser.languageId !== languageId)) {
      updates.languageId = languageId;
      console.log(`[Update Preferences] Language change: ${targetUser.languageId} -> ${languageId}`);
    }

    // Handle push token update
    if (pushToken && (forceUpdate || targetDevice.pushToken !== pushToken)) {
      deviceUpdates.pushToken = pushToken;
      console.log(`[Update Preferences] Push token updated for device ${deviceId}`);
    }

    // Handle device model update
    if (deviceModel && (forceUpdate || targetDevice.deviceModel !== deviceModel)) {
      deviceUpdates.deviceModel = deviceModel;
    }

    // Handle location update
    if (location && location.latitude && location.longitude) {
      const shouldUpdateLocation = forceUpdate || 
        !targetDevice.latitude || 
        !targetDevice.longitude ||
        Math.abs(targetDevice.latitude - location.latitude) > 0.0001 ||
        Math.abs(targetDevice.longitude - location.longitude) > 0.0001;

      if (shouldUpdateLocation) {
        // Update device location
        deviceUpdates.latitude = location.latitude;
        deviceUpdates.longitude = location.longitude;
        deviceUpdates.accuracyMeters = location.accuracyMeters;
        deviceUpdates.placeId = location.placeId;
        deviceUpdates.placeName = location.placeName;
        deviceUpdates.address = location.address;
        deviceUpdates.source = location.source;

        // For registered users, also update UserLocation table
        if (!isGuestUser) {
          locationUpdates.latitude = location.latitude;
          locationUpdates.longitude = location.longitude;
          locationUpdates.accuracyMeters = location.accuracyMeters;
          locationUpdates.placeId = location.placeId;
          locationUpdates.placeName = location.placeName;
          locationUpdates.address = location.address;
          locationUpdates.source = location.source;
        }

        console.log(`[Update Preferences] Location updated: ${location.latitude}, ${location.longitude}`);
      }
    }

    // Perform database updates
    const promises = [];

    // Update user if needed
    if (Object.keys(updates).length > 0) {
      promises.push(
        prisma.user.update({
          where: { id: targetUser.id },
          data: updates
        })
      );
    }

    // Update device if needed
    if (Object.keys(deviceUpdates).length > 0) {
      promises.push(
        prisma.device.update({
          where: { id: targetDevice.id },
          data: deviceUpdates
        })
      );
    }

    // Update user location for registered users
    if (!isGuestUser && Object.keys(locationUpdates).length > 0) {
      promises.push(
        prisma.userLocation.upsert({
          where: { userId: targetUser.id },
          update: locationUpdates,
          create: { userId: targetUser.id, ...locationUpdates }
        })
      );
    }

    // Execute all updates
  const results = await withTimeout(Promise.all(promises), Number(process.env.API_DB_TIMEOUT_MS || 10000), 'preferencesUpdate');
    
    // Get fresh data after updates
    const finalUser = await withTimeout(prisma.user.findUnique({
      where: { id: targetUser.id },
      include: { role: true, language: true }
    }), Number(process.env.API_DB_TIMEOUT_MS || 6000), 'getUserFinal');
    
    const finalDevice = await withTimeout(prisma.device.findUnique({
      where: { id: targetDevice.id }
    }), Number(process.env.API_DB_TIMEOUT_MS || 6000), 'getDeviceFinal');

    // Handle FCM topic subscriptions for language changes
    if (pushToken && languageId && oldLanguageCode !== languageData?.code) {
      try {
        // Unsubscribe from old language topic
        if (oldLanguageCode) {
          const oldTopic = `news-lang-${oldLanguageCode.toLowerCase()}`;
          await unsubscribeFromTopic([pushToken], oldTopic);
          console.log(`[Update Preferences] Unsubscribed from topic: ${oldTopic}`);
        }

        // Subscribe to new language topic
        if (languageData?.code) {
          const newTopic = `news-lang-${languageData.code.toLowerCase()}`;
          await subscribeToTopic([pushToken], newTopic);
          console.log(`[Update Preferences] Subscribed to topic: ${newTopic}`);
        }
      } catch (fcmError) {
        console.warn('[Update Preferences] FCM topic update failed (non-fatal):', fcmError);
      }
    }

    // Prepare response data
    const responseData = {
      user: {
        id: finalUser?.id || targetUser.id,
        languageId: finalUser?.languageId || targetUser.languageId,
        languageCode: finalUser?.language?.code || languageData?.code || targetUser.language?.code,
        languageName: finalUser?.language?.name || languageData?.name || targetUser.language?.name,
        role: finalUser?.role?.name || targetUser.role?.name,
        isGuest: isGuestUser
      },
      device: {
        id: finalDevice?.id || targetDevice.id,
        deviceId: finalDevice?.deviceId || targetDevice.deviceId,
        deviceModel: finalDevice?.deviceModel || targetDevice.deviceModel,
        hasPushToken: !!(finalDevice?.pushToken || targetDevice.pushToken),
        location: (finalDevice?.latitude && finalDevice?.longitude) || (targetDevice.latitude && targetDevice.longitude) ? {
          latitude: finalDevice?.latitude || targetDevice.latitude,
          longitude: finalDevice?.longitude || targetDevice.longitude,
          accuracyMeters: finalDevice?.accuracyMeters || targetDevice.accuracyMeters,
          placeId: finalDevice?.placeId || targetDevice.placeId,
          placeName: finalDevice?.placeName || targetDevice.placeName,
          address: finalDevice?.address || targetDevice.address,
          source: finalDevice?.source || targetDevice.source
        } : null
      },
      updates: {
        languageChanged: !!updates.languageId,
        locationChanged: !!deviceUpdates.latitude,
        pushTokenChanged: !!deviceUpdates.pushToken,
        deviceModelChanged: !!deviceUpdates.deviceModel
      }
    };

    console.log('[Update Preferences] Successfully updated preferences:', responseData.updates);

    return res.status(200).json({
      success: true,
      message: 'Preferences updated successfully',
      data: responseData
    });

  } catch (error: any) {
    console.error('[Update Preferences] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update preferences',
      error: error.message
    });
  }
};

/**
 * Get user preferences (location, language, device info)
 * Supports both guest users (via deviceId) and registered users (via userId)
 * 
 * GET /preferences?deviceId=xxx or GET /preferences?userId=xxx
 */
export const getUserPreferencesController = async (req: Request, res: Response) => {
  try {
    const { deviceId, userId } = req.query as { deviceId?: string; userId?: string };

    if (!deviceId && !userId) {
      return res.status(400).json({
        success: false,
        message: 'Either deviceId or userId is required',
        code: 'MISSING_IDENTIFIER'
      });
    }

    let targetUser = null;
    let targetDevice = null;
    let userLocation = null;

    if (userId) {
      // Registered user case
      targetUser = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          role: true,
          language: true,
          devices: deviceId ? { where: { deviceId } } : true
        }
      });

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Get user location
      userLocation = await prisma.userLocation.findUnique({
        where: { userId: targetUser.id }
      });

      // Get device - either specific deviceId or first available device
      if (deviceId) {
        targetDevice = (targetUser as any).devices.find((d: any) => d.deviceId === deviceId) || null;
      } else if ((targetUser as any).devices.length > 0) {
        // Return the most recently updated device if no specific deviceId requested
        targetDevice = (targetUser as any).devices.sort((a: any, b: any) => 
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0];
      }
    } else if (deviceId) {
      // Guest user case
      targetDevice = await prisma.device.findUnique({
        where: { deviceId },
        include: {
          user: {
            include: { role: true, language: true }
          }
        }
      });

      if (!targetDevice) {
        return res.status(404).json({
          success: false,
          message: 'Device not found',
          code: 'DEVICE_NOT_FOUND'
        });
      }

      targetUser = targetDevice.user;
    }

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    const isGuestUser = targetUser.role?.name === 'GUEST';

    // Prepare response
    const responseData = {
      user: {
        id: targetUser.id,
        languageId: targetUser.languageId,
        languageCode: targetUser.language?.code,
        languageName: targetUser.language?.name,
        role: targetUser.role?.name,
        isGuest: isGuestUser,
        status: targetUser.status
      },
      device: targetDevice ? {
        id: targetDevice.id,
        deviceId: targetDevice.deviceId,
        deviceModel: targetDevice.deviceModel,
        hasPushToken: !!targetDevice.pushToken,
        location: targetDevice.latitude && targetDevice.longitude ? {
          latitude: targetDevice.latitude,
          longitude: targetDevice.longitude,
          accuracyMeters: targetDevice.accuracyMeters,
          placeId: targetDevice.placeId,
          placeName: targetDevice.placeName,
          address: targetDevice.address,
          source: targetDevice.source
        } : null
      } : null,
      userLocation: !isGuestUser && userLocation ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        accuracyMeters: userLocation.accuracyMeters,
        provider: userLocation.provider,
        timestampUtc: userLocation.timestampUtc,
        placeId: userLocation.placeId,
        placeName: userLocation.placeName,
        address: userLocation.address,
        source: userLocation.source,
        updatedAt: userLocation.updatedAt
      } : null
    };

    return res.status(200).json({
      success: true,
      data: responseData
    });

  } catch (error: any) {
    console.error('[Get Preferences] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get preferences',
      error: error.message
    });
  }
};