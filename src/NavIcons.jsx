// Archive — bottom nav icon set
// Thin-stroke line icons on a 24x24 grid, no fills.
// Color inherits from the parent via currentColor, so the active
// state can be handled entirely with CSS color.

const base = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function WardrobeIcon(props) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M12 5.5c0-2 2.4-2 2.4-.4" />
      <path d="M12 5.5 L4.5 12.5 L19.5 12.5 Z" />
    </svg>
  );
}

export function OutfitsIcon(props) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M8.5 3.5 L10.8 2 L13.2 2 L15.5 3.5 L18.5 6 L16.2 7.5 L15.2 6 L15.2 21 L8.8 21 L8.8 6 L7.8 7.5 L5.5 6 Z" />
      <path d="M10.8 2c.6 2 2.6 2 3.4 0" />
    </svg>
  );
}

export function ScanIcon(props) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M4 8 V5 a1 1 0 0 1 1-1 h3" />
      <path d="M16 4 h3 a1 1 0 0 1 1 1 v3" />
      <path d="M4 16 v3 a1 1 0 0 0 1 1 h3" />
      <path d="M16 20 h3 a1 1 0 0 0 1-1 v-3" />
      <path d="M3 12 h18" />
    </svg>
  );
}

export function InsightsIcon(props) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M6 20 V13" />
      <path d="M12 20 V5" />
      <path d="M18 20 V15" strokeDasharray="2.5 2.5" />
    </svg>
  );
}

export function LookbookIcon(props) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 16.5 L8.5 11 L14 16.5" />
      <circle cx="15.5" cy="9" r="1.2" />
    </svg>
  );
}

export const NAV_ICONS = {
  wardrobe: WardrobeIcon,
  outfits: OutfitsIcon,
  scan: ScanIcon,
  insights: InsightsIcon,
  lookbook: LookbookIcon,
};
