export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'search:read',
  'search:save',
  'ingest:keys:read',
  'ingest:keys:manage',
  'audit:read',
  'org:manage',
  'members:manage',
  'alerts:manage',
  'dashboards:manage',
  'pipelines:manage',
  'retention:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: readonly Permission[] = ['search:read'];
const MEMBER: readonly Permission[] = [
  ...VIEWER,
  'search:save',
  'ingest:keys:read',
  'dashboards:manage',
];
const ADMIN: readonly Permission[] = [
  ...MEMBER,
  'ingest:keys:manage',
  'audit:read',
  'members:manage',
  'alerts:manage',
  'pipelines:manage',
  'retention:manage',
];
const OWNER: readonly Permission[] = [...ADMIN, 'org:manage'];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  owner: OWNER,
  admin: ADMIN,
  member: MEMBER,
  viewer: VIEWER,
});

export const hasPermission = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);
