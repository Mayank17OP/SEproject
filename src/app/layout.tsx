import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Timetable → Calendar — turn your college timetable into a .ics file',
  description:
    'Upload a photo or PDF of your college timetable and get a Google Calendar ready .ics file with rooms, faculty and weekly recurrence. Free, no signup, nothing stored.',
  keywords: ['timetable', 'calendar', 'ics', 'google calendar', 'college', 'students', 'ocr'],
  authors: [{ name: 'Timetable to Calendar' }],
  openGraph: {
    title: 'Timetable → Calendar',
    description: 'Photo or PDF of your timetable → one .ics file that lands in Google Calendar with rooms and teachers.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#070912',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
