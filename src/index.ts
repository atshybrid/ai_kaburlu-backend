import 'dotenv/config';
import 'reflect-metadata';
import app from './app';
import { PrismaClient } from '@prisma/client';
import http from 'http';

const prisma = new PrismaClient();

// ensure PORT is a number
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0'; // Explicitly bind to all interfaces for Render/containers

// Helper: wrap prisma connect with a timeout so boot isn't blocked indefinitely in PaaS
async function prismaConnectWithTimeout(ms: number) {
  const to = new Promise((_, reject) => setTimeout(() => reject(new Error(`Prisma connect timeout after ${ms}ms`)), ms));
  return Promise.race([prisma.$connect(), to]);
}

async function start() {
  try {
    if (process.env.DATABASE_URL) {
      try {
        await prismaConnectWithTimeout(Number(process.env.PRISMA_CONNECT_TIMEOUT_MS) || 10000);
        console.log('Prisma connected');
      } catch (e) {
        console.error('Prisma connect failed/timed out on startup — continuing without DB connection:', (e as any)?.message || e);
      }
    } else {
      console.log('DATABASE_URL not set — skipping Prisma connect');
    }

    const server = http.createServer(app);

    server.listen(port, host, () => {
      console.log(`Server is running on http://${host}:${port}`);
      console.log(`Swagger is running on http://${host}:${port}/api/docs`);
    });

    // graceful shutdown
    const graceful = async (signal?: string) => {
      console.log(`\nReceived ${signal ?? 'signal'}, shutting down...`);
      server.close(async (err) => {
        if (err) {
          console.error('Error while closing server:', err);
          process.exit(1);
        }
        try {
          await prisma.$disconnect();
          console.log('Prisma disconnected');
          process.exit(0);
        } catch (e) {
          console.error('Error during Prisma disconnect:', e);
          process.exit(1);
        }
      });
      // if server doesn't close in 10s, force exit
      setTimeout(() => {
        console.warn('Forcing shutdown after 10s');
        process.exit(1);
      }, 10_000).unref();
    };

    process.on('SIGINT', () => graceful('SIGINT'));
    process.on('SIGTERM', () => graceful('SIGTERM'));

    // handle unexpected errors
    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled Rejection:', reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('Uncaught Exception:', err);
      // try to shutdown gracefully
      graceful('uncaughtException');
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    try {
      await prisma.$disconnect();
    } catch (e) {
      // ignore
    }
    // Do not hard-exit on startup to avoid Render 503 loops; allow platform to restart or hit health endpoints
    // process.exit(1);
  }
}

start();
