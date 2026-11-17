import { Outlet, ScrollRestoration, createBrowserRouter } from 'react-router';
import { NavShell } from './components/NavShell';
import { Home } from './routes/Home';
import { ShopMode } from './routes/ShopMode';
import { Catalog } from './routes/Catalog';
import { ItemDetail } from './routes/ItemDetail';
import { Stores } from './routes/Stores';
import { Categories } from './routes/Categories';
import { Data } from './routes/Data';
import { Settings } from './routes/Settings';
import { Login } from './routes/Login';
import { Welcome } from './routes/Welcome';

/** ScrollRestoration lives above every route so leaving Shop Mode restores
 * Home's scroll position on the way back (G15.4). */
function RootLayout(): React.JSX.Element {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      // §8.5: Shop Mode is full screen — no tab bar, no rail.
      { path: '/store/:id', element: <ShopMode /> },
      // P4 auth screens: full screen, outside the nav shell (§7.6, §8.9).
      { path: '/login', element: <Login /> },
      { path: '/welcome', element: <Welcome /> },
      {
        element: <NavShell />,
        children: [
          { path: '/', element: <Home /> },
          { path: '/catalog', element: <Catalog /> },
          { path: '/catalog/:id', element: <ItemDetail /> },
          { path: '/stores', element: <Stores /> },
          { path: '/categories', element: <Categories /> },
          { path: '/data', element: <Data /> },
          { path: '/settings', element: <Settings /> },
        ],
      },
    ],
  },
]);
