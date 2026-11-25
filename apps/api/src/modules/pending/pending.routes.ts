import { ERROR_CODES, fail } from '@loglens/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/pool.js';
import { requireAuth } from '../../http/auth-guard.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface PendingRoute {
  readonly method: Method;
  readonly url: string;
  readonly ticket: string;
  readonly summary: string;
}

/**
 * Operations that exist in docs/api/openapi.yaml with `x-status: pending`. They are registered so
 * the API surface matches the contract, authenticate like real endpoints, and answer 501.
 */
export const PENDING_ROUTES: readonly PendingRoute[] = Object.freeze([
  {
    method: 'POST',
    url: '/api/v1/auth/verify-email',
    ticket: 'LG-211',
    summary: 'Email verification for self-service signup via the local outbox',
  },
  {
    method: 'POST',
    url: '/api/v1/auth/password-reset',
    ticket: 'LG-210',
    summary: 'Password reset via local outbox token',
  },
  {
    method: 'GET',
    url: '/api/v1/organization',
    ticket: 'LG-215',
    summary: 'Organization settings',
  },
  {
    method: 'PATCH',
    url: '/api/v1/organization',
    ticket: 'LG-215',
    summary: 'Update organization settings',
  },
  { method: 'GET', url: '/api/v1/members', ticket: 'LG-200', summary: 'List members' },
  { method: 'POST', url: '/api/v1/invitations', ticket: 'LG-201', summary: 'Invite a member' },
  {
    method: 'PATCH',
    url: '/api/v1/members/:userId',
    ticket: 'LG-202',
    summary: 'Change a member role',
  },
  {
    method: 'GET',
    url: '/api/v1/audit-events',
    ticket: 'LG-205',
    summary: 'Browse the audit trail',
  },
  {
    method: 'POST',
    url: '/api/v1/ingest/syslog',
    ticket: 'LG-110',
    summary: 'RFC 5424 syslog ingestion',
  },
  {
    method: 'GET',
    url: '/api/v1/ingest/quota',
    ticket: 'LG-112',
    summary: 'Per-tenant ingestion quota usage',
  },
  {
    method: 'GET',
    url: '/api/v1/pipelines',
    ticket: 'LG-120',
    summary: 'List field extraction pipelines',
  },
  {
    method: 'POST',
    url: '/api/v1/pipelines',
    ticket: 'LG-120',
    summary: 'Create a field extraction pipeline',
  },
  {
    method: 'POST',
    url: '/api/v1/pipelines/test',
    ticket: 'LG-122',
    summary: 'Dry-run a pipeline against sample lines',
  },
  {
    method: 'GET',
    url: '/api/v1/fields',
    ticket: 'LG-135',
    summary: 'Field catalog with cardinality samples',
  },
  {
    method: 'POST',
    url: '/api/v1/search/export',
    ticket: 'LG-136',
    summary: 'Export search results as NDJSON/CSV',
  },
  {
    method: 'GET',
    url: '/api/v1/saved-searches',
    ticket: 'LG-130',
    summary: 'List saved searches',
  },
  { method: 'POST', url: '/api/v1/saved-searches', ticket: 'LG-130', summary: 'Save a search' },
  {
    method: 'GET',
    url: '/api/v1/saved-searches/:id',
    ticket: 'LG-130',
    summary: 'Get a saved search',
  },
  {
    method: 'PATCH',
    url: '/api/v1/saved-searches/:id',
    ticket: 'LG-130',
    summary: 'Update a saved search',
  },
  {
    method: 'DELETE',
    url: '/api/v1/saved-searches/:id',
    ticket: 'LG-130',
    summary: 'Delete a saved search',
  },
  { method: 'GET', url: '/api/v1/tail', ticket: 'LG-140', summary: 'Live tail over WebSocket' },
  { method: 'GET', url: '/api/v1/dashboards', ticket: 'LG-150', summary: 'List dashboards' },
  { method: 'POST', url: '/api/v1/dashboards', ticket: 'LG-150', summary: 'Create a dashboard' },
  { method: 'GET', url: '/api/v1/dashboards/:id', ticket: 'LG-150', summary: 'Get a dashboard' },
  {
    method: 'PATCH',
    url: '/api/v1/dashboards/:id',
    ticket: 'LG-150',
    summary: 'Update a dashboard',
  },
  {
    method: 'DELETE',
    url: '/api/v1/dashboards/:id',
    ticket: 'LG-150',
    summary: 'Delete a dashboard',
  },
  {
    method: 'POST',
    url: '/api/v1/dashboards/:id/panels',
    ticket: 'LG-151',
    summary: 'Add a time-series panel',
  },
  { method: 'GET', url: '/api/v1/alert-rules', ticket: 'LG-160', summary: 'List alert rules' },
  { method: 'POST', url: '/api/v1/alert-rules', ticket: 'LG-160', summary: 'Create an alert rule' },
  { method: 'GET', url: '/api/v1/alert-rules/:id', ticket: 'LG-160', summary: 'Get an alert rule' },
  {
    method: 'PATCH',
    url: '/api/v1/alert-rules/:id',
    ticket: 'LG-160',
    summary: 'Update an alert rule',
  },
  {
    method: 'DELETE',
    url: '/api/v1/alert-rules/:id',
    ticket: 'LG-160',
    summary: 'Delete an alert rule',
  },
  {
    method: 'POST',
    url: '/api/v1/alert-rules/:id/preview',
    ticket: 'LG-162',
    summary: 'Backtest a rule over history',
  },
  { method: 'GET', url: '/api/v1/alerts', ticket: 'LG-163', summary: 'List alert instances' },
  {
    method: 'POST',
    url: '/api/v1/alerts/:id/acknowledge',
    ticket: 'LG-164',
    summary: 'Acknowledge an alert',
  },
  {
    method: 'GET',
    url: '/api/v1/notification-channels',
    ticket: 'LG-170',
    summary: 'List notification channels',
  },
  {
    method: 'POST',
    url: '/api/v1/notification-channels',
    ticket: 'LG-170',
    summary: 'Create a notification channel',
  },
  {
    method: 'GET',
    url: '/api/v1/notifications',
    ticket: 'LG-172',
    summary: 'In-app notification inbox',
  },
  {
    method: 'GET',
    url: '/api/v1/outbox',
    ticket: 'LG-171',
    summary: 'Inspect the local webhook/email outbox',
  },
  { method: 'GET', url: '/api/v1/incidents', ticket: 'LG-180', summary: 'List incidents' },
  { method: 'POST', url: '/api/v1/incidents', ticket: 'LG-180', summary: 'Open an incident' },
  {
    method: 'GET',
    url: '/api/v1/incidents/:id/timeline',
    ticket: 'LG-181',
    summary: 'Incident timeline',
  },
  { method: 'GET', url: '/api/v1/retention', ticket: 'LG-190', summary: 'Retention policy' },
  { method: 'PUT', url: '/api/v1/retention', ticket: 'LG-190', summary: 'Update retention policy' },
  {
    method: 'GET',
    url: '/api/v1/partitions',
    ticket: 'LG-191',
    summary: 'Partition inventory and sizes',
  },
]);

export function registerPendingRoutes(app: FastifyInstance, db: Db): void {
  for (const route of PENDING_ROUTES) {
    const isPublic = route.url.startsWith('/api/v1/auth/');
    app.route({
      method: route.method,
      url: route.url,
      ...(isPublic ? {} : { preHandler: requireAuth(db) }),
      handler: async (_request, reply) =>
        reply.status(501).send(
          fail(ERROR_CODES.NOT_IMPLEMENTED, `${route.summary} is not implemented yet`, {
            ticket: route.ticket,
          }),
        ),
    });
  }
}
