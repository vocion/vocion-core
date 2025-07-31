'use client';

import Link from 'next/link';
import { ToggleMenuButton } from '@/components/ToggleMenuButton';
import { useMenu } from '@/hooks/UseMenu';
import { cn } from '@/utils/Helpers';

export const CenteredMenu = (props: {
  logo: React.ReactNode;
  children: React.ReactNode;
  rightMenu: React.ReactNode;
}) => {
  const { showMenu, handleToggleMenu } = useMenu();

  const navClass = cn('max-lg:w-full max-lg:bg-secondary max-lg:p-5', {
    'max-lg:hidden': !showMenu,
  });

  return (
    <div className="flex flex-wrap items-center justify-between">
      <Link href="/">{props.logo}</Link>

      <div className="lg:hidden">
        <ToggleMenuButton onClick={handleToggleMenu} />
      </div>

      <nav className={cn('rounded-t-xl max-lg:mt-2', navClass)}>
        <ul className="flex gap-x-6 gap-y-1 text-lg font-medium max-lg:flex-col max-lg:[&_a]:inline-block max-lg:[&_a]:w-full [&_a:hover]:opacity-70">
          {props.children}
        </ul>
      </nav>

      <div
        className={cn(
          'rounded-b-xl max-lg:border-t max-lg:border-border',
          navClass,
        )}
      >
        <ul className="flex flex-row items-center gap-x-1.5 text-lg font-medium [&_a:hover]:opacity-70">
          {props.rightMenu}
        </ul>
      </div>
    </div>
  );
};
