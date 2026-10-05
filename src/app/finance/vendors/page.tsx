import { redirect } from 'next/navigation';

/**
 * Backward compatibility redirect:
 * Standalone Vendors directory has been consolidated into Purchases & Vendors.
 * Redirects incoming bookmarks, deep links, and navigation to the Vendors view.
 */
export default function VendorsRedirectPage() {
  redirect('/finance/purchases?view=vendors');
}
