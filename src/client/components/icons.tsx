// Minimal stroke icon set (24×24, currentColor). Decorative by default (aria-hidden).
const paths = {
  drop: 'M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z',
  truck: 'M3 6h11v9H3zM14 9h4l3 3v3h-7M7.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM17.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  tank: 'M5 6c0-1.1 3.1-2 7-2s7 .9 7 2v12c0 1.1-3.1 2-7 2s-7-.9-7-2V6ZM5 6c0 1.1 3.1 2 7 2s7-.9 7-2M5 12c0 1.1 3.1 2 7 2s7-.9 7-2',
  rupee: 'M7 5h10M7 9h10M9 5c3.5 0 5 1.6 5 4s-1.5 4-5 4H7l7 6',
  alert: 'M12 4 2.5 20h19L12 4ZM12 10v4M12 17.2v.3',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  calendar: 'M5 6h14v14H5zM5 10h14M9 3v4M15 3v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.8c2 .7 3.2 2.5 3.5 5.2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  key: 'M14.5 9.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM13.2 12.7 21 20.5M17 16.5l2-2M19 18.5l1.5-1.5',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z',
  shield: 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z',
  chart: 'M4 20h16M7 16V10M12 16V5M17 16v-4',
  whatsapp: 'M4 20l1.3-3.9A8 8 0 1 1 8 19L4 20ZM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .8c-1-.5-1.8-1.3-2.3-2.3l.8-1-1-2L9 8.5Z',
  building: 'M5 21V4h9v17M14 9h5v12M8 7h3M8 11h3M8 15h3M3 21h18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  language: 'M4 5h9M8.5 3v2M6 5c.5 3 2.5 5.5 5 7M11 5c-.5 3-3 6.5-6 8M13 20l4-9 4 9M14.5 17h5',
  leak: 'M7 3h10v4H7zM12 7v3M12 13s3 3.2 3 5.3a3 3 0 0 1-6 0C9 16.2 12 13 12 13Z',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className = '', title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={paths[name]} />
    </svg>
  );
}

export function Logo({ className = '', light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display font-bold tracking-tight ${className}`}>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill={light ? '#ffffff' : '#0B63B6'} />
        <path d="M16 6s7 7.4 7 12.6A7 7 0 0 1 9 18.6C9 13.4 16 6 16 6Z" fill={light ? '#0B63B6' : '#ffffff'} />
        <path d="M6 24.5c3-1.6 6-1.6 10 0s7 1.6 10 0" stroke={light ? '#0F5F58' : '#7FC4F0'} strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
      <span className={light ? 'text-white' : 'text-ink'}>JalSetu</span>
    </span>
  );
}
