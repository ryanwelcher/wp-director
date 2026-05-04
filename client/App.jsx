import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast, ToastContainer } from 'react-toastify';
import { AppStateProvider } from './context/AppStateContext.jsx';
import { RunProvider } from './context/RunContext.jsx';
import { Header } from './Header.jsx';
import { Layout } from './Layout.jsx';
import { errorMessage } from './utils/actions.js';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.errorMessage) {
        toast.error(errorMessage(error, query.meta.errorMessage));
      }
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppStateProvider>
        <RunProvider>
          <Header />
          <Layout />
          <ToastContainer
            position="top-right"
            theme="dark"
            autoClose={3000}
            newestOnTop
            closeOnClick
            pauseOnFocusLoss
            pauseOnHover
          />
        </RunProvider>
      </AppStateProvider>
    </QueryClientProvider>
  );
}
