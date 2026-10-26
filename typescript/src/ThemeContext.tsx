// Sprint 5: physically moved here from tools/remotion/src/ThemeContext.tsx.
// The theme-api re-export now points at this in-package module.

import {createContext, useContext, useMemo} from 'react';
import type {ReactNode} from 'react';

export type Theme = {
  id: string;
  visual: {
    color: {
      fg: string;
      bg: string;
      accent: string;
    };
    type: {
      families: {
        heading: string;
        body: string;
        mono?: string;
      };
      size: {
        base: number;
        small: number;
        large: number;
      };
      weight: {
        normal: number;
        bold: number;
      };
      lineHeight: number;
    };
    motion: {
      fadeMs: number;
    };
    canvas: {
      width: number;
      height: number;
      fps: number;
    };
  };
};

export type RuntimeTheme = Theme & {
  color: Theme['visual']['color'];
  type: Theme['visual']['type'];
  motion: Theme['visual']['motion'];
};

export const DEFAULT_THEME: Theme = {
  id: 'banodoco-default',
  visual: {
    color: {
      fg: '#FAFAFA',
      bg: '#050814',
      accent: '#67E8F9',
    },
    type: {
      families: {
        heading: 'Arial',
        body: 'Arial',
        mono: 'monospace',
      },
      size: {
        base: 32,
        small: 22,
        large: 84,
      },
      weight: {
        normal: 400,
        bold: 600,
      },
      lineHeight: 1.2,
    },
    motion: {
      fadeMs: 450,
    },
    canvas: {
      width: 1920,
      height: 1080,
      fps: 30,
    },
  },
};

export const toRuntimeTheme = (theme: Theme): RuntimeTheme => {
  return {
    ...theme,
    color: theme.visual.color,
    type: theme.visual.type,
    motion: theme.visual.motion,
  };
};

const DEFAULT_RUNTIME_THEME = toRuntimeTheme(DEFAULT_THEME);
const ThemeContext = createContext<RuntimeTheme>(DEFAULT_RUNTIME_THEME);

export const ThemeProvider = ({
  children,
  value,
}: {
  children: ReactNode;
  value?: Theme;
}): ReactNode => {
  const runtimeTheme = useMemo(() => value === undefined ? DEFAULT_RUNTIME_THEME : toRuntimeTheme(value), [value]);
  return <ThemeContext.Provider value={runtimeTheme}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): RuntimeTheme => {
  return useContext(ThemeContext);
};
