import swaggerJSDoc from 'swagger-jsdoc';
// Load env and normalize DEV/PROD mapping so server URLs reflect ENV_TYPE
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv-flow').config();
import '../config/env';
import { userSwagger } from '../api/users/users.swagger';

// Build servers: always show Local, Remote Dev, and Production v1 endpoints
const localV1 = 'http://localhost:3001/api/v1';
const devV1 = process.env.DEV_BASE_URL || 'https://app.hrcitodaynews.in/api/v1';
const prodV1 = process.env.PROD_BASE_URL || 'https://api.humanrightscouncilforindia.org/api/v1';

const servers: { url: string; description: string }[] = [];
const addServer = (url: string, description: string) => {
  if (!url) return;
  const clean = url.replace(/\/$/, '');
  if (!servers.some(s => s.url.replace(/\/$/, '') === clean)) {
    servers.push({ url: clean, description });
  }
};

// Order: Local -> Remote Dev -> Production
addServer(localV1, 'Local (v1)');
addServer(devV1, 'Remote Dev (v1)');
addServer(prodV1, 'Production (v1)');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Khabarx News Platform API',
    version: '1.0.0',
    description: 'REST API for Khabarx platform, covering Superadmin, Language Admin, News Desk, Citizen Reporter, Categories & Category Translations.'
  },
  servers,
  tags: [
    { name: 'Auth' },
    { name: 'Users' },
    { name: 'ShortNews' },
    { name: 'Locations' },
    { name: 'Categories' },
    { name: 'Languages' },
    { name: 'Roles' },
    { name: 'States' },
    { name: 'Translate' },
    { name: 'Media' },
    { name: 'Prompts' },
    { name: 'Engagement - Comments' },
    { name: 'HRCI' },
    { name: 'HRCI Admin' },
    { name: 'HRCI_admin_reportes', description: 'HRCI admin analytics and finance reports (daily/weekly/monthly metrics)'} ,
  { name: 'HRCI Cases', description: 'Case management APIs: create, list, summary, assignment, assignee lookup' },
  { name: 'HRCI Meetings - Admin', description: 'Create, manage and notify HRCI meetings (admin/president)' },
  { name: 'HRCI Meetings - Member', description: 'Join and view upcoming HRCI meetings (member access)' },
  { name: 'Member APIs', description: 'Member registration and payment APIs (legacy grouping)' },
  { name: 'Admin APIs', description: 'Admin management for memberships and KYC approvals (legacy grouping)' },
  { name: 'HRCI Membership - Member APIs', description: 'Member registration, pay-first orders, and payment confirmation (with discount support)' },
  { name: 'HRCI Membership - Admin APIs', description: 'Admin management for memberships, KYC, and discount issuance' },
  { name: 'Donations', description: 'Public donations: events, orders, confirmations, receipts, and share links' },
    { name: 'DEPRECATED APIs', description: 'Deprecated endpoints' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      // ...existing code for schemas...
    }
  },

  security: [
    {
      bearerAuth: []
    }
  ]
};

const options = {
  swaggerDefinition,
  apis: ['./src/api/**/*.ts']
};

const swaggerSpec = swaggerJSDoc(options);

export default swaggerSpec;
