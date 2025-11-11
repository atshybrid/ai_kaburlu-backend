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
    { name: 'HRCI ID Cards', description: 'Public ID card JSON, HTML previews, QR and PDF generation' },
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
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          mobileNumber: { type: 'string' },
          email: { type: 'string', nullable: true },
          roleId: { type: 'string' },
          languageId: { type: 'string' },
          status: { type: 'string', enum: ['ACTIVE','BLOCKED','PENDING','DELETED'] },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      UserProfile: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          fullName: { type: 'string' },
          profilePhotoUrl: { type: 'string', nullable: true }
        }
      },
      Membership: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          cellId: { type: 'string' },
          designationId: { type: 'string' },
          level: { type: 'string', enum: ['NATIONAL','ZONE','STATE','DISTRICT','MANDAL'] },
          zone: { type: 'string', nullable: true },
          hrcCountryId: { type: 'string', nullable: true },
          hrcStateId: { type: 'string', nullable: true },
          hrcDistrictId: { type: 'string', nullable: true },
          hrcMandalId: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['PENDING_PAYMENT','PENDING_APPROVAL','ACTIVE','EXPIRED','REVOKED'] },
          paymentStatus: { type: 'string', enum: ['PENDING','NOT_REQUIRED','SUCCESS','FAILED'] },
          seatSequence: { type: 'integer' },
          idCardStatus: { type: 'string', enum: ['NONE','GENERATED','REVOKED'], nullable: true },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      IDCard: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          membershipId: { type: 'string' },
          cardNumber: { type: 'string' },
          fullName: { type: 'string' },
          mobileNumber: { type: 'string' },
          designationName: { type: 'string' },
          cellName: { type: 'string' },
          issuedAt: { type: 'string', format: 'date-time', nullable: true },
          expiresAt: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['GENERATED','REVOKED'] }
        }
      },
      Discount: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          mobileNumber: { type: 'string' },
          percentOff: { type: 'integer', minimum: 1, maximum: 100 },
          currency: { type: 'string' },
          maxRedemptions: { type: 'integer' },
          status: { type: 'string', enum: ['ACTIVE','RESERVED','REDEEMED','CANCELLED'] },
          activeFrom: { type: 'string', format: 'date-time', nullable: true },
          activeTo: { type: 'string', format: 'date-time', nullable: true },
          reason: { type: 'string', nullable: true },
          createdByUserId: { type: 'string', nullable: true }
        }
      },
      AvailabilityPricing: {
        type: 'object',
        properties: {
          fee: { type: 'integer' },
          paid: { type: 'integer' },
          deltaDue: { type: 'integer' }
        }
      },
      ReassignPreview: {
        type: 'object',
        properties: {
          accepted: { type: 'boolean' },
          membershipId: { type: 'string' },
          to: {
            type: 'object',
            properties: {
              cellId: { type: 'string' },
              designationId: { type: 'string' },
              level: { type: 'string' },
              hrcStateId: { type: 'string', nullable: true },
              hrcDistrictId: { type: 'string', nullable: true },
              hrcMandalId: { type: 'string', nullable: true },
              seatSequence: { type: 'integer' }
            }
          },
          pricing: { $ref: '#/components/schemas/AvailabilityPricing' },
          status: {
            type: 'object',
            properties: {
              from: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  paymentStatus: { type: 'string' }
                }
              },
              to: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  paymentStatus: { type: 'string' }
                }
              }
            }
          }
        }
      },
      SuccessResponseMembership: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { $ref: '#/components/schemas/Membership' }
        }
      },
      SuccessResponseIDCard: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { $ref: '#/components/schemas/IDCard' }
        }
      },
      SuccessResponseDiscount: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { $ref: '#/components/schemas/Discount' }
        }
      },
      SuccessResponseDiscountList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          count: { type: 'integer' },
          nextCursor: { type: 'string', nullable: true },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Discount' }
          }
        }
      },
      SuccessResponseReassignPreview: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { $ref: '#/components/schemas/ReassignPreview' }
        }
      },
      SuccessResponseCreateMember: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              membership: { $ref: '#/components/schemas/Membership' },
              card: { $ref: '#/components/schemas/IDCard' }
            }
          }
        }
      }
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
