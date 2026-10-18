import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/routes';
import { UnauthorizedError } from '@/lib/blocks-client';
import { I18nProvider } from '@/features/localization/i18n';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // A surviving 401 means the session is gone — retrying won't bring it back.
      retry: (failureCount, error) => !(error instanceof UnauthorizedError) && failureCount < 2,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Inside the query client (it fetches), outside the router (login is translated too). */}
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
