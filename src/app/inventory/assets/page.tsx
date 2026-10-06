import { redirect } from 'next/navigation';

/**
 * Redirects legacy /inventory/assets route cleanly to the consolidated
 * /inventory?tab=assets view while preserving direct links and bookmarks.
 */
export default function PhysicalAssetsRedirectPage() {
  redirect('/inventory?tab=assets');
}
