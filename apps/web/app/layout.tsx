import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { Providers } from './providers';
import '@/styles/globals.css';

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata = {
  title: 'Exam-Sync',
  description: 'University/College Examination & Quiz Management Platform',
};

/**
 * Root layout — wires the global design-system CSS, IBM Plex font
 * variables, and the client provider tree (React Query + Toasts).
 * Page-level shell/nav (sidebar/topbar per role) is M2 scope, not this.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
