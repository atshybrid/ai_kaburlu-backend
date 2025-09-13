import 'dotenv/config';
import 'reflect-metadata';
import app from './app';
import { PrismaClient } from '@prisma/client';
import http from 'http';

const prisma = new PrismaClient();

// ensure PORT is a number
const port = Number(process.env.PORT) || 3001;

async function start() {
  try {
    if (process.env.DATABASE_URL) {
      await prisma.$connect();
      console.log('Prisma connected');
    } else {
      console.log('DATABASE_URL not set — skipping Prisma connect');
    }

    const server = http.createServer(app);

    server.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
  console.log(`Swagger is running on http://localhost:${port}/api/docs`);
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
    process.exit(1);
  }
}

start();
