import { ToastContainer } from 'react-toastify';
import { AppStateProvider } from './context/AppStateContext.jsx';
import { RunProvider } from './context/RunContext.jsx';
import { Header } from './Header.jsx';
import { Layout } from './Layout.jsx';

export function App() {
  return (
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
  );
}
