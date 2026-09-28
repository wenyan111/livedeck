export function Title({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-l-2 border-foreground/70 pl-3">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-2">{description}</p>
    </div>
  )
}
