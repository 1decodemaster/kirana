export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <section className="p-4">
      <h1 className="text-store font-semibold">{title}</h1>
      <p className="mt-2 text-muted">This screen ships in {phase}.</p>
    </section>
  );
}
