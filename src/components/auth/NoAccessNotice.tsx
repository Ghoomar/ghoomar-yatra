'use client';

import React from 'react';
import { ShieldAlert, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/context';

export function NoAccessNotice({ roleName }: { roleName: string }) {
  const { t, locale } = useI18n();
  const supabase = createClient();

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {}
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace('/login');
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xl p-8 max-w-md w-full text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-stone-900">
            {locale === 'hi' ? 'कोई अधिकृत मॉड्यूल उपलब्ध नहीं है' : 'No Authorized Modules Available'}
          </h2>
          <p className="text-xs text-stone-600 leading-relaxed">
            {locale === 'hi'
              ? `आपके खाते को '${roleName}' रोल सौंपा गया है, लेकिन किसी भी मॉड्यूल की अनुमति सक्रिय नहीं है। कृपया सिस्टम प्रशासक से संपर्क करें।`
              : `Your account is assigned the '${roleName}' role, but no accessible module permissions are currently granted. Please contact a system administrator to configure page access.`}
          </p>
        </div>
        <div className="pt-4 border-t border-stone-100">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            className="gap-2 mx-auto text-stone-700 border-stone-300 hover:bg-stone-50"
          >
            <LogOut className="h-4 w-4 text-stone-500" />
            {locale === 'hi' ? 'लॉग आउट करें' : 'Sign Out'}
          </Button>
        </div>
      </div>
    </div>
  );
}
