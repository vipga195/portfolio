const NAV_ITEMS = [
  { href: "#about", label: "About" },
  { href: "#skills", label: "Skills" },
  { href: "#projects", label: "Projects" },
  { href: "#experience", label: "Experience" },
  { href: "#contact", label: "Contact" },
];

export default function Header(): React.JSX.Element {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-neutral-950/70 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <a href="#" className="font-mono font-bold text-blue-400">
          huy.dev
        </a>
        <ul className="hidden gap-6 text-sm text-neutral-300 md:flex">
          {NAV_ITEMS.map(({ href, label }) => (
            <li key={href}>
              <a href={href} className="hover:text-white">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
