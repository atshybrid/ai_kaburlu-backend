import swaggerJSDoc from 'swagger-jsdoc';
import { userSwagger } from '../api/users/users.swagger';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Kaburlu News Platform API',
    version: '1.0.0',
    description: 'REST API for Kaburlu platform, covering Superadmin, Language Admin, News Desk, Citizen Reporter, Categories & Category Translations.'
  },
  servers: [
    {
      url: 'http://localhost:3001',
      description: 'Local server (root)'
    },
    {
      url: 'https://ai-kaburlu-backend.onrender.com',
      description: 'Render server (root)'
    },
    {
      url: 'http://localhost:3001/api/v1',
      description: 'Local server (v1 legacy)'
    },
    {
      url: 'https://ai-kaburlu-backend.onrender.com/api/v1',
      description: 'Render server (v1 legacy)'
    }
  ],
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
  { name: 'Engagement - Comments' }
  ,{ name: 'HRCI' }
  ,{ name: 'HRCI Admin' }
  ,{ name: 'Memberships Public' }
  ,{ name: 'Memberships Payments' }
  ,{ name: 'Memberships KYC' }
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
