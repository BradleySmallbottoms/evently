/** Brand, light, and dark tokens. `colors` is the live palette screens read. */
export const palette = {
  brand: {
    berry: '#963B50',
    berryLight: '#B85B72',
    berryDark: '#702C3B',
    berrySubtle: '#F2E2E6',
    berryMuted: '#D9A8B4',
  },

  light: {
    background: '#F5F0E8',
    surface: '#FFFFFF',
    surfaceSecondary: '#EEE8DF',
    surfaceElevated: '#FFFFFF',

    text: '#282423',
    textSecondary: '#77716D',
    textTertiary: '#A39B94',

    border: '#E5DED5',
    divider: '#EAE4DC',

    primary: '#963B50',
    primaryPressed: '#702C3B',

    icon: '#282423',
    overlay: '#00000066',
  },

  dark: {
    background: '#19191B',
    surface: '#242427',
    surfaceSecondary: '#2E2E32',
    surfaceElevated: '#343438',

    text: '#F5F0E8',
    textSecondary: '#B8B1AC',
    textTertiary: '#89827E',

    border: '#414044',
    divider: '#343438',

    primary: '#B85B72',
    primaryPressed: '#963B50',

    icon: '#F5F0E8',
    overlay: '#00000099',
  },

  categories: {
    music: {
      primary: '#963B50',
      light: '#F2E2E6',
      dark: '#482631',
    },
    sports: {
      primary: '#245D54',
      light: '#DFECE6',
      dark: '#203C34',
    },
    culture: {
      primary: '#7656A6',
      light: '#E9E2F2',
      dark: '#392B4B',
    },
    family: {
      primary: '#C47745',
      light: '#F4E5D8',
      dark: '#493326',
    },
    holidays: {
      primary: '#B18B39',
      light: '#F2E9D2',
      dark: '#493B20',
    },
    other: {
      primary: '#607D91',
      light: '#E1E9EF',
      dark: '#293943',
    },
  },

  status: {
    success: {
      light: '#287A58',
      dark: '#65BD91',
    },
    warning: {
      light: '#A87524',
      dark: '#E5B85E',
    },
    error: {
      light: '#B83D42',
      dark: '#F0787D',
    },
    info: {
      light: '#356DAA',
      dark: '#79A9E0',
    },
  },
} as const;

export const brand = palette.brand;

/** Splash artwork for light and dark. */
export const splashPalette = {
  light: {
    background: '#FFF8F0',
    logo: '#963B50',
    text: '#282423',
    subtitle: '#877B74',
    wave1: '#F2D0D0',
    wave2: '#CF8C9D',
    wave3: '#963B50',
  },
  dark: {
    background: '#19191B',
    logo: '#B85B72',
    text: '#F5F0E8',
    subtitle: '#B8B1AC',
    wave1: '#343438',
    wave2: '#702C3B',
    wave3: '#963B50',
  },
} as const;

type Scheme = 'light' | 'dark';

export function splashColors(scheme: Scheme) {
  return splashPalette[scheme];
}

function schemeColors(scheme: Scheme) {
  const mode = palette[scheme];
  const status = palette.status;
  const categories = palette.categories;
  const subtle = scheme === 'dark' ? categories.music.dark : palette.brand.berrySubtle;
  return {
    background: mode.background,
    card: mode.surface,
    cardDarker: mode.surfaceSecondary,
    cardDarkest: mode.surfaceElevated,
    cardOpacity: mode.overlay,
    label: mode.text,
    secondaryLabel: mode.textSecondary,
    separator: mode.border,
    divider: mode.divider,
    primary: mode.primary,
    primaryPressed: mode.primaryPressed,
    accent: mode.primary,
    accentSoft: subtle,
    accentSoftAlpha: subtle,
    secondary: status.success[scheme],
    secondarySoft: scheme === 'dark' ? categories.sports.dark : categories.sports.light,
    secondarySoftAlpha: scheme === 'dark' ? categories.sports.dark : categories.sports.light,
    info: status.info[scheme],
    infoSoft: scheme === 'dark' ? categories.other.dark : categories.other.light,
    accentDeep: scheme === 'dark' ? mode.primary : mode.primaryPressed,
    canvas: mode.background,
    ink: mode.text,
    inkMuted: mode.textSecondary,
    inkFaint: mode.textTertiary,
    icon: mode.icon,
    line: mode.border,
    overlay: mode.overlay,
    success: status.success[scheme],
    warning: status.warning[scheme],
    danger: status.error[scheme],
    dangerSoft: status.error[scheme],
    /** Text and icons on a berry fill. */
    onFill: '#FFFFFF',
  };
}

const lightColors = schemeColors('light');
const darkColors = schemeColors('dark');

let appliedScheme: Scheme = 'light';

/** Scheme last written onto `colors`. Screens read this when a hidden tab wakes up. */
export function appliedColorScheme(): Scheme {
  return appliedScheme;
}

type ColorName = keyof typeof lightColors;

/** Live palette. Screens read this during render; `applyColorScheme` updates every key. */
export const colors: { [K in ColorName]: string } = { ...lightColors };

export type CategoryId = keyof typeof palette.categories;

/** Category chip fill and icon. `fill` is the tint; `icon` stays readable on it. */
export const categoryColors: Record<CategoryId, { fill: string; icon: string }> = {
  music: { fill: palette.categories.music.light, icon: palette.categories.music.primary },
  sports: { fill: palette.categories.sports.light, icon: palette.categories.sports.primary },
  culture: { fill: palette.categories.culture.light, icon: palette.categories.culture.primary },
  family: { fill: palette.categories.family.light, icon: palette.categories.family.primary },
  holidays: { fill: palette.categories.holidays.light, icon: palette.categories.holidays.primary },
  other: { fill: palette.categories.other.light, icon: palette.categories.other.primary },
};

function applyCategoryColors(scheme: Scheme) {
  (Object.keys(categoryColors) as CategoryId[]).forEach((id) => {
    const cat = palette.categories[id];
    categoryColors[id].fill = scheme === 'dark' ? cat.dark : cat.light;
    categoryColors[id].icon = scheme === 'dark' ? cat.light : cat.primary;
  });
}

export function applyColorScheme(scheme: Scheme): void {
  appliedScheme = scheme;
  const next = scheme === 'dark' ? darkColors : lightColors;
  (Object.keys(lightColors) as ColorName[]).forEach((key) => {
    colors[key] = next[key];
  });
  applyCategoryColors(scheme);
}
