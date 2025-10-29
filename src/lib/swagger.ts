import swaggerJSDoc from 'swagger-jsdoc';
// Load env and normalize DEV/PROD mapping so server URLs reflect ENV_TYPE
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv-flow').config();
import '../config/env';
import { userSwagger } from '../api/users/users.swagger';

// Build servers dynamically
const isProd = process.env.ENV_TYPE === 'prod' || process.env.NODE_ENV === 'production';
const devRoot = 'http://localhost:3001';
const devV1 = process.env.DEV_BASE_URL || `${devRoot}/api/v1`;
const rawProdBase = process.env.PROD_BASE_URL || 'https://api.humanrightscouncilforindia.org';
// If PROD_BASE_URL already includes /api/v1, strip for root, add v1 separately
const prodRoot = rawProdBase.replace(/\/?api\/v1\/?$/, '');

const servers: { url: string; description: string }[] = [];
if (isProd) {
  servers.push(
    { url: prodRoot, description: 'Production (root)' },
    { url: `${prodRoot}/api/v1`, description: 'Production (v1 legacy)' }
  );
} else {
  servers.push(
    { url: devRoot, description: 'Local server (root)' },
    { url: `${devRoot}/api/v1`, description: 'Local server (v1 legacy)' }
  );
  if (devV1 && !devV1.includes('localhost')) {
    const guessRoot = devV1.replace(/\/?api\/v1\/?$/, '');
    servers.push(
      { url: guessRoot, description: 'Remote dev (root)' },
      { url: devV1, description: 'Remote dev (v1 legacy)' }
    );
  }
}

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Kaburlu News Platform API',
    version: '1.0.0',
    description: 'REST API for Kaburlu platform, covering Superadmin, Language Admin, News Desk, Citizen Reporter, Categories & Category Translations.'
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
