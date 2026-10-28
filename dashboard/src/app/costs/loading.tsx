// Shown while the page's queries run on navigation. Not used for /incidents/[id]: a loading
// boundary there would send 200 before notFound() can answer 404.
export { PageSkeleton as default } from '@/components/PageSkeleton';
