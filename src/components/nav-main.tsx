"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  // Rendered next to the item, e.g. a streamed count.
  badge?: ReactNode;
};

// usePathname() resolves at prerender time for static routes. A dynamic route under (app)
// (e.g. /chat/[id]) will need this component wrapped in <Suspense>.
export function NavMain({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  // Close the mobile sheet after any navigation, including links outside this menu.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton
            render={<Link href={item.href} />}
            isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
            tooltip={item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </SidebarMenuButton>
          {item.badge}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
