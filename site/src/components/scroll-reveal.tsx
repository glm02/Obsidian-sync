"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function ScrollReveal() {
  const pathname = usePathname();
  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>(".section, [data-reveal]");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const showAll = () => elements.forEach(element => element.removeAttribute("data-reveal-state"));
    if (motion.matches || !("IntersectionObserver" in window)) { showAll(); return; }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.removeAttribute("data-reveal-state");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0, rootMargin: "0px 0px -24px 0px" });
    elements.forEach(element => {
      if (element.getBoundingClientRect().top >= window.innerHeight) {
        element.setAttribute("data-reveal-state", "hidden");
        observer.observe(element);
      }
    });
    const changed = () => { if (motion.matches) { observer.disconnect(); showAll(); } };
    motion.addEventListener("change", changed);
    return () => { observer.disconnect(); motion.removeEventListener("change", changed); showAll(); };
  }, [pathname]);
  return null;
}
