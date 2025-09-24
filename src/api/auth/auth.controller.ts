export const logoutController = async (req: Request, res: Response) => {
  try {
    const { refreshToken, deviceId } = req.body;
    // Call service to invalidate token (scaffold)
    await logout(refreshToken, deviceId);
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
};
import { logout } from './auth.service';
import { checkUserExists } from './auth.service';



export const checkUserExistsController = async (req: Request, res: Response) => {
  const mobile = typeof req.query.mobile === 'string' ? req.query.mobile : Array.isArray(req.query.mobile) ? req.query.mobile[0] : '';
  if (!mobile) {
    return res.status(400).json({ error: 'Mobile number is required' });
  }
  const exists = await checkUserExists(mobile as string);
  res.json({ exists });
};

import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import { login, refresh, registerGuestUser } from './auth.service';
import { MpinLoginDto } from './mpin-login.dto';
import { RefreshDto } from './refresh.dto';
import { validate } from 'class-validator';
import { GuestRegistrationDto } from './guest-registration.dto';

export const loginController = async (req: Request, res: Response) => {
  try {
    const loginDto = new MpinLoginDto(req.body.mobileNumber, req.body.mpin);
    console.log("loginDto", loginDto);
    const errors = await validate(loginDto);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const result = await login(loginDto);
    console.log("result", result);
    if (!result) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    res.status(200).json({ success: true, message: 'Operation successful', data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const refreshController = async (req: Request, res: Response) => {
  try {
    const refreshDto = new RefreshDto(req.body.refreshToken);

    const errors = await validate(refreshDto);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const result = await refresh(refreshDto);
    if (!result) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    res.status(200).json({ success: true, message: 'Operation successful', data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const registerGuestController = async (req: Request, res: Response) => {
  try {
    const guestDto = req.body as GuestRegistrationDto;
    const anonHeader = (req.headers['x-anon-id'] as string | undefined) || undefined;
    const result = await registerGuestUser(guestDto, anonHeader);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
import * as bcrypt from 'bcrypt';
import { getAdmin } from '../../lib/firebase';
import { verifyToken } from '../../lib/tokenVerification';
import jwtLib from 'jsonwebtoken';

export const upgradeGuestController = async (req: Request, res: Response) => {
  try {
    const { deviceId, mobileNumber, mpin, email } = req.body;
    // Find guest user by deviceId
    const guestUser = await prisma.user.findFirst({
      where: { devices: { some: { deviceId } }, role: { name: 'GUEST' } }
    });
    if (!guestUser) {
      return res.status(404).json({ error: 'Guest user not found' });
    }
    // Hash the MPIN before storing
    const hashedMpin = await bcrypt.hash(mpin, 10);
    // Upgrade user: set role to CITIZEN_REPORTER, update details, keep languageId
    const citizenRole = await prisma.role.findUnique({ where: { name: 'CITIZEN_REPORTER' } });
    if (!citizenRole) {
      return res.status(500).json({ error: 'Citizen reporter role not found' });
    }
    const updatedUser = await prisma.user.update({
      where: { id: guestUser.id },
      data: {
        mobileNumber,
        mpin: hashedMpin,
        email,
        roleId: citizenRole.id,
        languageId: guestUser.languageId,
        status: 'ACTIVE'
      }
    });
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Create/upgrade citizen reporter by mobile number with mandatory location and full name
export const createCitizenReporterByMobileController = async (req: Request, res: Response) => {
  try {
    const { mobileNumber, mpin, fullName, location, pushToken, deviceId, languageId } = req.body as {
      mobileNumber: string;
      mpin: string;
      fullName: string;
      location: {
        latitude: number;
        longitude: number;
        accuracyMeters?: number;
        provider?: string;
        timestampUtc?: string;
        placeId?: string;
        placeName?: string;
        address?: string;
        source?: string;
      };
      pushToken?: string;
      deviceId?: string;
      languageId: string;
    };

    if (!mobileNumber || !mpin || !fullName || !location || !languageId) {
      return res.status(400).json({ success: false, message: 'mobileNumber, mpin, fullName, languageId and location are required' });
    }
    if (!/^\d{4}$/.test(mpin)) {
      return res.status(400).json({ success: false, message: 'mpin must be a 4-digit number' });
    }
    if (typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      return res.status(400).json({ success: false, message: 'location.latitude and location.longitude are required numbers' });
    }
    // Strict: only accept a valid language row ID (no code fallback)
    const lang = await prisma.language.findUnique({ where: { id: languageId } });
    if (!lang) {
      return res.status(400).json({ success: false, message: 'Invalid languageId' });
    }

    const citizenRole = await prisma.role.findUnique({ where: { name: 'CITIZEN_REPORTER' } });
    if (!citizenRole) return res.status(500).json({ success: false, message: 'Citizen reporter role not found' });

    const hashedMpin = await bcrypt.hash(mpin, 10);

    // Try to find an existing user by mobile or a guest user linked via deviceId
    let user = await prisma.user.findFirst({ where: { mobileNumber } });
    if (!user && deviceId) {
      const guestUser = await prisma.user.findFirst({ where: { devices: { some: { deviceId } }, role: { name: 'GUEST' } } });
      if (guestUser) user = guestUser;
    }

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          mobileNumber,
          mpin: hashedMpin,
          roleId: citizenRole.id,
          languageId: lang.id,
          status: 'ACTIVE',
          upgradedAt: new Date(),
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          mobileNumber,
          mpin: hashedMpin,
          roleId: citizenRole.id,
          languageId: lang.id,
          status: 'ACTIVE',
          upgradedAt: new Date(),
        },
      });
    }

    // Upsert profile full name
    await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: { fullName },
      create: { userId: user.id, fullName },
    });

    // Upsert user location (mandatory)
    await prisma.userLocation.upsert({
      where: { userId: user.id },
      update: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: (location as any).accuracyMeters,
        provider: (location as any).provider,
        timestampUtc: location.timestampUtc ? new Date(location.timestampUtc) : undefined,
        placeId: (location as any).placeId,
        placeName: (location as any).placeName,
        address: (location as any).address,
        source: (location as any).source,
      },
      create: {
        userId: user.id,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: (location as any).accuracyMeters,
        provider: (location as any).provider,
        timestampUtc: location.timestampUtc ? new Date(location.timestampUtc) : undefined,
        placeId: (location as any).placeId,
        placeName: (location as any).placeName,
        address: (location as any).address,
        source: (location as any).source,
      },
    });

    // Link/update device if provided
    if (deviceId) {
      const existing = await prisma.device.findUnique({ where: { deviceId } });
      if (existing) {
        await prisma.device.update({
          where: { deviceId },
          data: {
            userId: user.id,
            pushToken: pushToken as any,
            latitude: (location as any).latitude,
            longitude: (location as any).longitude,
            accuracyMeters: (location as any).accuracyMeters,
            placeId: (location as any).placeId,
            placeName: (location as any).placeName,
            address: (location as any).address,
            source: (location as any).source,
          } as any,
        });
      } else {
        await prisma.device.create({
          data: {
            deviceId,
            deviceModel: 'unknown',
            userId: user.id,
            pushToken: pushToken as any,
            latitude: (location as any).latitude,
            longitude: (location as any).longitude,
            accuracyMeters: (location as any).accuracyMeters,
            placeId: (location as any).placeId,
            placeName: (location as any).placeName,
            address: (location as any).address,
            source: (location as any).source,
          } as any,
        });
      }
    }

    // Fetch user profile and device data for enhanced response
    const userProfile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    const userLocation = await prisma.userLocation.findUnique({ where: { userId: user.id } });
    const device = deviceId ? await prisma.device.findUnique({ where: { deviceId } }) : null;

    // Build login-style response
    const role = await prisma.role.findUnique({ where: { id: user.roleId } });
    const payload = { sub: user.id, role: role?.name, permissions: role?.permissions } as any;
    const jwtToken = jwtLib.sign(payload, process.env.JWT_SECRET || 'your-default-secret', { expiresIn: '1d' });
    const refreshToken = jwtLib.sign({ sub: user.id }, process.env.JWT_REFRESH_SECRET || 'your-default-refresh-secret', { expiresIn: '30d' });
    const responseData: any = {
      jwt: jwtToken,
      refreshToken,
      expiresIn: 86400,
      user: { 
        userId: user.id, 
        role: role?.name, 
        languageId: user.languageId,
        fullName: userProfile?.fullName || null,
        profilePhotoUrl: userProfile?.profilePhotoUrl || null
      },
      device: device ? {
        deviceId: device.deviceId,
        deviceModel: device.deviceModel,
        pushToken: device.pushToken,
        hasPushToken: Boolean(device.pushToken)
      } : null,
      location: userLocation ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        accuracyMeters: userLocation.accuracyMeters,
        provider: userLocation.provider,
        timestampUtc: userLocation.timestampUtc,
        placeId: userLocation.placeId,
        placeName: userLocation.placeName,
        address: userLocation.address,
        source: userLocation.source
      } : {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: (location as any).accuracyMeters,
        provider: (location as any).provider,
        timestampUtc: location.timestampUtc,
        placeId: (location as any).placeId,
        placeName: (location as any).placeName,
        address: (location as any).address,
        source: (location as any).source,
      },
    };
    return res.status(200).json({ success: true, message: 'Operation successful', data: responseData });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message || 'Internal server error' });
  }
};

export const upsertDeviceController = async (req: Request, res: Response) => {
  try {
    const { deviceId, deviceModel, pushToken, latitude, longitude, accuracyMeters, placeId, placeName, address, source } = req.body;
    if (!deviceId || !deviceModel) {
      return res.status(400).json({ success: false, message: 'deviceId and deviceModel are required' });
    }
    // Upsert by deviceId; do not create user here
    const existing = await prisma.device.findUnique({ where: { deviceId } });
    let device;
    if (existing) {
      device = await prisma.device.update({
        where: { deviceId },
        data: {
          deviceModel,
          pushToken,
          latitude: latitude as any,
          longitude: longitude as any,
          accuracyMeters: accuracyMeters as any,
          placeId: placeId as any,
          placeName: placeName as any,
          address: address as any,
          source: source as any,
        } as any,
      });
    } else {
      device = await prisma.device.create({
        data: {
          deviceId,
          deviceModel,
          pushToken,
          latitude: latitude as any,
          longitude: longitude as any,
          accuracyMeters: accuracyMeters as any,
          placeId: placeId as any,
          placeName: placeName as any,
          address: address as any,
          source: source as any,
        } as any,
      });
    }
    res.status(200).json({ success: true, device });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const loginWithGoogleController = async (req: Request, res: Response) => {
  try {
    const { googleIdToken, firebaseIdToken, deviceId } = req.body;
    
    console.log('[Login Google] Request received:', {
      hasGoogleIdToken: !!googleIdToken,
      hasFirebaseIdToken: !!firebaseIdToken,
      hasDeviceId: !!deviceId,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress
    });
    
    // Validate that at least one token is provided
    if (!googleIdToken && !firebaseIdToken) {
      console.error('[Login Google] ERROR: No tokens provided in request');
      return res.status(400).json({ 
        success: false, 
        message: 'Either googleIdToken or firebaseIdToken is required',
        code: 'MISSING_TOKEN'
      });
    }
    
    // Use new token verification utility
    const verificationResult = await verifyToken({ googleIdToken, firebaseIdToken });
    
    if (!verificationResult.success) {
      console.error('[Login Google] Token verification failed:', verificationResult.error);
      return res.status(401).json({ 
        success: false, 
        message: `Token verification failed: ${verificationResult.error}`,
        code: 'INVALID_TOKEN',
        details: {
          verificationMethod: verificationResult.verificationMethod,
          audience: verificationResult.audience,
          issuer: verificationResult.issuer
        }
      });
    }
    
    console.log('[Login Google] Token verification successful:', {
      method: verificationResult.verificationMethod,
      firebaseUid: verificationResult.firebaseUid,
      email: verificationResult.email,
      audience: verificationResult.audience
    });
    
    const firebaseUid = verificationResult.firebaseUid;

    // Find user by firebaseUid
  let user = await prisma.user.findUnique({ where: { firebaseUid } as any });
    if (!user) {
      // Not found: return 404 to instruct client to call upgrade
      return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'No user for this Google account. Call upgrade.' });
    }

    // Link device if provided
    if (deviceId) {
      await prisma.device.update({ where: { deviceId }, data: { userId: user.id } }).catch(async () => {
        // create device if missing
        await prisma.device.create({ data: { deviceId, deviceModel: 'unknown', userId: user.id } });
      });
    }

    // Fetch user profile and device data for enhanced response
    const userProfile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    const userLocation = await prisma.userLocation.findUnique({ where: { userId: user.id } });
    const device = deviceId ? await prisma.device.findUnique({ where: { deviceId } }) : 
                  await prisma.device.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' } });

    const role = await prisma.role.findUnique({ where: { id: user.roleId } });
    const payload = { sub: user.id, role: role?.name, permissions: role?.permissions };
    const jwtToken = require('jsonwebtoken').sign(payload, process.env.JWT_SECRET || 'your-default-secret', { expiresIn: '1d' });
    const refreshToken = require('jsonwebtoken').sign({ sub: user.id }, process.env.JWT_REFRESH_SECRET || 'your-default-refresh-secret', { expiresIn: '30d' });
    const result: any = {
      jwt: jwtToken,
      refreshToken,
      expiresIn: 86400,
      user: { 
        userId: user.id, 
        role: role?.name, 
        languageId: user.languageId,
        fullName: userProfile?.fullName || null,
        profilePhotoUrl: userProfile?.profilePhotoUrl || null
      },
      device: device ? {
        deviceId: device.deviceId,
        deviceModel: device.deviceModel,
        pushToken: device.pushToken,
        hasPushToken: Boolean(device.pushToken)
      } : null,
      location: userLocation ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        accuracyMeters: userLocation.accuracyMeters,
        provider: userLocation.provider,
        timestampUtc: userLocation.timestampUtc?.toISOString(),
        placeId: userLocation.placeId,
        placeName: userLocation.placeName,
        address: userLocation.address,
        source: userLocation.source
      } : null,
    };
    return res.json({ success: true, message: 'Operation successful', data: result });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const upgradeCitizenReporterGoogleController = async (req: Request, res: Response) => {
  try {
    const { googleIdToken, firebaseIdToken, email, languageId, pushToken, location } = req.body as {
      googleIdToken?: string;
      firebaseIdToken?: string;
      email?: string;
      languageId: string;
      pushToken?: string;
      location: {
        latitude: number;
        longitude: number;
        accuracyMeters?: number;
        provider?: string;
        timestampUtc?: string;
        placeId?: string;
        placeName?: string;
        address?: string;
        source?: string;
      };
    };
    
    console.log('[Upgrade Citizen Reporter] Request received:', {
      hasGoogleIdToken: !!googleIdToken,
      hasFirebaseIdToken: !!firebaseIdToken,
      email,
      languageId,
      hasPushToken: !!pushToken,
      hasLocation: !!location,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress
    });
    
    // Validate required parameters
    if (!googleIdToken && !firebaseIdToken) {
      console.error('[Upgrade Citizen Reporter] ERROR: No tokens provided');
      return res.status(400).json({ 
        success: false, 
        message: 'Either googleIdToken or firebaseIdToken is required',
        code: 'MISSING_TOKEN'
      });
    }
    
    if (!languageId) return res.status(400).json({ success: false, message: 'languageId is required' });
    if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      return res.status(400).json({ success: false, message: 'location with latitude and longitude is required' });
    }
    
    const lang = await prisma.language.findUnique({ where: { id: languageId } });
    if (!lang) return res.status(400).json({ success: false, message: 'Invalid languageId' });
    
    // Use new token verification utility
    const verificationResult = await verifyToken({ googleIdToken, firebaseIdToken });
    
    if (!verificationResult.success) {
      console.error('[Upgrade Citizen Reporter] Token verification failed:', verificationResult.error);
      return res.status(401).json({ 
        success: false, 
        message: `Token verification failed: ${verificationResult.error}`,
        code: 'INVALID_TOKEN',
        details: {
          verificationMethod: verificationResult.verificationMethod,
          audience: verificationResult.audience,
          issuer: verificationResult.issuer
        }
      });
    }
    
    console.log('[Upgrade Citizen Reporter] Token verification successful:', {
      method: verificationResult.verificationMethod,
      firebaseUid: verificationResult.firebaseUid,
      email: verificationResult.email,
      audience: verificationResult.audience
    });
    
    const firebaseUid = verificationResult.firebaseUid;

    // If user exists, return conflict
  let existing = await prisma.user.findUnique({ where: { firebaseUid } as any });
    if (existing) {
      // Update language if different
      if (existing.languageId !== languageId) {
        existing = await prisma.user.update({ where: { id: existing.id }, data: { languageId } });
      }
      // Upsert user location and update device
      await prisma.userLocation.upsert({
        where: { userId: existing.id },
        update: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracyMeters: (location as any).accuracyMeters,
          provider: (location as any).provider,
          timestampUtc: location.timestampUtc ? new Date(location.timestampUtc) : undefined,
          placeId: (location as any).placeId,
          placeName: (location as any).placeName,
          address: (location as any).address,
          source: (location as any).source,
        },
        create: {
          userId: existing.id,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracyMeters: (location as any).accuracyMeters,
          provider: (location as any).provider,
          timestampUtc: location.timestampUtc ? new Date(location.timestampUtc) : undefined,
          placeId: (location as any).placeId,
          placeName: (location as any).placeName,
          address: (location as any).address,
          source: (location as any).source,
        },
      });
      // Note: pushToken is optional and not stored here without a deviceId. Use /auth/device to upsert a device with pushToken.
      // Fetch user profile and device data for enhanced response
      const userProfile = await prisma.userProfile.findUnique({ where: { userId: existing.id } });
      const userLocation = await prisma.userLocation.findUnique({ where: { userId: existing.id } });
      
      // Issue tokens like login for existing user
      const role = await prisma.role.findUnique({ where: { id: existing.roleId } });
      const payload = { sub: existing.id, role: role?.name, permissions: role?.permissions } as any;
      const jwtToken = jwtLib.sign(payload, process.env.JWT_SECRET || 'your-default-secret', { expiresIn: '1d' });
      const refreshToken = jwtLib.sign({ sub: existing.id }, process.env.JWT_REFRESH_SECRET || 'your-default-refresh-secret', { expiresIn: '30d' });
      const data: any = {
        jwt: jwtToken,
        refreshToken,
        expiresIn: 86400,
        user: { 
          userId: existing.id, 
          role: role?.name, 
          languageId: languageId,
          fullName: userProfile?.fullName || null,
          profilePhotoUrl: userProfile?.profilePhotoUrl || null
        },
        device: null, // Google auth doesn't provide deviceId, but pushToken could be handled separately
        location: userLocation ? {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          accuracyMeters: userLocation.accuracyMeters,
          provider: userLocation.provider,
          timestampUtc: userLocation.timestampUtc,
          placeId: userLocation.placeId,
          placeName: userLocation.placeName,
          address: userLocation.address,
          source: userLocation.source
        } : {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracyMeters: (location as any).accuracyMeters,
          provider: (location as any).provider,
          timestampUtc: location.timestampUtc,
          placeId: (location as any).placeId,
          placeName: (location as any).placeName,
          address: (location as any).address,
          source: (location as any).source,
        },
      };
      return res.status(200).json({ success: true, message: 'Operation successful', data });
    }
    const citizenRole = await prisma.role.findUnique({ where: { name: 'CITIZEN_REPORTER' } });
    if (!citizenRole) return res.status(500).json({ success: false, message: 'Citizen reporter role not found' });

  const user = await prisma.user.create({ data: { firebaseUid, email: email || verificationResult.email || null as any, roleId: citizenRole.id, languageId, status: 'ACTIVE' } as any });

    // Upsert user location (mandatory)
    await prisma.userLocation.upsert({
      where: { userId: user.id },
      update: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: (location as any).accuracyMeters,
        provider: (location as any).provider,
        timestampUtc: location.timestampUtc ? new Date(location.timestampUtc) : undefined,
        placeId: (location as any).placeId,
        placeName: (location as any).placeName,
        address: (location as any).address,
        source: (location as any).source,
      },
      create: {
        userId: user.id,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: (location as any).accuracyMeters,
        provider: (location as any).provider,
        timestampUtc: location.timestampUtc ? new Date(location.timestampUtc) : undefined,
        placeId: (location as any).placeId,
        placeName: (location as any).placeName,
        address: (location as any).address,
        source: (location as any).source,
      },
    });

    // Note: pushToken is optional and not stored here without a deviceId. Use /auth/device to upsert a device with pushToken.
    // Fetch user profile and location data for enhanced response (newly created user)
    const userProfile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    const userLocation = await prisma.userLocation.findUnique({ where: { userId: user.id } });

    // Issue tokens and return login-style response
    const role = await prisma.role.findUnique({ where: { id: user.roleId } });
    const payload = { sub: user.id, role: role?.name, permissions: role?.permissions } as any;
    const jwtToken = jwtLib.sign(payload, process.env.JWT_SECRET || 'your-default-secret', { expiresIn: '1d' });
    const refreshToken = jwtLib.sign({ sub: user.id }, process.env.JWT_REFRESH_SECRET || 'your-default-refresh-secret', { expiresIn: '30d' });
    const data: any = {
      jwt: jwtToken,
      refreshToken,
      expiresIn: 86400,
      user: { 
        userId: user.id, 
        role: role?.name, 
        languageId: user.languageId,
        fullName: userProfile?.fullName || null,
        profilePhotoUrl: userProfile?.profilePhotoUrl || null
      },
      device: null, // Google auth doesn't provide deviceId, use /preferences/update to link device later
      location: userLocation ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        accuracyMeters: userLocation.accuracyMeters,
        provider: userLocation.provider,
        timestampUtc: userLocation.timestampUtc,
        placeId: userLocation.placeId,
        placeName: userLocation.placeName,
        address: userLocation.address,
        source: userLocation.source
      } : {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: (location as any).accuracyMeters,
        provider: (location as any).provider,
        timestampUtc: location.timestampUtc,
        placeId: (location as any).placeId,
        placeName: (location as any).placeName,
        address: (location as any).address,
        source: (location as any).source,
      },
    };
    return res.json({ success: true, message: 'Operation successful', data });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};
