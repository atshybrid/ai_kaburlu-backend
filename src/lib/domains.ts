/**
 * Domain configuration utility for environment-based canonical URLs
 * Supports development, staging, and production environments with extra domain support
 */

interface DomainConfig {
  development: string;
  staging?: string;
  production: string;
  extra?: string;
}

/**
 * Get the appropriate canonical domain based on environment
 * Priority: CANONICAL_DOMAIN -> EXTRA_DOMAIN -> environment-based defaults
 * 
 * @returns The canonical domain URL (with protocol)
 */
export function getCanonicalDomain(): string {
  // Check for explicit canonical domain override
  if (process.env.CANONICAL_DOMAIN) {
    console.log(`[Domain] Using explicit CANONICAL_DOMAIN: ${process.env.CANONICAL_DOMAIN}`);
    return process.env.CANONICAL_DOMAIN;
  }

  // Check for extra domain override
  if (process.env.EXTRA_DOMAIN) {
    console.log(`[Domain] Using EXTRA_DOMAIN: ${process.env.EXTRA_DOMAIN}`);
    return process.env.EXTRA_DOMAIN;
  }

  // Prefer SHARE_DOMAIN (used for share/deep-link canonical URLs)
  if (process.env.SHARE_DOMAIN) {
    console.log(`[Domain] Using SHARE_DOMAIN: ${process.env.SHARE_DOMAIN}`);
    return process.env.SHARE_DOMAIN;
  }

  // Environment-based domain selection
  const environment = process.env.NODE_ENV || 'development';
  
  const domainConfig: DomainConfig = {
    development: process.env.DEV_DOMAIN || process.env.DEV_BASE_URL || 'http://localhost:3000',
    staging: process.env.STAGING_DOMAIN || 'https://staging.example.com',
    production: process.env.PROD_DOMAIN || process.env.PROD_BASE_URL || 'https://app.example.com'
  };

  let selectedDomain: string;

  switch (environment) {
    case 'production':
      selectedDomain = domainConfig.production;
      break;
    case 'staging':
      selectedDomain = domainConfig.staging || domainConfig.production;
      break;
    case 'development':
    case 'dev':
    default:
      selectedDomain = domainConfig.development;
      break;
  }

  console.log(`[Domain] Environment: ${environment}, Selected domain: ${selectedDomain}`);
  return selectedDomain;
}

/**
 * Build a canonical URL for content
 * 
 * @param languageCode - Language code (e.g., 'en', 'hi')
 * @param slug - Content slug
 * @param contentType - Optional content type for path prefix
 * @returns Complete canonical URL
 */
export function buildCanonicalUrl(
  languageCode: string, 
  slug: string, 
  contentType?: 'news' | 'short' | 'article'
): string {
  const domain = getCanonicalDomain();
  
  // Build path segments
  const pathSegments = [languageCode];
  
  if (contentType) {
    pathSegments.push(contentType);
  }
  
  pathSegments.push(slug);
  
  // Ensure domain doesn't end with slash and path starts with slash
  const cleanDomain = domain.replace(/\/$/, '');
  const path = '/' + pathSegments.join('/');
  
  const canonicalUrl = cleanDomain + path;
  
  console.log(`[Domain] Built canonical URL: ${canonicalUrl}`);
  return canonicalUrl;
}

/**
 * Get domain configuration info for debugging
 */
export function getDomainInfo(): {
  environment: string;
  canonicalDomain: string;
  hasExplicitCanonical: boolean;
  hasExtraDomain: boolean;
  availableEnvVars: string[];
} {
  return {
    environment: process.env.NODE_ENV || 'development',
    canonicalDomain: getCanonicalDomain(),
    hasExplicitCanonical: !!process.env.CANONICAL_DOMAIN,
    hasExtraDomain: !!process.env.EXTRA_DOMAIN,
    availableEnvVars: [
      'NODE_ENV',
      'CANONICAL_DOMAIN',
      'EXTRA_DOMAIN', 
      'DEV_DOMAIN',
      'STAGING_DOMAIN',
      'PROD_DOMAIN'
    ].filter(key => process.env[key])
  };
}

/**
 * Environment variable examples:
 * 
 * Development:
 * NODE_ENV=development
 * DEV_DOMAIN=http://localhost:3000
 * 
 * Staging:
 * NODE_ENV=staging  
 * STAGING_DOMAIN=https://staging.example.com
 * 
 * Production:
 * NODE_ENV=production
 * PROD_DOMAIN=https://app.example.com
 * 
 * Override for any environment:
 * CANONICAL_DOMAIN=https://custom.domain.com
 * EXTRA_DOMAIN=https://extra.domain.com
 */