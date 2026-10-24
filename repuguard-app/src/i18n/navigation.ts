import { createNavigation } from 'next-intl/navigation';
import { LOCALES } from './locales';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation({ locales: LOCALES });
