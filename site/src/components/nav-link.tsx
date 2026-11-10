"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const active = usePathname() === href;
  return <Link prefetch={false} href={href} aria-current={active ? "page" : undefined} className={`nav-link ${active ? "is-current" : ""}`}>{children}</Link>;
}
