export interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly status: 'available' | 'planned';
  readonly ticket?: string;
  readonly description: string;
}

/** Primary navigation. Planned sections render a placeholder that names the backlog ticket. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/search',
    label: 'Search',
    status: 'available',
    description: 'Query logs with LensQL, histogram and stats tables.',
  },
  {
    path: '/api-keys',
    label: 'Ingestion keys',
    status: 'available',
    description: 'Create and revoke API keys for log shippers.',
  },
  {
    path: '/tail',
    label: 'Live tail',
    status: 'planned',
    ticket: 'LG-140',
    description: 'Stream matching events in real time over WebSocket.',
  },
  {
    path: '/saved',
    label: 'Saved searches',
    status: 'planned',
    ticket: 'LG-130',
    description: 'Name, share and reuse LensQL queries.',
  },
  {
    path: '/dashboards',
    label: 'Dashboards',
    status: 'planned',
    ticket: 'LG-150',
    description: 'Time-series panels rendered as SVG charts.',
  },
  {
    path: '/alerts',
    label: 'Alerts',
    status: 'planned',
    ticket: 'LG-160',
    description: 'Threshold and EWMA anomaly rules with flapping suppression.',
  },
  {
    path: '/incidents',
    label: 'Incidents',
    status: 'planned',
    ticket: 'LG-180',
    description: 'Incident timeline built from alert transitions.',
  },
  {
    path: '/pipelines',
    label: 'Pipelines',
    status: 'planned',
    ticket: 'LG-120',
    description: 'Grok-style field extraction at ingest time.',
  },
  {
    path: '/settings',
    label: 'Settings',
    status: 'planned',
    ticket: 'LG-200',
    description: 'Members, roles, retention and quotas.',
  },
];

export const availableItems = (items: readonly NavItem[] = NAV_ITEMS) =>
  items.filter((i) => i.status === 'available');
export const plannedItems = (items: readonly NavItem[] = NAV_ITEMS) =>
  items.filter((i) => i.status === 'planned');
