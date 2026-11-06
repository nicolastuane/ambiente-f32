/** Simple stroke icons drawn for this app (24x24 grid, currentColor). */
import type { ReactElement } from 'react';

const PATHS = {
  color: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.8 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3Z" />
      <circle cx="7.5" cy="11" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7.2" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  effects: (
    <>
      <path d="M10 3.5 11.8 8.7 17 10.5l-5.2 1.8L10 17.5l-1.8-5.2L3 10.5l5.2-1.8Z" />
      <path d="M18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z" />
    </>
  ),
  brightness: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
    </>
  ),
  car: (
    <>
      <path d="M3.5 15.5v-3l2-4.6A2 2 0 0 1 7.3 6.7h9.4a2 2 0 0 1 1.8 1.2l2 4.6v3a1 1 0 0 1-1 1h-1.2M6.7 16.5H5.5a1 1 0 0 1-1-1" />
      <path d="M3.5 12.5h17M9.7 16.5h4.6" />
      <circle cx="8.2" cy="16.5" r="1.6" />
      <circle cx="15.8" cy="16.5" r="1.6" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  bluetooth: <path d="M7 7.5 17 16.5 12 21V3l5 4.5L7 16.5" />,
  bluetoothOff: (
    <>
      <path d="M12 12.5V21l4-3.6M12 9V3l5 4.5-2.4 2.2M7 7.5 12 12M7 16.5l4-3.6" />
      <path d="M4 4l16 16" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v8" />
      <path d="M6.4 7.2a7.5 7.5 0 1 0 11.2 0" />
    </>
  ),
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />,
  upload: <path d="M12 16V5M7 9.5l5-5 5 5M5 19.5h14" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3.5 2.8 19.5h18.4Z" />
      <path d="M12 9.5v5M12 17v.4" />
    </>
  ),
  flask: (
    <>
      <path d="M9.5 3.5h5M10.5 3.5v6L5 19a1.3 1.3 0 0 0 1.1 2h11.8A1.3 1.3 0 0 0 19 19l-5.5-9.5v-6" />
      <path d="M7.5 15h9" />
    </>
  ),
  layers: (
    <>
      <path d="m12 4 9 4.5-9 4.5-9-4.5Z" />
      <path d="m3 12.5 9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" />
    </>
  ),
  wrench: <path d="M14.5 6.5a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 1-2-2ZM14.5 6.5l2-2a4 4 0 0 1 3 3l-2 2" />,
  reset: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v4h4" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  steering: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M3.5 10.5c3-.8 5.6-.8 6.3 0M20.5 10.5c-3-.8-5.6-.8-6.3 0M12 14.5V21" />
    </>
  ),
  music: (
    <>
      <path d="M9 17.5V5.5l11-2v12" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="17.5" cy="15.5" r="2.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  welcome: (
    <>
      <path d="M4 20V9l8-5 8 5v11" />
      <path d="M9.5 20v-6h5v6" />
    </>
  ),
  chip: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" />
    </>
  ),
  star: <path d="m12 3.8 2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.4l-5.1 2.8L8 13.6 3.8 9.7l5.7-.7Z" />,
  send: <path d="M4 12 20 4l-6 16-2.5-6.5Z" />,
  flag: <path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
