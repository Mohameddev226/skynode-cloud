import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * /database/tables → redirect to /database (Table Editor)
 * This route exists so the "Database" sidebar link doesn't 404,
 * while keeping Table Editor as the canonical /database view.
 */
export default async function DatabaseTablesPage({ params }: PageProps) {
  const { slug } = await params;
  redirect(`/projects/${slug}/database`);
}
