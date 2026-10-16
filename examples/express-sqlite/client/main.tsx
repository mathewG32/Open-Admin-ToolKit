import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from '@openadminkit/react';
import '@openadminkit/react/styles.css';
import './app.css';

function Logo() {
  // An original mark for the fictional demo product: three stacked shelves.
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <rect x="1" y="1" width="24" height="24" rx="7" fill="var(--oa-accent)" />
      <rect x="6" y="7" width="14" height="2.4" rx="1.2" fill="#fff" />
      <rect x="6" y="11.8" width="10" height="2.4" rx="1.2" fill="#fff" opacity="0.85" />
      <rect x="6" y="16.6" width="6" height="2.4" rx="1.2" fill="#fff" opacity="0.7" />
    </svg>
  );
}

function SignOut() {
  return (
    <button
      type="button"
      className="oa-button"
      onClick={async () => {
        await fetch('/logout', { method: 'POST' });
        window.location.href = '/login';
      }}
    >
      Sign out
    </button>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp apiBase="/internal/admin/api" appName="Shelfwise" logo={<Logo />} loginUrl="/login" actions={<SignOut />} />
  </StrictMode>,
);
