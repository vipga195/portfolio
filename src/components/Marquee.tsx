type MarqueeProps = {
  items: string[];
};

// Decorative ticker; two identical halves so translating by -50% loops without a jump
export default function Marquee({ items }: MarqueeProps): React.JSX.Element {
  return (
    <div aria-hidden className="overflow-hidden border-t border-neutral-800 py-4">
      <div className="flex w-max animate-marquee">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex shrink-0">
            {items.map((item) => (
              <li key={item} className="flex items-center font-display text-2xl font-light uppercase md:text-4xl">
                <span className="px-6">{item}</span>
                <span className="text-accent">✦</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
