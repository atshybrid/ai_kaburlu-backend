
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import csv from 'csv-parser';
import { CreateLocationDto, UpdateLocationDto } from './locations.dto';

const prisma = new PrismaClient();

// Create a single location
export const createLocation = (data: CreateLocationDto) => {
    const { timestampUtc, ...rest } = data as any;
    return prisma.userLocation.create({
        data: {
            ...rest,
            timestampUtc: timestampUtc ? new Date(timestampUtc) : undefined,
        }
    });
};

// Get all locations with pagination and filtering
export const findAllLocations = (options: { page?: number, limit?: number, filter?: any }) => {
    const { page = 1, limit = 10, filter = {} } = options;
    const skip = (page - 1) * limit;

    return prisma.userLocation.findMany({
        skip,
        take: limit,
        where: filter
        // No relations in UserLocation model
    });
};

// Get a single location by ID
export const findLocationById = (id: string) => {
    return prisma.userLocation.findUnique({
        where: { id }
        // No relations in UserLocation model
    });
};

// Update a location
export const updateLocation = (id: string, data: UpdateLocationDto) => {
    const { timestampUtc, ...rest } = data as any;
    return prisma.userLocation.update({
        where: { id },
        data: {
            ...rest,
            timestampUtc: timestampUtc ? new Date(timestampUtc) : undefined,
        },
    });
};

// Delete a location
export const deleteLocation = (id: string) => {
    return prisma.userLocation.delete({
        where: { id },
    });
};

// Bulk upload from CSV
export const bulkUploadLocations = (filePath: string): Promise<any> => {
    return new Promise((resolve, reject) => {
        const locations: any[] = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                // Basic validation for required fields
                if (!row.userId || !row.latitude || !row.longitude) {
                    // Skip row or handle error
                    return;
                }
                locations.push({
                    userId: row.userId,
                    latitude: parseFloat(row.latitude),
                    longitude: parseFloat(row.longitude),
                    accuracyMeters: row.accuracyMeters ? parseFloat(row.accuracyMeters) : undefined,
                    provider: row.provider,
                    timestampUtc: row.timestampUtc ? new Date(row.timestampUtc) : undefined,
                    placeId: row.placeId,
                    placeName: row.placeName,
                    address: row.address,
                    source: row.source,
                });
            })
            .on('end', async () => {
                try {
                    if(locations.length === 0) {
                        fs.unlinkSync(filePath);
                        return reject(new Error('CSV file is empty or headers are incorrect.'));
                    }
                    const result = await prisma.userLocation.createMany({
                        data: locations,
                        skipDuplicates: true,
                    });
                    fs.unlinkSync(filePath);
                    resolve(result);
                } catch (error) {
                    fs.unlinkSync(filePath);
                    reject(error);
                }
            })
            .on('error', (error) => {
                fs.unlinkSync(filePath);
                reject(error);
            });
    });
};

// Bulk upload Districts from CSV (non-destructive):
// Columns: stateId?, stateName?, districtName
export const bulkUploadDistricts = (filePath: string): Promise<any> => {
    return new Promise((resolve, reject) => {
        const rows: any[] = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                const districtName = String(row.districtName || '').trim();
                const stateId = row.stateId ? String(row.stateId).trim() : '';
                const stateName = row.stateName ? String(row.stateName).trim() : '';
                if (!districtName || (!stateId && !stateName)) {
                    return; // skip invalid row
                }
                rows.push({ districtName, stateId, stateName });
            })
            .on('end', async () => {
                try {
                    if (rows.length === 0) {
                        fs.unlinkSync(filePath);
                        return reject(new Error('CSV file is empty or headers are incorrect. Expected headers: districtName,stateId?,stateName?'));
                    }
                    let created = 0, skipped = 0;
                    for (const r of rows) {
                        let state: any = null;
                        if (r.stateId) {
                            state = await prisma.state.findUnique({ where: { id: r.stateId } });
                        } else if (r.stateName) {
                            state = await prisma.state.findUnique({ where: { name: r.stateName } });
                        }
                        if (!state) { skipped++; continue; }
                        const exists = await prisma.district.findFirst({ where: { name: r.districtName, stateId: state.id } });
                        if (exists) { skipped++; continue; }
                        await prisma.district.create({ data: { name: r.districtName, stateId: state.id } });
                        created++;
                    }
                    fs.unlinkSync(filePath);
                    resolve({ created, skipped, total: rows.length });
                } catch (error) {
                    fs.unlinkSync(filePath);
                    reject(error);
                }
            })
            .on('error', (error) => {
                fs.unlinkSync(filePath);
                reject(error);
            });
    });
};
