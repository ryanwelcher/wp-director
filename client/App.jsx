import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
import { AppStateProvider } from './context/AppStateContext.jsx';
import { RunProvider } from './context/RunContext.jsx';
import { Header } from './Header.jsx';
import { Layout } from './Layout.jsx';

const queryClient = new QueryClient({
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
