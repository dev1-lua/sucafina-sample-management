import { useState } from 'react';
import { IconMoon, IconSun } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import { getTheme, toggleTheme } from '@/lib/theme';

export function ThemeToggle() {
  const [theme, setThemeState] = useState(getTheme);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setThemeState(toggleTheme())}
    >
      {theme === 'dark' ? <IconSun className="size-4" /> : <IconMoon className="size-4" />}
    </Button>
  );
}
