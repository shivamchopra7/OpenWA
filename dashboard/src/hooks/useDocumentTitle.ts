import { useEffect } from 'react';

/**
 * Custom hook to set document title dynamically.
 * Automatically appends " | WhatsApp Marketing" suffix.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | WhatsApp Marketing`;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
