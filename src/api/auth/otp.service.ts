import { RequestOtpDto, VerifyOtpDto, SetMpinDto } from './otp.dto';
import * as bcrypt from 'bcrypt';
import prisma from '../../lib/prisma';
import { sendToUser } from '../../lib/fcm';

export class OtpService {
    async requestOtp(data: RequestOtpDto) {
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Save OTP log to DB
        const otpLog = await prisma.otpLog.create({
            data: {
                mobileNumber: data.mobileNumber,
                otp,
                expiresAt,
            },
        });

        // Check if the mobile number is already registered
        const user = await prisma.user.findUnique({ where: { mobileNumber: data.mobileNumber } });
        const isRegistered = !!user;

        // Optional: deliver OTP via push notification to existing user's devices
        let notification: { successCount: number; failureCount: number } | undefined;
        if (user) {
            try {
                const resp = await sendToUser(user.id, {
                    title: 'Your verification code',
                    body: `OTP: ${otp}`,
                    data: { type: 'OTP', mobileNumber: data.mobileNumber },
                });
                notification = { successCount: resp.successCount, failureCount: resp.failureCount } as any;
            } catch (e) {
                // log and continue; OTP can still be verified via server-side
                console.warn('FCM push failed for OTP:', (e as Error).message);
            }
        }

        // In a real application, you would also send the OTP via SMS.
        console.log(`OTP for ${data.mobileNumber} is ${otp}`);
        return { success: true, id: otpLog.id, isRegistered, notification };
    }

    async verifyOtp(data: VerifyOtpDto) {
        // Find OTP by id and otp, ensure not expired
        const record = await prisma.otpLog.findFirst({
            where: { id: data.id, otp: data.otp },
        });
        if (!record) {
            throw new Error('Invalid OTP');
        }
        if (new Date(record.expiresAt).getTime() < Date.now()) {
            // Cleanup expired record
            await prisma.otpLog.delete({ where: { id: record.id } }).catch(() => {});
            throw new Error('OTP expired');
        }

        // Consume OTP (delete after successful verification)
        await prisma.otpLog.delete({ where: { id: record.id } }).catch(() => {});
        return { success: true };
    }

    async setMpin(data: SetMpinDto) {
        // Hash the MPIN from the request
        const saltRounds = 10;
        const hashedMpin = await bcrypt.hash(data.mpin, saltRounds);
        const user = await prisma.user.findUnique({
            where: { mobileNumber: data.mobileNumber },
        });
        if (!user) {
            throw new Error('User not found');
        }
        await prisma.user.update({
            where: { id: user.id },
            data: { mpin: hashedMpin },
        });
        return { success: true };
    }

    async getMpinStatus(mobileNumber: string) {
        const user = await prisma.user.findUnique({
            where: { mobileNumber },
            include: { role: true },
        });

        if (!user) {
            return { mpinStatus: false, isRegistered: false, roleId: null, roleName: null };
        }

        const roleId = user.roleId || null;
        const roleName = user.role?.name || null;

        if (user.mpin) {
            return { mpinStatus: true, roleId, roleName };
        }
        return { mpinStatus: false, isRegistered: true, roleId, roleName };
    }
}
