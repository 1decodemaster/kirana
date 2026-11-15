import { createBrowserRouter } from 'react-router';
import { NavShell } from './components/NavShell';
import { Home } from './routes/Home';
import { ShopMode } from './routes/ShopMode';
import { Catalog } from './routes/Catalog';
import { ItemDetail } from './routes/ItemDetail';
import { Stores } from './routes/Stores';
import { Categories } from './routes/Categories';
import { Data } from './routes/Data';
import { Settings } from './routes/Settings';

export const router = createBrowserRouter([
  {
    element: <NavShell />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/store/:id', element: <ShopMode /> },
      { path: '/catalog', element: <Catalog /> },
      { path: '/catalog/:id', element: <ItemDetail /> },
      { path: '/stores', element: <Stores /> },
      { path: '/categories', element: <Categories /> },
      { path: '/data', element: <Data /> },
      { path: '/settings', element: <Settings /> },
    ],
  },
]);
