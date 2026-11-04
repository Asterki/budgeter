interface ComingSoonProps {
  title: string;
  description: string;
}

export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <section className="placeholder-view">
      <p className="placeholder-view__eyebrow">Foundation</p>
      <h1 className="placeholder-view__title">{title}</h1>
      <p className="placeholder-view__text">{description}</p>
      <p className="placeholder-view__badge">Coming in next stage</p>
    </section>
  );
}
